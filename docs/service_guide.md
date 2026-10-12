# MicroQL Service Development Guide

This guide is the spec for MicroQL services: what core asks of a service, how a service declares its operations, and how to write one. `util`, MicroQL's builtin service, is the reference implementation ([services/util.js](../services/util.js)).

**Why MicroQL?** A service can do more than answer fixed inputs with fixed outputs: it can take other calls as arguments and decide when to run them, so flow control (`each`, `filter`, a branch, a retry policy) is itself a service.

## Table of Contents

- [What a service is](#what-a-service-is)
- [Service keys](#service-keys)
- [Writing a service as a table](#writing-a-service-as-a-table)
- [Declarations](#declarations)
- [Types and plan()](#types-and-plan)
- [init and tearDown](#init-and-teardown)
- [Error handling](#error-handling)
- [Testing services](#testing-services)
- [Best practices](#best-practices)
- [Built-in services](#built-in-services)

## What a service is

A service is an object that core asks two things of:

- **`lookup(parts)`** returns the operation that answers a key's parts (see [Service keys](#service-keys)), or `undefined` when the service has no such resource. It throws, with a message naming the key, when it refuses one: a verb it doesn't expect, or a missing verb it needs. Core calls it while compiling a Query, so it must answer synchronously.
- **`operations()`** returns every operation the service has, each with its `resource` and `method`. A service whose operations can't be listed up front returns `[]`.

An **operation** is:

| Field | Is |
|---|---|
| `call(fields)` | the async function core calls with the call's resolved fields; returns the result |
| `description` | a short sentence saying what it does |
| `input` | its input fields by path, each with a list of tags ([Declarations](#declarations)) |
| `output` | a list of tags for what it returns |
| `resource`, `method` | what it answers to; listed by `operations()` |

Everything but `call` is optional: an operation with no declaration takes any fields and returns any value. A service may also have `init` and `tearDown` ([init and tearDown](#init-and-teardown)).

**Core never reads where a declaration came from.** A service may be written by hand, read from an OpenAPI document, an MCP server's tool list or a protobuf file, or generated from route definitions. Its implementation turns that into operations whose types are zod schemas. A service that discovers its operations asynchronously (fetching a spec, connecting to a server) does so before the Query is compiled, so that `lookup` can answer synchronously.

## Service keys

A service key is `[VERB] [service]/resource`, from [`@tlsft/service-key`](https://www.npmjs.com/package/@tlsft/service-key). It parses to parts, `{method, service, resource, local}`, and the parts are the contract between a Query and a service: the Query names a call with a string, the service answers to parts.

- `service` is the name the service is registered under in `config.services`. Core finds the service by it, and keeps settings such as `rateLimit` by it.
- `resource` and `method` are the service's business, handed to its `lookup`. The verb is optional, and `method` is `null` without one. A service that doesn't use verbs (`util`, a gRPC adapter) takes keys without one, `[util]/each`; an HTTP service takes its routes' verbs, `POST [orders]/orders`. A service should refuse a verb it doesn't expect, so a mistyped key fails at compile time.
- `[@service]` names a service embedded in the caller's own page. The `@` is syntax (`local: true` in the parts); what it means is the host's business.

The grammar fits most API styles, so one key format covers them:

| Style | Key |
|---|---|
| REST | `GET [books]/years/:year` |
| gRPC | `[helloworld.Greeter]/SayHello` |
| JSON-RPC, SOAP | `[ethereum]/eth_getBalance`, `[currency]/ConvertRate` |
| GraphQL | `QUERY [github]/viewer`, `MUTATION [github]/createIssue` |
| MCP tools | `[github-mcp]/create_issue` |
| EDI, queues (sending) | `SEND [acme]/850`, `PUBLISH [orders]/created` |

Calls are request and reply. A stream, or a message that arrives later (an EDI acknowledgment, a queue consumer), is a trigger, not a call.

The retired `service:action` form is a compile error that names its replacement.

## Writing a service as a table

Most services are a table: resources mapped to operations. `serviceFromTable` gives a table `lookup` and `operations`:

```javascript
import {z} from 'zod'
import {serviceFromTable} from 'microql'

const orders = serviceFromTable({
  // a verbless operation, with a declaration
  '/total': {
    description: 'The sum of an order\'s prices',
    input: {on: ['target', ['type', {fromZod: z.array(z.number())}]]},
    output: [['type', {fromZod: z.number()}]],
    call: async ({on}) => on.reduce((sum, price) => sum + price, 0)
  },

  // a bare function: an operation with no declaration
  async '/ping'() { return 'pong' },

  // one operation per verb
  '/orders': {
    GET: async ({id}) => db.orders.find(id),
    POST: {description: 'Place an order', call: async ({items}) => db.orders.create(items)}
  }
})
```

- A resource maps to an operation (an object with `call`, or a bare function), which answers verbless keys only, or to an object of one operation per verb, which needs one of those verbs.
- Resource keys keep their leading `/` and may contain more of them (`'/orders/:id/items'`).
- Operations, `init` and `tearDown` run with the table as `this`, so a table can keep what `init` gave it.

`serviceFromTable` is a convenience, not part of the spec: any object with `lookup` and `operations` is a service.

## Declarations

An operation's `input` maps field paths to tags; its `output` is a list of tags. A tag is a name, or a pair of a name and its config:

```javascript
input: {
  on: ['target', ['type', {fromZod: z.array(z.any())}]],
  service: [['call', {fromList: 'on'}]],
  skip: [['type', {fromZod: z.any().optional()}]]
},
output: [['type', {toList: {without: [{fromField: 'service'}, 'skip']}}]]
```

| Tag | Config | Means |
|---|---|---|
| `'target'` | none | method syntax fills this field: `['$items', '[orders]/total']`. At most one per operation. |
| `'reserve'` | none | the field configures the call rather than feeding it data |
| `'settings'` | none | the field receives the call's merged settings (`inspect`, `timeout`, ...) |
| `'call'` | optional source | the field holds a nested call or chain, handed to `call` as a function of one input; the source says what the nested call receives as `@` |
| `'type'` | source | the field's type; on a call field, what the nested call returns; in `output`, what the operation returns |

**Field paths** are dotted, `'params.messages'`, with `..` for a dot inside a field name (`'a..b'` is the field `a.b`).

**A source** names a type, by reading one or building one:

| Source | Names |
|---|---|
| `{fromZod: schema}` | a zod schema |
| `{fromField: path}` | the type of another field; for a call field, what its nested call returns |
| `{fromList: path}` | one item of a list field |
| `{fromObject: path}` | one value of an object field |
| `{toList: source}` | a list of the source's type |
| `{toObject: source}` | an object whose values are the source's type |
| `{without: [source, path]}` | the source's type less the members that fit the [zodly](validation.md) schema written in the field at `path`; `util/each` uses it for `skip` |

Sources compose: `{toObject: {fromList: 'on'}}` is an object whose values are the items of `on`.

**Only `fromZod` is checked at run time.** Core builds one schema from an operation's `fromZod` input fields and checks every call's fields against it (its Service Schema Validation precheck); a `fromZod` output is checked against what the call returns (its postcheck). The other sources are relationships between fields, which `plan()` resolves ([Types and plan()](#types-and-plan)). A path and its parent can't both have a schema.

**A call that holds other calls has no timeout of its own**, unless it sets one: the calls it holds have theirs. It doesn't take a concurrency slot either, so it can't starve the calls it waits on.

### Field roles: what `util/each` looks like to a Query

```javascript
['$given.urls', '[util]/each', {
  as: 'url',                                         // names what `service` receives
  service: ['[scraper]/extract', {url: '@url'}],     // a call field: compiled, then handed over as a function
  catch: ['[util]/log', {on: '@url'}],               // core's: handles a failure of any call `service` makes; sees @url and @err
  timeout: 60000                                     // a reserve field: configures the call
}]
```

- **`target`** lets `$given.urls` stand first, in method syntax.
- **`call`** makes `service` a nested call. A lone call receives its input as `@`; a chain reaches it by the name `as:` gives it. An object in a call field is a template of its input. A reference or literal in a call field stays data.
- `catch` is core's, on any call that holds calls; services never see it. Core runs it when an invocation of a call field fails, and hands the operation its result in the failed invocation's place, so flow control needs no error handling of its own.

## Types and plan()

`plan()` types every call's fields and result as zod schemas, without running anything. A field's type is what flows into it: a `$given` value's own type, the trigger's schema, or the output type of the call that feeds it. When nothing known flows in, the field's declared `fromZod` type stands in. What can't be known is `z.any()`. Where it reaches a typed field, the plan says so with a `type-narrowing` error, which a platform may treat as a warning: the field's own validation checks the value when the call runs ([Runtime Integration § Errors](runtime-integration.md#errors)).

**Relationships carry types through flow control.** `util/each` declares that its nested call receives one item of `on`, and that it returns a list of what its nested call returns:

```javascript
['$given.urls', '[util]/each', {service: ['[scraper]/extract', {url: '@'}]}]
// @ inside service: string, an item of $given.urls (an array of string)
// the each call: array of scraper's declared output
```

A service that declares nothing about what its call fields receive gets `any` for `@` inside them. **A validation takes `any` back to a type**: a nested call's own declared output types everything after it, and a `postcheck` on a call ([Validation](validation.md)) gives that call its type in the plan.

## init and tearDown

A service may define two lifecycle functions:

- **`init(runtime)`** is called before orchestration begins, on each service the plan uses, at most once per runtime. It receives the runtime's instance-wide capabilities: `log` and `cache`, and whatever more the runtime offers. A service that writes output should use these rather than reaching for the environment itself (the file system, stdout), so it runs wherever MicroQL does. A service lists the runtime keys it uses in `requires`; a Run on a runtime without one of them fails before it starts ([Runtime Integration § Capabilities beyond the standard](runtime-integration.md#capabilities-beyond-the-standard)).
- **`tearDown()`** is called after a Run, on each service the Run used. Errors thrown here are logged and swallowed.

```javascript
import {serviceFromTable, format} from 'microql'

const reporter = serviceFromTable({
  requires: ['log'],
  init(runtime) {
    this.runtime = runtime
  },
  '/report': {
    input: {on: ['target']},
    async call({on}) {
      await this.runtime.log(format(on), {color: 'cyan'})
      return on
    }
  },
  async tearDown() {
    await flushBuffers()
  }
})
```

`init` receives instance-wide capabilities only. Per-Run state, such as the Run State or which Run is executing, never passes through a service, so a host may keep its initialized services in a long-lived registry. A service shared between two runtimes is initialized again when the runtime it is used with changes.

**Authentication is the service's business.** A service may read credentials from its configuration, run an OAuth flow in `init`, or authenticate on its first call; core neither knows nor cares.

## Error handling

Services throw errors for exceptional conditions. MicroQL labels each error with the `address` and `key` of the call that raised it, the Query's form hash, and the inputs it was given.

```javascript
const users = serviceFromTable({
  async '/getUser'({id}) {
    const user = await db.users.findById(id)
    if (!user) throw new Error(`User not found: ${id}`)
    return user
  }
})
```

A Query decides what a failure means, with a `catch` on a call that holds the failing one:

```javascript
const phases = {
  user: ['[util]/try', {
    service: ['[users]/getUser', {
      id: '$given.userId',
      retry: 3,                            // Retry 3 times
      timeout: 5000                        // 5 second timeout
    }],
    catch: ['[users]/getDefaultUser', {failed: '@err.message'}]  // its result is the user
  }]
}
```

The handler receives the failure as [error data](runtime-integration.md#errors-as-data), as `@` (a lone call) and as `@err`; a chain reaches it as `@err`, since a chain's first call receives nothing. The holding call's `as:` name, if it has one, is the item whose call failed. Inside a handler's own `catch`, `@err` is the inner failure and `@@err` the outer one. A handler that throws fails the holding call; `[util]/throw` rethrows the failure it is given. A service's own flow control (an `each`, a branch) never sees a failure a `catch` handled: it receives the handler's result as the nested call's.

## Testing services

Every service can be checked against the spec without knowing its key format or its calls:

- `operations()` returns an array, and each operation has a `call` function, a `resource` and a `method`.
- `lookup` answers each listed operation's own resource and method with that operation.
- Each operation's declaration compiles: every call to it in a Query compiles without a declaration error.
- `init`, when present, runs once per runtime.

Behaviour can't be checked generically, so a service's own tests give example rows, (key, fields, expected), and run them through MicroQL:

```javascript
import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import query from 'microql'

describe('orders', () => {
  // [key, fields, expected]
  const examples = [
    ['[orders]/total', {on: [2, 3]}, 5],
    ['[orders]/ping', {}, 'pong']
  ]

  for (const [key, fields, expected] of examples) {
    it(`${key} answers ${JSON.stringify(expected)}`, async () => {
      const result = await query({services: {orders}, phases: {a: [key, fields]}, select: '$a'})
      assert.deepEqual(result, expected)
    })
  }
})
```

To test against a runtime of your own, capturing output or keeping the cache in memory, pass it as `runtime`:

```javascript
import query, {memoryStore} from 'microql'

const logged = []
const runtime = {log: (text, {to} = {}) => logged.push({text, to}), cache: memoryStore()}
await query({runtime, phases: {...}})
```

## Best practices

1. **One responsibility per operation.** Compose in the Query, where MicroQL can see the dependencies and run independent calls in parallel, rather than calling one service from another.
2. **Clear field names.** `{to, subject, body}`, not `{a, b, c}`.
3. **Declare what you can.** A `fromZod` type on each input field and on the output catches bad calls at their first run, and lets `plan()` type everything downstream.
4. **Stateless calls.** MicroQL runs identical calls once and reuses results from the Run State and the Cache, so a call's result should depend only on its fields. What `init` gives a service isn't call state.
5. **Reach the environment through the runtime**, so a service runs wherever MicroQL does.

## Built-in services

### Util

The `util` service is registered automatically. Its keys take no verb:

```javascript
const phases = {
  active: ['[util]/filter', {on: '$data', service: ['[data]/isActive', {item: '@'}]}],
  names: ['[util]/each', {on: '$active', service: ['[data]/getName', {item: '@'}]}],
  children: ['$nested', '[util]/flattenEach', {service: ['@', '[data]/getChildren']}],
  picked: ['[util]/pick', {on: '$user', fields: ['name', 'email']}],
  result: ['[util]/when', {test: '$user.isAdmin', then: 'admin_data', otherwise: 'regular_data'}],
  length: ['[util]/length', {value: '$items'}]
}
```

- `/each({on, service, as, skip})` - Run a call for every item, returning their results in order, less those that fit `skip` (a [zodly](validation.md) schema, such as `['error']`)
- `/flattenEach({on, service, as, skip})` - Run a call that returns a list for every item, returning one list of all their items, less those that fit `skip`
- `/filter({on, service, mode})` - Keep the items the call is truthy for; `mode: 'remove'` removes them instead
- `/try({on, service})` - Run one call on `on`, returning its result, so a `catch` can handle its failure
- `/throw({on, cause})` - Fail: with the error `on` describes, when it is error data, else with an error saying what it is; `cause` (error data, or anything else as text) is attached as the error behind it
- `/when({test, then, otherwise})` - `then` when `test` is truthy, otherwise `otherwise`
- `/concat({args})` - Concatenate lists
- `/pick({on, fields})` - The listed fields an object has
- `/merge({on, with})` - Deep merge of `with` onto `on`: objects merge key by key, lists are a set union by value (`on`'s items, then those of `with` not already present), and `undefined` in `with` keeps `on`'s value. Merging the same `with` twice changes nothing; to replace a list, shape it with `/template` first
- `/length({value})` - The length of a list or string
- `/exists({value})` - Whether a value is neither null nor undefined
- `/eq`, `/gt`, `/lt` `({l, r})` - Comparisons
- `/partitionErrors({on})` - Split a list into `{successes, failures}`, the failures being error data
- `/format({on})` - `on` as text, with the Query's `inspect` settings (`depth`, `maxArrayLength`, `maxStringLength`)
- `/inspect({on, color, to})` - Write `on`, formatted with the Query's `inspect` settings, through the runtime's `log`, returning `on`
- `/log({on, to})` - Write `on` as text through the runtime's `log`, returning `on`; `to` names a destination, such as a file
- `/template({...})` - Its own fields, with every reference resolved

`util.operations()` lists them with their declarations.

## Configured services

For a service that needs configuration, close over it:

```javascript
function api(baseUrl, apiKey) {
  return serviceFromTable({
    async '/get'({endpoint, params}) {
      const url = new URL(endpoint, baseUrl)
      Object.entries(params ?? {}).forEach(([key, value]) => url.searchParams.set(key, value))
      const response = await fetch(url, {headers: {Authorization: `Bearer ${apiKey}`}})
      if (!response.ok) throw new Error(`API error: ${response.status} ${response.statusText}`)
      return response.json()
    }
  })
}

const services = {github: api('https://api.github.com', process.env.GITHUB_TOKEN)}
```
