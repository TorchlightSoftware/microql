# Runtime Integration

This guide is for building a platform on MicroQL: a visual builder, a hosted automation service, a Cloudflare Worker. It covers the API core exposes beyond `query()`: compiling and planning a Query without running it, running part of a Query, receiving progress, storing results, and supplying the platform capabilities core doesn't have.

If you only want to run Queries from node, the [README](../README.md) is all you need.

## Entry points

`import 'microql'` resolves by conditional export:

- under `node`, to `node.js` — core plus the node runtime, wired in by default, plus `fileStore` and `nodeRuntime`;
- under `workerd` (Wrangler resolves it automatically) and everywhere else, to `index.js` — core only, platform-free. A lint rule keeps node built-ins out of every core file.

Both export:

| Export | Is |
|---|---|
| `query(config, options)` | compile, execute, select |
| `compile(config)` | the Query as a plain tree of phases and calls; throws on compile-time errors |
| `execute(compiled, options)` | run a compiled Query; returns each executed phase's result |
| `plan(config, {trigger})` | everything a view needs, without running anything |
| `applySelection(results, select)` | what `select` names |
| `addressToPath(plan, address)`, `pathToAddress(plan, path)` | Service Call Addresses ↔ JSON paths |
| `memoryStore()` | an entry store in memory |
| `defaultRuntime` | the platform-free runtime |
| `util` | the built-in service |

## Running a Query

```javascript
const compiled = compile(config)
const results = await execute(compiled, {runState, trigger, target, onUpdate})
```

| Option | Is |
|---|---|
| `runState` | the Run's entry store; default a fresh `memoryStore()` |
| `trigger` | the payload `$trigger` holds |
| `target` | a phase, `'$listings'`: run it and what it depends on, nothing after it |
| `onUpdate` | a callback receiving progress updates |

`query(config, options)` takes the same options.

### The Run State

Execution always works inside one Run State, and never chooses or switches Runs: creating Runs, labelling them, keeping their history is the platform's job. The engine writes every call's result to the Run State as it goes, and reuses any result already there. That one rule is resume after an interruption, rerunning part of a Query, and what a results view reads:

- Run against a fresh store: everything runs.
- Run against the store of an interrupted Run: only what didn't finish runs.
- Rerun everything: start a fresh store.

When a call fails, the Run still lets the calls already in flight finish and record their results before it reports the failure, so resuming never repeats them.

### Targets

`target: '$listings'` runs the phase and every phase it depends on, then stops. Upstream results already in the Run State are reused; the target phase's own calls always rerun, inside its iterations too. Later phases don't run. This is the "run up to and including this phase" a builder offers.

A target is a phase. An edit needs no target at all: an edited call has a new form, so running the whole Query against the same Run State calls only the edited call and whatever its new output reaches; everything else is read back.

### Progress updates

`onUpdate` is called with plain, serializable records, in the order they happen:

```javascript
{kind: 'phase', name: 'listings', status: 'running', startedAt: '2026-10-08T09:00:00.000Z'}
{kind: 'phase', name: 'listings', status: 'done', startedAt: '2026-10-08T09:00:00.000Z', duration: 4120}
{kind: 'phase', name: 'listings', status: 'failed', startedAt: '2026-10-08T09:00:00.000Z', duration: 512, error: '[$listings.@1a1 - GET [scraper]/extract] Timed out after 30000ms'}
```

A phase with no update hasn't run. A running phase reports when it started, never partial output; its calls' results are in the Run State as they finish. The callback is synchronous and its return value is ignored, so wiring it to a websocket, a queue or a polling table is one line:

```javascript
await execute(compiled, {runState, onUpdate: update => socket.send(JSON.stringify(update))})
```

Reporting never fails a Run: if `onUpdate` throws, the error is logged and the Run carries on.

### Triggers

`trigger` is a Query-level block the platform interprets: `{trigger: {kind, ...config}}`. Core does not know trigger kinds; it only makes the payload you pass at start available as `$trigger`, a node like `$given`:

```javascript
// a Stripe checkout webhook onboards a new customer
const onboarding = {
  trigger: {kind: 'webhook', path: '/hooks/stripe/checkout'},
  services: {hubspot, customerio, slack},
  phases: {
    contact: ['POST [hubspot]/contacts', {email: '$trigger.customer_details.email', plan: '$trigger.metadata.plan'}],
    welcome: ['POST [customerio]/campaigns', {campaign: 'welcome', email: '$trigger.customer_details.email'}],
    notified: ['POST [slack]/post', {channel: '#sales', text: 'New customer', contact: '$contact'}]
  }
}

await query(onboarding, {trigger: stripeEvent.data.object})
```

Runs with different payloads never share a result.

## Planning without running

`plan(config, {trigger})` is pure and cheap enough to call on every edit. It returns:

| Field | Is |
|---|---|
| `query` | the Query's form hash |
| `roots` | `$given` and `$trigger` as root nodes ahead of the first column, with their types |
| `columns` | the phases that run together, in order |
| `phases` | each phase's `name`, `dependencies`, `formHash` and return type |
| `calls` | every call's `address`, `path`, `key`, `formHash`, readable `form`, and `types` |
| `warnings` | compile warnings and type mismatches — never errors |

A view finds a call's results by looking up its form hash in the Run State (`runState.list(formHash)`). Two addresses with one form hash are identical calls that run once.

### Terms

Four independent axes for talking about a Query and what changes in it.

| Term | Means | Example |
|---|---|---|
| **key** | canonical identity of a service or other Query constituent | `POST [sms]/send`, a phase name, a binding name |
| **address** | canonical location within the Query tree — positional, never a hash | `$listings.@1a2` |
| **form** | canonical structure of a call: its definition, with each reference replaced by the **form hash** of what it points to | — |
| **result** | what a call produced | — |
| **input hash** | hash of a call's resolved inputs on one execution | — |

A moved subtree whose inputs didn't change has a new address and the same form, so its results are kept and found at the new location. An edited call has the same address and a new form, as does everything downstream of it.

### Service Call Addresses

An address names one call within one Query version — for editors, logs and errors. It is calculated, never stored in the Query, and never valid as a reference.

- Calls are numbered, service-typed fields are lettered, alternating: `$listings.@1` is the phase's first call; `@1a` is that call's first service-typed field; `@1a2` is the second call in that field's chain. An address that names a call always ends in a digit.
- Field letters follow sorted key order (the ordering RFC 8785 uses), so letters never depend on how a document was written. `onError` is lettered along with the arguments.
- A call's fields follow its address by name: `$listings.@1.url`. Field names that begin with `@` (JSON-LD's `@type`) stay ordinary path segments.
- The global handler is addressed `settings.onError.@1`.
- An address is only meaningful against the Query version it came from, so errors carry `address`, `key` and `query` (the Query's form hash).

`addressToPath(plan, address)` and `pathToAddress(plan, path)` convert between an address and a JSON path into the Query document, so an editor can map a selection to a call and back.

### Forms

A form holds only its own call — its key, its arguments, the settings that change what it returns — plus the hashes of what it references. It stays small, is readable (`plan()` returns it), and its hash changes exactly when it or anything upstream changes:

- `$phase` is replaced by that phase's form hash;
- `$given` and `$trigger` count by their values;
- `@`, `@name` and `@err` count as the form of what flows in, which inside an iteration is "the input of the call that owns it";
- operational settings (`timeout`, `retry`, `debug`, `cache`) don't count.

Hashes are SHA-256 over canonical JSON, computed synchronously in pure JS (`@noble/hashes`) so they cost the same on every platform; `plan()` is therefore synchronous. Prior art: Nix distinguishes the hash of what a build step *is* (input-addressed, our form hash) from the hash of what it *produced*; Clojure treats code as data with value equality, which is what a form is.

### Types

`plan()` infers a type for every argument and call, in seven types: text, number, boolean, datetime, list (with element type), object (with fields), and mixed — TypeScript's `any`, which zod's `any`, `unknown` and unions map to, as does a call with no schema. Optional and nullable are one flag.

- An argument's **expected** type comes from the service's `precheck` schema; a service-typed argument may declare the return its service must have (`util.filter` wants boolean).
- Its **actual** type is a literal's own type, a phase's return type, or the flow at that point, with paths walking into them.
- A call's **return** type comes from its `postcheck` schema.

A mismatch is a warning in `plan().warnings`. It never blocks: run-time validation stays the authority.

## Storage

### Entry stores

Results are stored by (form hash, input hash): one entry per distinct input, several per form inside an iteration. An entry store is three async functions, so it may live anywhere — a Durable Object, KV, a database:

```javascript
{
  get(form, input),         // the entry, or undefined
  set(form, input, entry),
  list(form)                // every entry for a form
}
```

A Run State entry holds `address`, `input`, `inputs` (resolved arguments), `status` (`done` or `failed`), `output` or `error` (`{message, attempts, at}`), `startedAt` and `duration`. Only `done` entries are reused, so a failed call runs again on resume.

### The Cache

The Cache reuses results *across* Runs, for calls with `cache` set. It is an entry store with the same keys. An entry is reused while it is younger than the call's ttl — `cache: {ttl}`, else `settings.cache.ttl`, else seven days — and records `created` and `expires`, so a store can prune expired entries without knowing any ttl. Pruning is the store's business: the node `fileStore` sweeps expired entries once, before its first use; a platform store prunes however suits it.

## The runtime

Core is platform-free. A **runtime** is the small set of capabilities core can't provide itself, injected as `config.runtime`:

| Capability | Node runtime | Default runtime |
|---|---|---|
| `print(text, {color})` | colourised stdout | `console.log` |
| `inspect(value, options)` | `util.inspect` | JSON |
| `recordFailure(location, record)` | a JSON file per failure | `console.error` |
| `cache` | `fileStore('.cache')` | `memoryStore()` |

The Run State is per Run, so it is an option of `execute`, not a capability of the runtime.

### init and tearDown

Before a Run begins, MicroQL calls an optional `init(runtime)` on each service the plan uses, at most once per runtime; `util` uses it to reach `print` and `recordFailure`. `init` receives instance-wide capabilities only — per-Run state never passes through a service — so a platform may keep its initialized services in a long-lived registry. After a Run, MicroQL calls an optional `tearDown()` on each service the Run used.

### Supplying services

Services arrive through `config.services` as plain objects. A platform that dispatches calls itself — to HTTP routes, to tenant code — wraps its dispatcher in service objects that answer to service key parts (`{service, resource, method}`); see the [Service Development Guide](service_guide.md).
