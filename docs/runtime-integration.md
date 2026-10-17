# Runtime Integration

This guide is for building on MicroQL beyond a node script: an editor for Queries, a hosted automation service, an app running on Cloudflare Workers. It covers what core exposes beyond `query()`, the spec a runtime must satisfy, and how results are stored.

If you only want to run Queries from node, the [README](../README.md) is all you need.

## Core, runtime and platform

Three parties take part in running a Query, and each owns different things:

| Party | Is | Owns |
|---|---|---|
| **Core** | `compile`, `plan` and `execute`, imported as `microql/core` | what a Query means: references, chains, `each`, retries, timeouts, error handling, scheduling, and which results to reuse |
| **Runtime** | an object of environment capabilities, passed as `config.runtime` | output, failure records, the [Cache](#the-cache) store, configuration, and the [service instances](#services) |
| **Platform** | whatever calls core: a node script, a server, an editor | [Runs](#runs): which [Run State](#storage) each one gets, where results are shown, and when stores are cleared |

**Core is kept free from environment dependencies: the file system, the network and so on.** A runtime provides these. It is injected into core and into the [service initializers](#services). MicroQL ships one runtime, the **node runtime**, as the reference implementation. Any object that satisfies [the runtime API](#the-runtime-api) is a runtime.

The platform is yours. [A suggested architecture](#a-suggested-architecture) at the end shows one way to build one, but MicroQL requires none of it.

## Entry points

| Import | Resolves to | Is |
|---|---|---|
| `microql` | `index.js` | core with the node runtime wired in. `query()` uses the node runtime, and a fresh in-memory Run State unless you pass one. Also exports `nodeRuntime` and `fileStore`. |
| `microql/core` | `core.js` | core alone, with no runtime of its own. `execute` refuses to run without a `runtime` and a `runState`. A lint rule keeps node built-ins out of every core file. |

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
| `serviceRegistry()` | `init(services)` and `tearDown()` for a runtime to spread into itself: keeps one instance per service name and service, each given only the config filed under its name ([Service instances](#service-instances)) |
| `serviceSmokeTests(service, {runtime, config})` | a table of tests checking a service against the service spec ([Service Development Guide § Testing services](service-guide.md#testing-services)) |
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

### Two stores, two owners

| Store | Holds results for | Supplied by | Passed as |
|---|---|---|---|
| **Run State** | one [Run](#runs) | the platform | `execute(compiled, {runState})` |
| **Cache** | every Run, for calls with `cache` set | the runtime | `runtime.cache` |

**A Run State entry** holds `address`, `input`, `inputs` (the resolved input fields), `reads` (for a call that holds others, what they read from outside it, by reference), `status` (`done` or `failed`), `output` or `error` (`{message, attempts, at}`), `startedAt` and `duration`. Core reuses only `done` entries, so a failed call runs again on resume. A failure a `catch` handled is the holding call's output, as [error data](#errors-as-data), so it is stored and reused like any other result.

### The Cache

Core reuses a Cache entry while it is younger than the call's ttl: `cache: {ttl}`, else `settings.cache.ttl`, else seven days. Each entry records `created` and `expires`, so a store can prune expired entries without knowing any ttl. Pruning is the store's business. The node runtime's `fileStore` sweeps expired entries once, before its first use.

## Runs

**A Run is one or more executions of a Query against one Run State.** It is a concept, not engine state: core keeps no record of Runs, and the Run State is their only trace. Core works inside whichever Run State it is handed and never chooses or switches Runs. Deciding what a Run is, and labelling it or keeping its history, is the platform's job.

Core writes every call's result to the Run State as it goes, and reuses any result already there. That one rule covers three things:

- **A fresh Run:** against an empty store, everything runs.
- **Resume after an interruption:** against a store holding some results, only what's missing runs.
- **Rerunning part of a Query:** run again against the same store with a [target](#targets).

To rerun everything, the platform starts a new store. When a call fails, core lets the calls already in flight finish and record their results before it reports the failure, so resuming never repeats them.

## Running a Query

```javascript
import {compile, execute, memoryStore} from 'microql/core'

const compiled = compile({phases, services, runtime})  // runtime: your own, or the node runtime
const results = await execute(compiled, {runState: memoryStore(), trigger, target, signal, onUpdate})
```

| Option | Is |
|---|---|
| `runState` | required: the Run's [entry store](#entry-stores) |
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
- Results already finished stay in the Run State.
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
await execute(compiled, {runState, onUpdate: update => socket.send(JSON.stringify(update))})
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

To show a call's results, the platform looks them up by the call's form hash in the Run State: `runState.list(formHash)`. Two addresses with one form hash are identical calls, which run once.

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
| `unknown-service` | no service is registered under the key's name |
| `not-a-service` | the service lacks one of `lookup`, `supportedCalls` and `init` |
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

`execute` checks what a Run needs before any call starts. Besides the plain errors for a missing runtime or Run State, and a trigger payload that doesn't fit `trigger.schema`:

| Code | Means |
|---|---|
| `missing-capability` | a service the Query uses `requires` a runtime key this runtime doesn't provide (`config`, for a service that declares one); `address` is the first call to it |
| `invalid-config` | the config filed under the name of a service the Query uses doesn't fit its config declaration (or there is none), or the declaration is malformed; `address` is the first call to it |

## The runtime API

A runtime is a plain object passed as `config.runtime`:

| Capability | Must | Node runtime |
|---|---|---|
| `log(text, {color, to})` | write a line of text: shown, in the named colour if any; or kept at the destination `to`, which the runtime interprets; may be async | stdout in colour; with `to`, appended to that file |
| `cache` | an [entry store](#entry-stores) whose entries outlive a Run | `fileStore('.cache')` |
| `init(services)` | instances of the services a Run uses, given by name as `config.services` has them, each initialized with only the `config` filed under its name; may be async, as may each service's `init`. Core calls it as a method of the runtime, and waits for it before the Run's first call ([Services](#services)) | `serviceRegistry()`: one instance per name and service, kept until `tearDown()` |
| `tearDown()` | optional, not a capability services use: releases the service instances the runtime keeps | `serviceRegistry()`: calls each instance's `tearDown` once |
| `config` | optional: each service's configuration, such as credentials, filed under the service's name and scoped to the tenant the runtime serves: `{github: {token}}`. A service declares the config it reads ([Service Development Guide § Configuration](service-guide.md#configuration)), and a Run checks what's filed under each service's name against its declaration before it starts | none; a script adds it: `{...nodeRuntime, config}` |

The Run State is per Run, so it is an option of `execute`, not a capability of the runtime. Text is rendered by core, the same on every runtime: `format` (exported) is what `[util]/format`, `[util]/inspect`, debug output and validation messages all use.

### Capabilities beyond the standard

A Query should run on any runtime that has the services it names, without changes. So services, not Queries, deal with the runtime: a Query calls `[util]/log`, and `util` calls `runtime.log`.

- **A runtime may offer more keys than the standard ones.** That is how new capabilities are tried out.
- **A service that uses a key lists it in `requires`** (`defineService` takes it from the service definition). A Run on a runtime without it fails before any call starts, with `missing-capability`, rather than halfway through.
- **Name a platform-specific service for what it does, not for the platform**: `[store]`, not `[otto]`. Another platform can then implement the same service, and Queries using it move with it.
- **To make a key standard, bring it back to the MicroQL maintainers**, with the services that use it. A key every runtime provides is one Queries can rely on everywhere. Avoid vendor prefixes (`x-fs`): renaming one when it becomes standard breaks everything that used it.

### Runtime environments

Core runs anywhere JavaScript does: a lint rule keeps node built-ins out of every core file. The environments MicroQL is built for, and what each means for a runtime and its services:

| Environment | Runtime | What services can rely on |
|---|---|---|
| **Node.js** | the node runtime (`microql`), the reference implementation: logs to stdout or to files, keeps the Cache on disk (`fileStore`) | a long-lived process with the file system, the network and any npm library, such as Puppeteer |
| **Cloudflare Workers** | one of the platform's own, with `microql/core`: stores in KV, D1 or R2 behind the [entry store](#entry-stores) interface | `fetch` and what the runtime gives them. No local file system, node APIs only in part (with the `nodejs_compat` flag), limits on each request's time and memory, and an isolate whose module scope several requests share ([Tenant isolation](#tenant-isolation)). A browser comes from Cloudflare's Browser Rendering, or from a separate backend service called over the network. |

**Services should support as many environments as they can.** A service that needs only `fetch` and its runtime's capabilities runs on both. One that needs more, such as the local file system or a node-only library, says which environments it supports, and reaches what it can through the runtime, so that a runtime for another environment can provide it.

### Services

**A service is an object with `lookup`, `supportedCalls` and `init`**, as the [Service Development Guide](service-guide.md) describes. Core asks `lookup` for each call's declaration while compiling; `supportedCalls()` is for a builder listing what a service offers, and core never pages through it. `init(runtime)` makes an **instance** of the service, whose `call` makes the Run's calls and whose `tearDown` releases what it holds. Turning a description of an API (an OpenAPI spec, an MCP server's tool list, a platform's route map) into a service belongs outside core, in whatever builds services for the platform. A service that discovers its calls asynchronously does so before the Query is compiled, since `lookup` answers synchronously.

### Service instances

**The runtime keeps service instances; core keeps none.** Before a Run's first call, core calls `runtime.init(services)` with the services the Run uses, by the names the Query gives them, and makes the Run's calls on the instances it returns. The runtime decides when to make an instance and how long to keep it:

- **`serviceRegistry()` is the plain way to do it.** Spread into a runtime, it makes one instance of each service under each name for the runtime it's called on, given the config filed under that name, the first time a Run uses the service, and reuses it for every later Run. Runs that start together wait on the same `init`, so an async `init` runs once. `tearDown()` releases them all, calling each instance's `tearDown` once, and the next Run makes fresh ones. An `init` that fails is forgotten, so the next Run tries again. The node runtime is built with it.
- **A runtime spreads `serviceRegistry()` in, rather than writing its own `init`.** Scoping to a tenant needs no `init` of its own: a runtime scoped to a tenant, with the registry spread in, keeps that tenant's instances ([Tenant isolation](#tenant-isolation)). A runtime that does write its own `init(services)`, to load instances up front say, takes on everything the registry does, including giving each instance only the config filed under its service's name.
- **`tearDown()` is the runtime's, and never core's to call.** A Run never calls it. The runtime's owner calls it when done with the instances: a server shutting down, a test's `after()`, a platform unloading a tenant. A script that's done may simply `process.exit()`.
- **Runs may overlap.** Core keeps no state between Runs: each Run's state is its own, and the Run State and Cache are the platform's, keyed by form and input. An instance serves every Run of its runtime, so services keep no per-Run state of their own ([Service Development Guide § init and tearDown](service-guide.md#init-and-teardown)).

### Tenant isolation

A platform serving several tenants in one process, such as a Cloudflare worker handling many requests, must keep each tenant's credentials, cached results and service state from the others. MicroQL's part is to keep core free of state, so that **isolation is the runtime's, and services never see an isolation boundary**: the runtime keys and stores tenant data, and a service only uses what its runtime gives it.

**Within a process, a runtime scoped to a tenant.** The platform passes each Query a runtime scoped to its tenant: one runtime in the strict sense, but a scoped view of its state, whose `config`, `cache` and instances are that tenant's. So configuration is keyed by tenant and service name: the scoped runtime picks the tenant's, and each instance gets its service's. With `serviceRegistry()`, a scoped runtime is a runtime of its own (`{...runtime, config: configOf(tenant), cache: cacheOf(tenant)}`, kept per tenant), so it makes and keeps its own instances. What this gives, and what it costs:

- **A service never holds a tenant identifier**, so it can't ask for another tenant's config or cache, and can't hand back the wrong keying: the runtime does the keying, and doesn't rely on services to behave.
- **Every instance is one tenant's**, so what it holds (a token, a connection, a Puppeteer `BrowserContext`, which keeps its own cookies and storage within a shared browser) is that tenant's.
- **The Cache must be scoped too.** Cache entries are keyed by form and input, so two tenants making an identical call share an entry in a shared cache: give each scoped runtime its own cache, or a cache keyed by tenant.
- **Memory is still shared.** Every tenant's instances run in one process, with the same modules. A service that keeps data in module scope, or on its definition, carries it from one tenant to the next, and a hostile service can read anything in the process. Scoped runtimes guard against careless services, not hostile ones. Static checks for mutable module state catch the common accidents, never a service written to evade them.
- **Instances multiply**: one per service per tenant, held until the runtime releases them. A platform with many tenants tears down the instances of tenants that go quiet.

**Across processes, complete isolation.** Each tenant's Runs execute in a process (or isolate) of their own: on Cloudflare, a worker per tenant (Workers for Platforms dispatch namespaces), or tenant code loaded into an isolate of its own. What this gives, and what it costs:

- **Nothing is shared**, so a hostile service, or a hostile Query, reaches only its own tenant's data. This is the boundary to have when tenants write their own services and Queries.
- **Each process has its own runtime and instances**: startup cost per tenant, no instances shared across tenants, and more to deploy and monitor.

MicroQL needs nothing more for either: core is stateless, and both are ways to build a runtime. A platform can start with scoped runtimes and move to complete isolation when tenants write their own code, without changing its Queries or its services.

## A suggested architecture

None of this is required. It is one way to build a platform for automations on MicroQL.

- **Runs.** Keep a record per Run: its Query version, its trigger payload, its status. Give each Run its own Run State store, in whatever database you use, and keep finished Runs as history. To rerun everything, start a new Run.
- **An editor.** Call `plan()` on every edit, and show `errors` beside the fields they name. Show a call's results by looking up its form hash in the selected Run's Run State. Drive the phase view from `onUpdate`, and mark phases stale with the `resultHash` and `upstream` of their `done` updates. "Run this phase" is a [target](#targets), and "stop" is an abort.
- **Triggers.** Turn a webhook, a schedule or a queue message into a call to `execute` with its payload as `trigger`. Keep the trigger's configuration (its kind, its path, its timing) beside `trigger.schema` in the Query, or in your own store.
