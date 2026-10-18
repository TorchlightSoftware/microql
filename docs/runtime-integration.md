# Runtime Integration

This guide is for building other runtimes for MicroQL: a hosted automation service, on Cloudflare Workers or otherwise. It covers the spec a runtime must satisfy, and what decisions a runtime can and should make about state isolation and persistence.

## Core, runtime and platform

Three parties take part in running a Query, and each owns different things:

| Party | Is | Owns |
|---|---|---|
| **Core** | `compile`, `plan` and `execute`, imported as `microql/core` | Query intepretation: references, chains, `each`, retries, timeouts, error handling, scheduling, and which results to reuse |
| **Runtime** | one object for the whole process, passed as `config.runtime`, usually extending MicroQL's `Runtime` | its services, their config and their [instances](#service-instances), by [scope](#the-runtime-api); the [Cache](#the-cache); and `env`, the environment's utilities, such as output |
| **Platform** | whatever calls core: a node script, a server, an editor | [Runs](#runs): which scope each runs in, its Run id, which names its [Run State](#storage), where results are shown, and when stores are cleared |

**Core is kept free from environment dependencies: the file system, the network and so on.** A runtime provides these: core makes every service call through it, and each service instance receives its `env`. MicroQL ships `Runtime`, the base a runtime extends, and one runtime, the **node runtime**, as the reference implementation. Any object that satisfies [the runtime API](#the-runtime-api) is a runtime.

The platform is yours. [A suggested architecture](#a-suggested-architecture) at the end shows one way to build one, but MicroQL requires none of it.

## Entry points

| Import | Resolves to | Is |
|---|---|---|
| `microql` | `index.js` | core with the node runtime wired in. `query()`, `plan()` and `compile()` take a Query's `services`, and `query()` its `config`, and file them in the node runtime's one scope before going on; `query()` runs a Run of its own, whose Run State it releases once done, unless you name one with `runId`. Also exports `NodeRuntime`, `nodeRuntime`, `fileStore`, `fileCache` and `fileRunStates`. |
| `microql/core` | `core.js` | core alone, with no runtime of its own. `compile` refuses a Query without a `runtime`, and `execute` a Run without a `runId`. A lint rule keeps node built-ins out of every core file. |

MicroQL has an internal compile step that turns a Query into a plan - an internal memory representation which is also serializeable. "compile" does not infer any sort of language transpilation: MicroQL is just JavaScript. A plan's types are zod schemas, which [zodex](https://www.npmjs.com/package/zodex) serializes; zodex 4.0.1 drops a format written as a check, such as zodly's `['string', 'email']` (see zodly's comparison with zodex).

Both export:

| Export | Is |
|---|---|
| `query(config, options)` | compile, execute, select |
| `compile(config)` | the Query as a plain tree of phases and calls; throws on compile-time errors |
| `execute(compiled, options)` | run a compiled Query; returns each executed phase's result |
| `plan(query, {trigger})` | everything an editor needs, without running anything |
| `applySelection(results, select)` | what `select` names |
| `addressToPath(plan, address)`, `pathToAddress(plan, path)` | [Service Call Addresses](#service-call-addresses) ↔ JSON paths |
| `memoryStore()` | an [entry store](#entry-stores) in memory |
| `scopedCache(storeOf)`, `memoryCache()` | a Cache: an entry store per scope ([Entry stores](#entry-stores)) |
| `scopedRunStates(storeOf)`, `memoryRunStates()` | Run States: an entry store per scope and Run ([Entry stores](#entry-stores)) |
| `Runtime` | the base a runtime extends: its services, their config and instances, and `call` ([The runtime API](#the-runtime-api)) |
| `ServiceRegistry`, `ConfigRegistry` | a runtime's services and their instances, and its config, by scope and name; `Runtime` makes one of each, and a runtime that keeps config elsewhere extends `ConfigRegistry` ([Config](#config)) |
| `configSchemaOf(declaration)` | the zod schema of a service's config declaration, `oauth` types included ([Config](#config)) |
| `serviceSmokeTests(service, {env, config})` | a table of tests checking a service against the service spec ([Service Development Guide § Testing services](service-guide.md#testing-services)) |
| `util` | the built-in service |
| `defineService(serviceDefinition)` | a service from a service definition, resources mapped to service calls; see the [Service Development Guide](service-guide.md#writing-a-service-with-defineservice) |
| `parseSchema(descriptor)` | the zod schema a [zodly](validation.md#schema-syntax) descriptor describes, for a service that hands schemas to a library |
| `errorSchema`, `isErrorData`, `toErrorData`, `fromErrorData` | [errors as data](#errors-as-data) |
| `format(value, options)` | a value as text, the same on every runtime |

## Storage

### Entry stores

**An entry store is a dumb key-value store.** Core decides the keys and the entries; the store decides only where they live. Keys are pairs of strings, a [form hash](#forms) and an input hash: the hash of every value a call reads on one execution — its own resolved fields, and, for a call that holds other calls, what those read from outside it (an enclosing iteration's item, an enclosing `catch`'s error, a phase). The form says where each value comes from; the input hash says what it was. So a form holds one entry per distinct input, and several inside an iteration.

Core calls three async methods, so a store may live anywhere: in memory, on disk, in a database, in KV.

```javascript
{
  get(form, input),         // the entry, or undefined
  set(form, input, entry),
  list(form)                // every entry for a form
}
```

To build one, implement those three methods over anything that stores JSON. Core never deletes entries; clearing a store is its owner's business. Both stores MicroQL ships, `memoryStore()` and the node runtime's `fileStore(dir)`, also offer `clear(form)` to empty one form, or `clear()` to empty all of them.

**The Cache keeps an entry store per [scope](#the-runtime-api)**, so two tenants making an identical call, with credentials of their own, never share an entry: `get(scope, form, input)`, `set(scope, form, input, entry)`, `list(scope, form)`. `scopedCache(storeOf)` makes one from a store per scope, made by `storeOf(scope)` on the scope's first use; `memoryCache()` keeps them in memory, and the node runtime's `fileCache(dir)` keeps a `fileStore` per scope, in a directory named by the scope's hash. Both offer `clear(scope, form)`, `clear(scope)` and `clear()`.

**Run States are the runtime's too, an entry store per scope and Run**, so a store knows whose Runs it holds: `get(scope, runId, form, input)`, `set(scope, runId, form, input, entry)`, `list(scope, runId, form)`. The platform names each Run with an id, and running again with the same id resumes it. `scopedRunStates(storeOf)` makes them from a store per Run, made by `storeOf(scope, runId)`; `memoryRunStates()` keeps them in memory, and the node runtime's `fileRunStates(dir)` keeps a `fileStore` per Run, in a directory named by the Run's id within one named by its scope's hash. Both offer `clear(scope, runId)` and `clear()`.

### Two stores, two owners

| Store | Holds results for | Supplied by | Passed as |
|---|---|---|---|
| **Run State** | one [Run](#runs) | the runtime, named by the platform's Run id | `runtime.runStates`, for `execute(compiled, {runId})` |
| **Cache** | every Run, for calls with `cache` set | the runtime | `runtime.cache` |

**A Run State entry** holds `address`, `input`, `inputs` (the resolved input fields), `reads` (for a call that holds others, what they read from outside it, by reference), `status` (`done` or `failed`), `output` or `error` (`{message, attempts, at}`), `startedAt` and `duration`. Core reuses only `done` entries, so a failed call runs again on resume. A failure a `catch` handled is the holding call's output, as [error data](#errors-as-data), so it is stored and reused like any other result.

### The Cache

Core reuses a Cache entry while it is younger than the call's ttl: `cache: {ttl}`, else `settings.cache.ttl`, else seven days. Each entry records `created` and `expires`, so a store can prune expired entries without knowing any ttl. Pruning is the store's business. The node runtime's `fileStore` sweeps expired entries once, before its first use.

## Runs

**A Run is one or more executions of a Query against one Run State.** It is a concept, not engine state: core keeps no record of Runs, and the Run State is their only trace. Core works inside the Run State of whichever Run it is named, and never chooses or switches Runs. Deciding what a Run is, and labelling it or keeping its history, is the platform's job.

Core writes every call's result to the Run State as it goes, and reuses any result already there. That one rule covers three things:

- **A fresh Run:** against an empty store, everything runs.
- **Resume after an interruption:** against a store holding some results, only what's missing runs.
- **Rerunning part of a Query:** run again against the same store with a [target](#targets).

To rerun everything, the platform starts a new Run, with a new id. When a call fails, core lets the calls already in flight finish and record their results before it reports the failure, so resuming never repeats them.

## Running a Query

```javascript
import {compile, execute} from 'microql/core'

const compiled = compile({phases, runtime, scope: {tenantId}})  // runtime: your own, or the node runtime
const results = await execute(compiled, {runId, trigger, target, signal, onUpdate})
```

A Query runs on its `runtime`, in its `scope` there: the scope compile looks each key's service up in, and the Run's calls and stored results are keyed by. It's `{}` unless you give one, which is the node runtime's only scope.

| Option | Is |
|---|---|
| `runId` | required: the Run, whose Run State the runtime keeps; the same id again resumes it ([Entry stores](#entry-stores)) |
| `trigger` | the payload [`$trigger`](#trigger) holds |
| `target` | a [phase](../README.md#phases), `'$listings'`: run it and what it depends on, nothing after it |
| `signal` | an `AbortSignal` that stops the Run |
| `onUpdate` | a callback receiving [progress updates](#progress-updates) |

`query(config, options)` takes the same options.

### Targets

`target: '$listings'` runs the target phase and every phase it depends on, then stops. Upstream results already in the Run State are reused. The target phase's own calls always rerun, inside its iterations too. Later phases don't run. This is what "run up to and including this phase" needs.

With no target, core runs every phase, reusing the results already in the Run State.

### Abort

Aborting the `signal` stops the Run at once:
- No call starts after the abort.
- Each running phase reports `cancelled`, along with the addresses of its calls still in flight.
- `execute` rejects with the signal's reason, an `AbortError` unless you gave another.
- Results already finished stay in the Run State. A call still in flight that finishes after the abort is discarded with the rest of the work in progress: nothing is recorded for it, so resuming the Run makes it again.
- No `catch` runs, the Query's included.
- Calls already sent to a service may still complete on the far side; services are never told about the abort.

### Progress updates

`onUpdate` is called with plain, serializable records, in the order they happen:

```javascript
{kind: 'phase', name: 'listings', status: 'running', startedAt: '2026-10-08T09:00:00.000Z'}
{kind: 'phase', name: 'listings', status: 'done', startedAt: '…', duration: 4120, resultHash: '9f2c…', upstream: {categories: '41ab…'}}
{kind: 'phase', name: 'listings', status: 'failed', startedAt: '…', duration: 512, error: '[$listings.@1a1 - [scraper]/extract] Timed out after 30000ms'}
{kind: 'phase', name: 'listings', status: 'cancelled', startedAt: '…', duration: 230, inFlight: ['$listings.@1a1']}
```

A phase with no update hasn't begun. A running phase reports when it started, never partial output; its calls' results are in the Run State as they finish.

**A `done` update carries hashes, so a platform can tell when results are stale.** `resultHash` is the hash of the phase's result. `upstream` maps each phase it read to that phase's `resultHash` at the time. After an upstream phase reruns, a later phase is stale when the upstream's new `resultHash` differs from the one in its `upstream`, or when an upstream phase is itself stale.

The callback is synchronous and its return value is ignored, so wiring it to a websocket, a queue or a polling table is one line:

```javascript
await execute(compiled, {runId, onUpdate: update => socket.send(JSON.stringify(update))})
```

`onUpdate` cannot fail a Run: if it throws, the error is logged and the Run carries on.

### $trigger

`$trigger` is referenced like any phase, and holds the payload passed to `execute` (or `query`) as `trigger`. Runs with different payloads never share a result, because forms count `$trigger` by value.

A Query may describe its payload with a `trigger` field. Core reads only `trigger.schema`, a [Service Call Validation](validation.md) schema checked before any call runs. Core ignores every other field, so a platform may keep its own trigger configuration there.

```javascript
// a checkout webhook onboards a new customer
const onboarding = {
  trigger: {schema: {customer_details: {email: ['string', 'email']}, metadata: {plan: ['string']}}},
  services: {crm, email, chat},
  phases: {
    contact: ['POST [crm]/contacts', {email: '$trigger.customer_details.email', plan: '$trigger.metadata.plan'}],
    welcome: ['POST [email]/campaigns', {campaign: 'welcome', email: '$trigger.customer_details.email'}],
    notified: ['POST [chat]/post', {channel: '#sales', text: 'New customer', contact: '$contact'}]
  }
}

await query(onboarding, {trigger: checkoutEvent})
```

A payload that doesn't fit the schema fails the Run before anything runs, with `$trigger validation failed`.

## Realtime Query Validation

`plan(query, {trigger})` is pure and cheap enough to call on every edit. It checks the Query, gives every service call an [address](#service-call-addresses), and gives every call a [form hash](#forms). An editor uses these to bind its view to the Query and update it as the Query changes.

Pass `trigger` only to look up results from a Run that had that payload. Form hashes count `$trigger` by value, so they match that Run's results only when the payload matches. While editing, leave it out.

| Field | Is |
|---|---|
| `queryHash` | the Query's form hash |
| `roots` | `$given` (when the Query has one) and `$trigger`, as root nodes ahead of the first column, with their [types](#types) |
| `columns` | the phases that run together, in order |
| `phases` | each phase's `name`, `dependencies`, `formHash` and return type |
| `calls` | every call's `address`, `path`, `key`, `formHash`, readable `form`, and `types` |
| `errors` | type issues, by address and [code](#plan-errors) |
| `warnings` | compile warnings, such as a binding that shares a phase's name |

To show a call's results, the platform looks them up by the call's form hash in the Run's Run State: `runtime.runStates.list(scope, runId, formHash)`. Two addresses with one form hash are identical calls, which run once. `plan()` checks the Query against the services its runtime has registered in its scope, as compile does, so an editor passes the Query its `runtime` and `scope`.

### Terms

Four independent axes for talking about a Query and what changes in it.

| Term | Means | Example |
|---|---|---|
| **key** | canonical identity of a service or other Query constituent | `POST [sms]/send`, a phase name, a binding name |
| **address** | canonical location within the Query tree — positional, never a hash | `$listings.@1a2` |
| **form** | canonical structure of a call: its definition, with each reference replaced by the **form hash** of what it points to | — |
| **result** | what a call produced; compared by its hash | — |

A moved subtree whose inputs didn't change has a new address and the same form, so its results are kept and found at the new location. An edited call has the same address and a new form, as does everything downstream of it.

### Service Call Addresses

An address names one call within one Query version, for editors, logs and errors. It is calculated, never stored in the Query, and never valid as a reference.

- **Numbering.** Calls are numbered and call fields are lettered, alternating. `$listings.@1` is the phase's first call, `@1a` is that call's first call field, and `@1a2` is the second call in that field's chain. An address that names a call always ends in a digit.
- **Letters.** Field letters follow sorted field-path order (the ordering RFC 8785 uses), so letters never depend on how a document was written. `catch` is always `e`, for error, and call fields skip it (`a`, `b`, `c`, `d`, `f`, …), so adding or removing a `catch` moves no other address: `$listings.@1e1` is the first call of `$listings.@1`'s catch.
- **Fields.** A call's fields follow its address by name: `$listings.@1.url`. Field names that begin with `@` (JSON-LD's `@type`) stay ordinary path segments.
- **The Query's catch** is addressed `settings.catch.@1`.
- **Versions.** An address is only meaningful against the Query version it came from, so errors carry `address`, `key` and `queryHash` (the Query's form hash), and `formHash`, the call's own, which finds its entries in the Run State and the Cache.

`addressToPath(plan, address)` and `pathToAddress(plan, path)` convert between an address and a JSON path into the Query document, so an editor can map a selection to a call and back.

### Forms

A form is a subtree of the Query, beginning at one service call. It holds the call's key, its fields, the settings that change what it returns, and the hashes of what it references. A form hash changes when anything in the subtree changes:

- `$phase` is replaced by that phase's form hash;
- `$given` and `$trigger` count by their values;
- `@`, `@name` and `@err` count as the form of what flows in, which inside an iteration is "the input of the call that owns it";
- a call's `timeout`, `retry`, `debug` and `cache` settings don't count. They change how a call runs, not what it returns, so editing them keeps its results.

Hashes are SHA-256 over canonical JSON, computed synchronously in pure JS (`@noble/hashes`), so they cost the same everywhere and `plan()` is synchronous.

### Types

`plan()` infers a type for every service call and every input field, as zod schemas. An editor, such as a visual Builder, converts them to whatever types it displays; core has no types of its own. `z.any()` stands for a type that can't be known.

- A field's **expected** type comes from the service call's declaration: its concrete type (a zodly descriptor or zod schema), or a relationship to another field's type. A call field's expected type is what its nested call must return; `util/filter` wants boolean.
- Its **actual** type is a literal's own type, a phase's return type, or the flow at that point, with paths walking into them; a field the call's own `precheck` names has the precheck's type. Inside a nested call, `@` is what the declaration says the call field receives (`util/each`: one item of `on`), or `z.any()`.
- A call's **return** type is its own `postcheck`, else its declared output, resolved against its fields.

Declarations are described in the [Service Development Guide](service-guide.md#declarations). Type issues are listed in `plan().errors` ([Plan errors](#plan-errors)). `plan()` never runs anything, and run-time validation still decides whether a call runs.

## Errors

Every error core reports carries a `code`, so a platform can decide what each means to its users without reading messages. Messages are for people, and may change; codes and addresses are the API.

### Errors as data

A failed call throws, and its failure fails each call holding it in turn, until a `catch` handles it. There the failure becomes data, which `@err` holds inside the handler:

```javascript
{'@type': 'Error', name, message, cause, address, key, queryHash, formHash, args}
```

It is zodly's `error` type: a JSON-LD node of type Error, recognised by `@type`, `name` and `message` whatever other fields it has ([Validation](validation.md)). Its fields are the thrown Error's own: `name`, `message`, `cause` (the error behind it, in the same form), any fields the service gave it, and those MicroQL labelled it with. `address` and `key` name the call that raised it, `queryHash` is the Query's form hash, `formHash` the call's own (its key in the Run State and the Cache), and `args` the call's resolved input fields. It is plain JSON, so it survives the Run State and the Cache. Incoming JSON-LD data of `@type` Error is an error too, as far as `skip: ['error']` is concerned. Core exports `errorSchema` to recognise it (it is zodly's `error` type), and `toErrorData` and `fromErrorData` to convert between it and an `Error`. A failure no `catch` handles ends the Run, and `execute` rejects with it as an `Error` carrying the same fields.

### Compile errors

`compile()`, `plan()` and `query()` throw on a Query that can't run. The error has `message`, `code` and `address`, the [Service Call Address](#service-call-addresses) of the call or node at fault (`$a.@1`, `$trigger`, `select`). A cycle between phases has no single address, so it carries `phases`, the phases in the cycle, instead.

| Code | Means |
|---|---|
| `invalid-descriptor` | a call isn't `['[METHOD] [service]/resource', {...}]`, or its arguments aren't an object |
| `retired-key` | a key uses the retired `service:action` form, or a call or the Query's settings use a retired argument (`onError`, `ignoreErrors`, `skipInputErrors`, `skipOutputErrors`); the message names its replacement |
| `unknown-service` | no service is registered under the key's name in the Query's scope |
| `not-a-service` | the service lacks one of `lookup`, `supportedCalls` and `init` |
| `missing-capability` | the service `requires` an `env` key the runtime doesn't provide ([Capabilities beyond the standard](#capabilities-beyond-the-standard)) |
| `refused-key` | the service's `lookup` refused the key: a resource it lacks, a method it doesn't take, a key confined or not as it doesn't answer; the message is the service's |
| `malformed-declaration` | the service call's declaration has an unknown tag, a malformed zodly type or a malformed source |
| `no-target` | method syntax was used for a service call that declares no target field |
| `malformed-schema` | a Service Call Validation or the trigger schema can't be parsed |
| `unknown-reference` | a reference names no phase, node, iteration or enclosing `catch` |
| `invalid-reference` | a reference is malformed: bare `$`, `@@`, a Service Call Address, `@` where nothing flows in |
| `reserved-name` | a phase named `given` or `trigger`, or an iteration named `err` |
| `duplicate-binding` | an iteration name used twice in a Query |
| `unreachable-input` | a chain in a call field, without `as:` to reach its input |
| `misplaced-as` | `as:` on a call that holds no nested call |
| `misplaced-catch` | `catch:` on a call that holds no nested call; hold a single call in `[util]/try` to catch it |
| `raw-function` | a JavaScript function where a call was expected |
| `invalid-select` | `select` names something other than a reference |
| `circular-dependency` | phases that depend on each other; see `phases` |

### Plan errors

Each of `plan().errors` is `{address, code, message, expected, actual}`. `address` is the field's, followed by the path inside its value where the issue is (`$a.@1.data.name`; `*` stands for any item of a list or value of a record). `expected` and `actual` are the zod schemas there.

| Code | Means | Will the call run? |
|---|---|---|
| `type-mismatch` | the types are incompatible, or a required field isn't supplied | its validation will fail, if it has one for that field |
| `maybe-missing` | an optional or nullable value goes into a required field | only when the value is there |
| `type-narrowing` | a value whose type isn't known (`any`), or is wider (a string for an enum), goes into a narrower field | when the value fits; the field's validation decides |

A `postcheck` on the call that produces a value gives it a type, as does a `precheck` on the call that receives it; either turns `type-narrowing` into either nothing or a definite answer.

A call field with a `catch` returns its nested call's type or the `catch`'s, as a union; `[util]/throw` returns `never`, which adds nothing, and `skip` removes the members its schema fits. This union is provisional.

### Run errors

`execute` checks what a Run needs before any call starts: a Run id, and a trigger payload that fits `trigger.schema`. Each fails with a plain error, as does compile for a Query with no runtime.

### Config errors

| Code | Means |
|---|---|
| `invalid-config` | `config.set` refused config: it doesn't fit its service's config declaration, the declaration is malformed, or no service is registered under its name in the scope. Or a service that declares config had none filed when its first call needed an instance: that call fails, at its `address` ([Config](#config)) |

## The runtime API

**A runtime is one object for the whole process, and a Query runs on it in a scope.** A scope is whatever the runtime isolates by, such as `{tenantId}`, described by its scope schema, a zodly document. A runtime that isolates nothing, such as the node runtime, has one scope: the empty one, `{}`. A Query names both: `{runtime, scope, phases}`.

Core uses these members of a runtime, each by the Query's scope:

| Member | Is | Node runtime |
|---|---|---|
| `services` | a `ServiceRegistry`: the runtime's services, by scope and name, synchronously; compile looks up each key's service in it. Every scope has `util` unless the runtime registers another service under that name | its one scope holds the services the Query brings |
| `call(scope, key, fields)` | a service call's result. Core makes every call through it, with the key's fields, `{method, service, resource, confined}`, and the call's resolved fields | `Runtime`'s: the instance of the key's service in the scope, made on its first call ([Service instances](#service-instances)) |
| `cache` | a Cache: an [entry store](#entry-stores) per scope, whose entries outlive a Run | `fileCache('.cache')` |
| `runStates` | Run States: an entry store per scope and Run ([Entry stores](#entry-stores)) | `memoryRunStates()`; `fileRunStates(dir)` keeps them on disk |
| `env` | the environment's utilities, which debug output uses and each service instance receives: `log(text, {color, to})` writes a line of text, shown in the named colour if any, or kept at the destination `to`, which the runtime interprets; it may be async. A runtime may offer more ([Capabilities beyond the standard](#capabilities-beyond-the-standard)) | `log`: stdout in colour; with `to`, appended to that file |

And these, which core never calls, are its owner's:

| Member | Is |
|---|---|
| `config` | a `ConfigRegistry`: each service's config, by scope and name, checked as it's filed ([Config](#config)) |
| `register(scope)` | the runtime's own: registers a scope's services with `services.register(scope, name, service)`, for its owner to call before the scope's Queries run, or its config is set. It must be cheap to repeat: registering the same service again keeps its instance, and an instance is made on a service's first call, not here. The node runtime has none: its `query()` files a Query's services |
| `tearDown(scope)` | releases the service instances of a scope, or of every scope: for tests, a server shutting down, a runtime unloading tenants that have gone quiet |

**`Runtime` is the base a runtime extends.** It holds a `ServiceRegistry` and a `ConfigRegistry` keyed by its scope schema, a `memoryCache()`, `memoryRunStates()`, an empty `env` and `call`. Core binds a Query's scope into the runtime once, as it compiles, so nothing else in core carries it. A runtime gives it its scope schema, its `env`, its Cache, a config registry that stores elsewhere if it needs one, and `register`. The node runtime, `NodeRuntime`, is `Runtime` with `log` and a Cache on disk. A platform on Cloudflare Workers might look like this:

```javascript
import query, {Runtime, scopedCache} from 'microql/core'

class PlatformRuntime extends Runtime {
  constructor(bindings) {
    super({tenantId: ['string']})                           // the scope's schema
    this.env = {log: platformLog}
    this.cache = scopedCache(({tenantId}) => kvStore(bindings.CACHE, tenantId))  // an entry store in KV per tenant
    this.config = new D1Config(this.services, bindings.DB)  // a ConfigRegistry that stores in D1
  }

  async register({tenantId}) {
    for (const [name, service] of Object.entries(servicesOf(tenantId))) this.services.register({tenantId}, name, service)
  }
}

const runtime = new PlatformRuntime(bindings)  // one per isolate, shared by its requests; bindings: the Worker's KV, D1, secrets

// POST [automation]/execute
await runtime.register({tenantId})
await query({runtime, scope: {tenantId}, phases}, {runId})

// the settings UI
await runtime.register({tenantId})
await runtime.config.set({tenantId}, 'github', {token})   // invalid-config if github's declaration refuses it
```

The runtime keeps Run States, as it keeps the Cache; the platform names the Run, with `execute(compiled, {runId})`. Text is rendered by core, the same on every runtime: `format` (exported) is what `[util]/format`, `[util]/inspect`, debug output and validation messages all use.

### Capabilities beyond the standard

A Query should run on any runtime that has the services it names, without changes. So services, not Queries, deal with the runtime: a Query calls `[util]/log`, and `util` calls `env.log`.

- **A runtime may offer more keys in `env` than the standard ones.** That is how new capabilities are tried out.
- **A service that uses a key lists it in `requires`** (`defineService` takes it from the service definition). A Query naming a service whose keys the runtime's `env` lacks doesn't compile: `missing-capability`, at the first call to it, before anything runs.
- **Name a platform-specific service for what it does, not for the platform**: `[store]`, not `[otto]`. Another platform can then implement the same service, and Queries using it move with it.
- **To make a key standard, bring it back to the MicroQL maintainers**, with the services that use it. A key every runtime provides is one Queries can rely on everywhere. Avoid vendor prefixes (`x-fs`): renaming one when it becomes standard breaks everything that used it.

### Runtime environments

Core runs anywhere JavaScript does: a lint rule keeps node built-ins out of every core file. The environments MicroQL is built for, and what each means for a runtime and its services:

| Environment | Runtime | What services can rely on |
|---|---|---|
| **Node.js** | the node runtime (`microql`), the reference implementation: logs to stdout or to files, keeps the Cache on disk (`fileStore`) | a long-lived process with the file system, the network and any npm library, such as Puppeteer |
| **Cloudflare Workers** | one of the platform's own, extending `Runtime`, with `microql/core`: stores in KV, D1 or R2 behind the [entry store](#entry-stores) and `ConfigRegistry` interfaces | `fetch` and what the runtime gives them. No local file system, node APIs only in part (with the `nodejs_compat` flag), limits on each request's time and memory, and an isolate whose module scope several requests share ([Tenant isolation](#tenant-isolation)). A browser comes from Cloudflare's Browser Rendering, or from a separate backend service called over the network. |

**Services should support as many environments as they can.** A service that needs only `fetch` and its `env` runs on both. One that needs more, such as the local file system or a node-only library, says which environments it supports, and reaches what it can through `env`, so that a runtime for another environment can provide it.

### Services

**A service is an object with `lookup`, `supportedCalls` and `init`**, as the [Service Development Guide](service-guide.md) describes. Core asks `lookup` for each call's declaration while compiling; `supportedCalls()` is for a builder listing what a service offers, and core never pages through it. `init(env)` makes an **instance** of the service, whose `call` makes the Run's calls and whose `tearDown` releases what it holds. Turning a description of an API (an OpenAPI spec, an MCP server's tool list, a platform's route map) into a service belongs outside core, in whatever builds services for the platform. A service that discovers its calls asynchronously does so before it's registered, since `lookup` answers synchronously.

### Service instances

**The runtime keeps service instances; core keeps none.** Core makes every service call through `runtime.call(scope, key, fields)`. `Runtime` makes the instance of each service in each scope on the service's first call there, and keeps it for every later Run in that scope:

- **Each instance is made with `env` and its service's config**: `init({...env, config})`, where `config` is what's filed for the service in the scope. A service that declares config, with none filed, fails its first call with `invalid-config`.
- **Runs that start together share one instance**, so an async `init` runs once. An `init` that fails is forgotten, so the next call tries again.
- **An instance is released when what it was made from changes**: new config for its service (`config.set` with a different value, or `config.delete`), or another service registered under its name. Its next call makes a fresh one. That reaches the instances this runtime keeps: a runtime in another process, such as another Worker isolate, keeps its own until it releases them, and keeping them in step is its own business.
- **`tearDown(scope)` is the runtime's, and never core's to call.** A Run never calls it. The runtime's owner calls it when done with a scope's instances, or calls `tearDown()` for every scope's: a test's `after()`, a server shutting down, a platform unloading tenants that have gone quiet. A script that's done may simply `process.exit()`.
- **Runs may overlap.** Core keeps no state between Runs: each Run's state is its own, and Run States and the Cache are keyed by scope, form and input, Run States by Run too. An instance serves every Run in its scope, so services keep no per-Run state of their own ([Service Development Guide § init and tearDown](service-guide.md#init-and-teardown)).
- **The node runtime has one scope.** Its `query()` files the services and config a Query brings there as the scope's only ones, and keeps each instance for later Queries that bring the same service and config. Two Queries running at once that bring different services under one name replace each other's: run them one after another, or give each a `NodeRuntime` of its own.

### Config

**A service declares its config, and the runtime keeps it, by scope and name.** `config.set(scope, name, value)` checks the value against the config declaration of the service registered under the same scope and name, and refuses it with `invalid-config` when it doesn't fit, when the declaration is malformed, or when the scope has no service by that name. So config is checked once, as it's filed, and an instance is made only with config its service accepts. `config.delete(scope, name)` removes it.

`ConfigRegistry` keeps config in memory. A runtime that keeps it elsewhere extends it, overriding `get(scope, name)`, `write(scope, name, value)` and `erase(scope, name)`; `set` and `delete` check and release instances as they do in memory:

```javascript
class D1Config extends ConfigRegistry {
  constructor(services, db) {
    super(services)
    this.db = db
  }
  async get({tenantId}, name) { /* SELECT the value for (tenantId, name) */ }
  async write({tenantId}, name, value) { /* UPSERT it */ }
  async erase({tenantId}, name) { /* DELETE it */ }
}
```

**OAuth is the runtime's to resolve.** A service that needs it declares an `oauth` type in its config, with the provider's details ([Service Development Guide § Configuration](service-guide.md#configuration)). `configSchemaOf(service.config)` reads it as an object tagged `oauth`, whose meta holds `{authorizeUrl, tokenUrl, scopes}`, and whose fields `clientId`, `clientSecret` and `refreshToken` are each tagged `internal`: the runtime's to fill, not fields for a person to edit. The platform finds `oauth` tags in a service's config schema, runs the consent flow, and files what it gets with `config.set`, keeping its OAuth app's client ID and secret wherever it keeps config. The service's `init` exchanges the refresh token for an access token. The fields are optional, since none is there before the flow has run.

### Tenant isolation

A platform serving several tenants in one process, such as a Cloudflare worker handling many requests, must keep each tenant's credentials, cached results and service state from the others. MicroQL's part is to keep core free of state, so that **isolation is the runtime's, and services never see an isolation boundary**: the runtime keys and stores tenant data, and a service only uses what its runtime gives it.

**Within a process, a scope per tenant.** The platform runs each Query in its tenant's scope, `{tenantId}`, on one runtime it keeps for the process. The runtime keys services, config, instances and stored results by scope, and each instance is made with `env` and its own service's config in its scope. What this gives, and what it costs:

- **A service never holds a tenant identifier**, so it can't ask for another tenant's config or cache, and can't hand back the wrong keying: the runtime does the keying, and doesn't rely on services to behave.
- **Every instance is one tenant's**, so what it holds (a token, a connection, a Puppeteer `BrowserContext`, which keeps its own cookies and storage within a shared browser) is that tenant's.
- **`env` is every tenant's.** What differs by tenant reaches a service through its config, never through `env`.
- **The Cache and Run States are keyed by scope**, so two tenants making an identical call never share an entry, and a store knows whose Runs it holds.
- **Memory is still shared.** Every tenant's instances run in one process, with the same modules. A service that keeps data in module scope, or on its definition, carries it from one tenant to the next, and a hostile service can read anything in the process. Scopes guard against careless services, not hostile ones. Static checks for mutable module state catch the common accidents, never a service written to evade them.
- **Instances multiply**: one per service per tenant, held until the runtime releases them. A platform with many tenants tears down the instances of tenants that go quiet, with `tearDown(scope)`.

**Across processes, complete isolation.** Each tenant's Runs execute in a process (or isolate) of their own: on Cloudflare, a worker per tenant (Workers for Platforms dispatch namespaces), or tenant code loaded into an isolate of its own. What this gives, and what it costs:

- **Nothing is shared**, so a hostile service, or a hostile Query, reaches only its own tenant's data. This is the boundary to have when tenants write their own services and Queries.
- **Each process has its own runtime and instances**: startup cost per tenant, no instances shared across tenants, and more to deploy and monitor.

MicroQL needs nothing more for either: core is stateless, and both are ways to build a runtime. A platform can start with a scope per tenant and move to complete isolation when tenants write their own code, without changing its Queries or its services.

## A suggested architecture

None of this is required. It is one way to build a platform for automations on MicroQL.

- **A runtime per process.** Keep one runtime for the process, or the isolate, and in each request register the scope's services before running its Queries or setting its config ([The runtime API](#the-runtime-api)).
- **Runs.** Keep a record per Run: its Query version, its scope, its trigger payload, its status. Give each Run an id, keep its Run State in whatever database your runtime's `runStates` use, and keep finished Runs as history. To rerun everything, start a new Run.
- **An editor.** Call `plan()` on every edit, and show `errors` beside the fields they name. Show a call's results by looking up its form hash in the selected Run's Run State. Drive the phase view from `onUpdate`, and mark phases stale with the `resultHash` and `upstream` of their `done` updates. "Run this phase" is a [target](#targets), and "stop" is an abort.
- **Triggers.** Turn a webhook, a schedule or a queue message into a call to `execute` with its payload as `trigger`. Keep the trigger's configuration (its kind, its path, its timing) beside `trigger.schema` in the Query, or in your own store.
