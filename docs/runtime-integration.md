# Runtime Integration

This guide is for building on MicroQL beyond a node script: an editor for Queries, a hosted automation service, an app running on Cloudflare Workers. It covers what core exposes beyond `query()`, the spec a runtime must satisfy, and how results are stored.

If you only want to run Queries from node, the [README](../README.md) is all you need.

## Core, runtime and platform

Three parties take part in running a Query, and each owns different things:

| Party | Is | Owns |
|---|---|---|
| **Core** | `compile`, `plan` and `execute`, imported as `microql/core` | what a Query means: references, chains, `each`, retries, timeouts, error handling, scheduling, and which results to reuse |
| **Runtime** | an object of environment capabilities, passed as `config.runtime` | output, failure records, and the [Cache](#the-cache) store |
| **Platform** | whatever calls core: a node script, a server, an editor | [Runs](#runs): which [Run State](#storage) each one gets, where results are shown, and when stores are cleared |

**Core is kept free from environment dependencies: the file system, the network and so on.** A runtime provides these. It is injected into core and into the [service initializers](#services). MicroQL ships one runtime, the **node runtime**, as the reference implementation. Any object that satisfies [the runtime API](#the-runtime-api) is a runtime.

The platform is yours. [A suggested architecture](#a-suggested-architecture) at the end shows one way to build one, but MicroQL requires none of it.

## Entry points

| Import | Resolves to | Is |
|---|---|---|
| `microql` | `node.js` | core with the node runtime wired in. `query()` uses the node runtime, and a fresh in-memory Run State unless you pass one. Also exports `nodeRuntime` and `fileStore`. |
| `microql/core` | `index.js` | core alone, with no runtime of its own. `execute` refuses to run without a `runtime` and a `runState`. A lint rule keeps node built-ins out of every core file. |

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
| `util` | the built-in service |

## Storage

### Entry stores

**An entry store is a dumb key-value store.** Core decides the keys and the entries; the store decides only where they live. Keys are pairs of strings, a [form hash](#forms) and an input hash (the hash of a call's resolved input fields on one execution). So a form holds one entry per distinct input, and several inside an iteration.

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

**A Run State entry** holds `address`, `input`, `inputs` (the resolved input fields), `status` (`done` or `failed`), `output` or `error` (`{message, attempts, at}`), `startedAt` and `duration`. Core reuses only `done` entries, so a failed call runs again on resume.

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
- The global `onError` handler does not run.
- Calls already sent to a service may still complete on the far side; services are never told about the abort.

### Progress updates

`onUpdate` is called with plain, serializable records, in the order they happen:

```javascript
{kind: 'phase', name: 'listings', status: 'running', startedAt: '2026-10-08T09:00:00.000Z'}
{kind: 'phase', name: 'listings', status: 'done', startedAt: '…', duration: 4120, resultHash: '9f2c…', upstream: {categories: '41ab…'}}
{kind: 'phase', name: 'listings', status: 'failed', startedAt: '…', duration: 512, error: '[$listings.@1a1 - GET [scraper]/extract] Timed out after 30000ms'}
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
| `query` | the Query's form hash |
| `roots` | `$given` (when the Query has one) and `$trigger`, as root nodes ahead of the first column, with their [types](#types) |
| `columns` | the phases that run together, in order |
| `phases` | each phase's `name`, `dependencies`, `formHash` and return type |
| `calls` | every call's `address`, `path`, `key`, `formHash`, readable `form`, and `types` |
| `errors` | type mismatches, by address |
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

- **Numbering.** Calls are numbered and service-typed fields are lettered, alternating. `$listings.@1` is the phase's first call, `@1a` is that call's first service-typed field, and `@1a2` is the second call in that field's chain. An address that names a call always ends in a digit.
- **Letters.** Field letters follow sorted key order (the ordering RFC 8785 uses), so letters never depend on how a document was written. `onError` is lettered along with the other fields.
- **Fields.** A call's fields follow its address by name: `$listings.@1.url`. Field names that begin with `@` (JSON-LD's `@type`) stay ordinary path segments.
- **The global handler** is addressed `settings.onError.@1`.
- **Versions.** An address is only meaningful against the Query version it came from, so errors carry `address`, `key` and `query` (the Query's form hash).

`addressToPath(plan, address)` and `pathToAddress(plan, path)` convert between an address and a JSON path into the Query document, so an editor can map a selection to a call and back.

### Forms

A form is a subtree of the Query, beginning at one service call. It holds the call's key, its fields, the settings that change what it returns, and the hashes of what it references. A form hash changes when anything in the subtree changes:

- `$phase` is replaced by that phase's form hash;
- `$given` and `$trigger` count by their values;
- `@`, `@name` and `@err` count as the form of what flows in, which inside an iteration is "the input of the call that owns it";
- a call's `timeout`, `retry`, `debug` and `cache` settings don't count. They change how a call runs, not what it returns, so editing them keeps its results.

Hashes are SHA-256 over canonical JSON, computed synchronously in pure JS (`@noble/hashes`), so they cost the same everywhere and `plan()` is synchronous.

### Types

`plan()` infers a type for every service call and every input field, in seven types: text, number, boolean, datetime, list (with element type), object (with fields), and mixed. Mixed is TypeScript's `any`: zod's `any`, `unknown` and unions map to it, as does a call with no schema. Optional and nullable are one flag.

- A field's **expected** type comes from the service's input schema. A service-typed field may declare the return its service must have; `util.filter` wants boolean.
- Its **actual** type is a literal's own type, a phase's return type, or the flow at that point, with paths walking into them.
- A call's **return** type comes from the service's output schema.

The schemas are the service's own `_validators` today; see the [Service Development Guide](service_guide.md). Type mismatches are listed in `plan().errors`. `plan()` never runs anything, and run-time validation still decides whether a call runs.

## The runtime API

A runtime is a plain object passed as `config.runtime`:

| Capability | Must | Node runtime |
|---|---|---|
| `print(text, {color})` | show a line of output | colourised stdout |
| `inspect(value, options)` | render a value as text, for output and validation messages | `util.inspect` |
| `recordFailure(location, record)` | keep a failure for later; may be async | a JSON file per failure under `location` |
| `cache` | an [entry store](#entry-stores) whose entries outlive a Run | `fileStore('.cache')` |

The Run State is per Run, so it is an option of `execute`, not a capability of the runtime.

### Services

**Services are code.** Each is an object of async functions, one per resource, as the [Service Development Guide](service_guide.md) describes. Core needs nothing more. Turning a description of an API (a schema document, an OpenAPI spec) into such an object belongs outside core, in whatever builds services for the platform.

### Service init and tearDown

Before a Run begins, core calls an optional `init(runtime)` on each service the plan uses, at most once per runtime; `util` uses it to reach `print` and `recordFailure`. `init` receives instance-wide capabilities only — per-Run state never passes through a service — so a platform may keep its initialized services in a long-lived registry. After a Run, core calls an optional `tearDown()` on each service the Run used.

## A suggested architecture

None of this is required. It is one way to build a platform for automations on MicroQL.

- **Runs.** Keep a record per Run: its Query version, its trigger payload, its status. Give each Run its own Run State store, in whatever database you use, and keep finished Runs as history. To rerun everything, start a new Run.
- **An editor.** Call `plan()` on every edit, and show `errors` beside the fields they name. Show a call's results by looking up its form hash in the selected Run's Run State. Drive the phase view from `onUpdate`, and mark phases stale with the `resultHash` and `upstream` of their `done` updates. "Run this phase" is a [target](#targets), and "stop" is an abort.
- **Triggers.** Turn a webhook, a schedule or a queue message into a call to `execute` with its payload as `trigger`. Keep the trigger's configuration (its kind, its path, its timing) beside `trigger.schema` in the Query, or in your own store.
