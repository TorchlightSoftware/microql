# MicroQL Service Development Guide

This guide is the spec for MicroQL services: what core asks of a service, how a service declares the calls it supports, and how to write one. `util`, MicroQL's builtin service, is the reference implementation ([src/service/util.js](../src/service/util.js)).

Most service definitions will be wrappers around existing APIs clients: REST, gRPC, SOAP, etc.  Some services will have direct, local implementations, such as `src/service/util.js`.  In addition to the traditional request/response lifecycle supported by most APIs, services can also support flow control like iterating lists, performing conditional logic, and error handling.  Read on to see what type of service is most relevant for your present task.

## Table of Contents

- [What a service is](#what-a-service-is)
- [Service keys](#service-keys)
- [Writing a service with defineService](#writing-a-service-with-defineservice)
- [Declarations](#declarations)
- [init and tearDown](#init-and-teardown)
- [Configuration](#configuration)
- [Error handling](#error-handling)
- [Testing services](#testing-services)
- [Best practices](#best-practices)

## What a service is

A service's primary function is to answer **service calls**.  Service calls are essentially API endpoints that have been wrapped in a MicroQL compatible call layer. Each service call is comprised of a key (e.g: `POST [claude]/troubleshoot`), the input fields that it's called with, and the output value that it returns.

A service key has the format `METHOD [service]/resource`, and MicroQL hands a service every field of the key ([Service keys](#service-keys)):

- `method`: the key's method (`GET`, `POST`, `QUERY`...), or `null` when the key has none.
- `service`: the name the service is registered under in its runtime, which the key names. One service may be registered under several names, such as two accounts each with its own config; a service uses it to name the key in its messages.
- `resource`: the resource the key names, such as `/orders`.
- `confined`: whether the key is written `[@service]`, confining the call's data to the caller's own custody ([Confined keys](#confined-keys)).

In order to be recognized by MicroQL, a service must be presented as an object that commits to offering three methods:

- **`lookup({method, service, resource, confined})`** returns the declaration of the service call the key names. It throws, with a message naming the key, when it refuses one: a resource it doesn't have, a method it doesn't expect, a missing method it needs, or a key whose custody it doesn't answer. Core calls it while compiling a Query, so it must answer synchronously.

- **`supportedCalls()`** returns every service call the service supports, each as its `resource` and `method` with its declaration. This allows a catalog (autocomplete, et al.) to list what the service offers. A service with no listable calls (maybe they're dynamic or something) must return `[]`. Core never calls it.

- **`init(env)`** returns an **instance** of the service, made with what its runtime gives it ([init and tearDown](#init-and-teardown)). The instance offers:
  - **`call({method, service, resource, confined, fields})`**: during execution MicroQL calls it with the key's fields and the call's resolved `fields`, and it returns the result. It throws an error for a key it has no entry for, saying why. The service is responsible for efficient lookup and calling.
  - **`tearDown()`**, optionally: releases what the instance holds.

`lookup` and `supportedCalls` belong to the service, not to an instance, because compiling a Query and planning it need no instance: they read declarations, and never make a call.

A service call's **declaration** is:

| Field | Is |
|---|---|
| `description` | a short sentence saying what it does |
| `input` | its input fields by path, each a zodly type with its tags ([Declarations](#declarations)) |
| `output` | the zodly type of what it returns |

Every field is optional: a service call that declares nothing (`{}`) takes any fields and returns any value. A service may also list in `requires` the `env` keys its instances use ([init and tearDown](#init-and-teardown)), and declare in `config` the configuration it reads ([Configuration](#configuration)).

**Core never reads or cares where a declaration came from.** A service may be written by hand, read from an OpenAPI document, an MCP server's tool list or a protobuf file, or generated from route definitions. Its implementation turns that into declarations whose types are zodly descriptors or zod schemas. A service that discovers its calls asynchronously (fetching a spec, connecting to a server) does so before the Query is compiled, so that `lookup` can answer synchronously.

## Service keys

A service key is `[METHOD] [service]/resource`, from [`@tlsft/service-key`](https://www.npmjs.com/package/@tlsft/service-key). It parses to the fields `{method, service, resource, confined}` ([What a service is](#what-a-service-is)), and those fields are the contract between a Query and a service: the Query names a call with a string, the service answers to the fields.

- `service`: MicroQL finds the service by this name among the Query's services, and hands it on, so the service can name the key in its messages.
- `resource` and `method`: what the service answers to. The method is optional. A service should refuse a method it doesn't expect, so a mistyped key fails at compile time.
- `confined`: see [Confined keys](#confined-keys).

The grammar fits most API styles, so one key format covers them:

| Style | Key |
|---|---|
| REST | `GET [books]/years/:year` |
| gRPC | `[helloworld.Greeter]/SayHello` |
| JSON-RPC, SOAP | `[ethereum]/eth_getBalance`, `[currency]/ConvertRate` |
| GraphQL | `QUERY [github]/viewer`, `MUTATION [github]/createIssue` |
| MCP tools | `[github-mcp]/create_issue` |
| EDI, queues (sending) | `SEND [acme]/850`, `PUBLISH [orders]/created` |

Calls are request and reply. A stream, or a message that arrives later (an EDI acknowledgment, a queue consumer) can be implemented through the concept of callbacks and other flow control; this is currently unexplored.

### Confined keys

`[@service]` confines a call's data to the caller's own custody: it must not leave for a host the caller doesn't hold. It is for restricted custody use cases, such as a private service the caller holds itself (rehydrated from an encrypted blob, say), whose lifecycle and management obligations differ from a network service's, all the way up to the UI. MicroQL itself gives the flag no meaning beyond handing it to the service.

A service answers either confined keys or the others, never both, so a confined call can't be mistaken for a network one. The services in MicroQL's catalog, `util` among them, answer no confined keys. If you're building a private service, `defineService` takes `confined: true` for one that answers only confined keys.

## Writing a service with defineService

`defineService` takes a canonical service definition and turns it into a service.  This is most useful if you are defining your own service ad-hoc.

DO NOT USE THIS if you're wrapping existing APIs and have something like an OpenAPI schema.  In that case you will want to use an existing adapter or define one of your own that exports the `{lookup, call, supportedCalls}` API.

```javascript
import {defineService} from 'microql'

const orders = defineService({
  // a service call with no method, with a declaration
  '/total': {
    description: 'The sum of an order\'s prices',
    input: {on: ['array', ['number'], {tags: ['target']}]},
    output: ['number'],
    call: async ({on}) => on.reduce((sum, price) => sum + price, 0)
  },

  // a bare function: a service call with no declaration
  async '/ping'() { return 'pong' },

  // one service call per method
  '/orders': {
    GET: async ({id}) => db.orders.find(id),
    POST: {description: 'Place an order', call: async ({items}) => db.orders.create(items)}
  }
})
```

`defineService` takes this definition and creates the object that MicroQL is expecting. Besides the resources, a definition may have `init` and `tearDown` ([init and tearDown](#init-and-teardown)), `requires`, `config` ([Configuration](#configuration)), and `confined: true` ([Confined keys](#confined-keys)). But again, you don't need `defineService`: any object with `lookup`, `supportedCalls` and `init` is a service.

## Declarations

A service call's `input` and `output` are [zodly](validation.md) schemas: `input` an object schema, one field per argument, and `output` the type of what the service call returns.

```javascript
'/each': {
  input: {
    on: ['array', {tags: ['target']}],
    service: ['call', {input: ['type', {fromList: 'on'}]}],
    skip: ['any', 'optional']
  },
  output: ['array', ['type', {without: [{fromField: 'service'}, {fromZodly: {fromValue: 'skip'}}]}]]
}
```

### Tags

In order to provide a fully ergonomic experience to query writers, you will want to tag some of your input fields with meta data.  In some cases tags may even be required in order for your service to work as intended.

| Tag | Means |
|---|---|
| `'target'` | this field supports infix notation, that is you can put the target field to the left of it: `['$items', '[orders]/total']`. At most one per service call. |
| `'settings'` | the field receives the call's settings which are normally reserved for microql use (`inspect`, `timeout`, ...) |

### Reserve args

Some field names belong to MicroQL on every call: MicroQL reads them, and never hands them to the service, so don't declare fields of your own by these names.

| Field | Is |
|---|---|
| `timeout` | how long the call may take, in ms |
| `retry` | how many times to try the call again after it fails |
| `cache` | `true`, or `{ttl}`: reuse the call's result across Runs while its inputs match |
| `precheck`, `postcheck` | Service Call Validations of the call's input and result ([Validation](validation.md)) |
| `debug` | print the call, its arguments and its result |
| `catch` | on a call that holds calls: handles a failure of any of them |
| `as` | on a call that holds calls: names what they receive (`@name`) |

### Service Sub-Calls

When your service takes a reference to another service, you can use the type `call`. You may define an `input` schema to enforce what the nested call receives as `@`, and `output` for what the nested call must return:

```
['call', {input: ['type', {fromList: 'on'}], output: ['boolean']}]
```

Either may be left out, and a bare `'call'` takes anything and returns anything. `call` is MicroQL's own type name, a zodly preprocessor that rewrites it as a `function`; MicroQL schemas are disallowed from using `function`directly.

### Dynamic Types

Some types can't be described as a single static type at the time of service definition.

In order to describe relationships between field types, MicroQL supports dynamic types.  For instance: `output: ['type', {fromField: 'on'}]`, says that your output type is the same as your input.  This is necessary for the query planner to be able to resolve exact types as they are woven through your service.

Dynamic types layer gracefully onto zodly: they are implemented as a preprocessor step.  They resolve into concrete types, which zodly then converts into zod, and which then operate on data.

| Source | Names |
|---|---|
| `{fromField: path}` | the type of another field; for a call field, what its nested call returns |
| `{fromList: path}` | one item of a list field |
| `{fromObject: path}` | one value of an object field |
| `{fromValue: path}` | the field's value, as a literal type: `fields: ['name', 'url']` is the tuple of literals `'name'` and `'url'`. `plan()` knows it when the Query writes it; a reference, whose value isn't known until the Run, is `any`. |
| `{fromZodly: descriptor}` | a fixed zodly type, as an operator's operand: `{without: [{fromList: 'on'}, {fromZodly: ['null']}]}` |
| `{fromZodly: source}` | the zodly descriptor the source's value is: `{fromZodly: {fromValue: 'skip'}}` |
| `{picked: [a, keys]}` | a with only the fields keys names, as TypeScript's `Pick`: keys is a tuple or union of string literals. A name a loose object doesn't list may be there, of its other fields' type, or not. `util/pick` returns `['type', {picked: [{fromField: 'on'}, {fromValue: 'fields'}]}]` |
| `{merged: [a, b]}` | b laid over a, as `util/merge` does: objects field by field, lists as a list of either item, any other value of b wins |
| `{without: [a, b]}` | a's members less those that fit b; `util/each` uses it for `skip`. Taking away what isn't known (`any`) leaves a as it is. |

Paths name fields of `input`, dotted, with `..` for a dot inside a field name (`'a..b'` is the field `a.b`); `output`'s sources read `input` too.

**A call that holds other calls is exempt from timeouts**, unless it sets one explicitly: otherwise iterators would be held to the same standards as individual calls.

### Example: How `util/each` works in a query

```javascript
['$given.urls', '[util]/each', {                     // $given.urls is provided *before* the service key
  as: 'url',                                         // `as` names what `service` receives
  service: ['[scraper]/extract', {url: '@url'}],     // a call field: compiled, then handed over as a function
  catch: ['[util]/log', {on: '@url'}],               // MicroQL reserved field: handles a failure of any call `service` makes
  timeout: 60000                                     // MicroQL reserved field: set a timeout for this call
}]
```

`util/each` has the following tags defined on its fields, which allow it to be called in this way.

- `on` has the **`target`** tag: which means anything to the left of util/each gets provided to `on`
- `service` has the **`call`** type: which means it holds a nested call (or a chain of calls, or an object template, which fit the same slot).
- `as`, `catch` and `timeout` are [reserve args](#reserve-args): MicroQL takes them on every call, as configuration, not data for the call

A service that declares nothing about what its call fields receive gets `any`.  But runtime `precheck` and `postcheck` will coerce these values into stronger types: just beware you may get runtime errors that could have been avoided by defining more specific types in the first place.

## init and tearDown

A service has one lifecycle function, and its instances may have another:

- **`init(env)`** makes an instance of the service. It may be async, to log in or open a connection say: a Run waits for it before the service's first call. Core never keeps instances: it makes every call through its runtime, which makes an instance of a service on its first call in a scope (a tenant, say) and keeps it for every later Run there ([Runtime Integration § Service instances](runtime-integration.md#service-instances)). `env` is what the runtime gives its services: `log`, whatever more the runtime offers, and `config`, the service's own configuration ([Configuration](#configuration)). A service that writes output should use these rather than reaching for the environment itself (the file system, stdout), so it runs wherever MicroQL does. A service lists the `env` keys it uses in `requires`; a Query naming it doesn't compile on a runtime without them ([Runtime Integration § Capabilities beyond the standard](runtime-integration.md#capabilities-beyond-the-standard)).
- **`tearDown()`**, on an instance, releases what it holds (a browser context, a connection pool). Core MicroQL never calls it; the runtime that made the instance does, when it is done with it: a server shutting down, a test's `after()` (`nodeRuntime.tearDown()`), new config for the service. Typically a process that's exiting anyway doesn't need to call this explicitly. It should do no harm when called twice.

With `defineService`, `init` and `tearDown` in the definition run with the instance as `this`: an object of the instance's own, which inherits from the definition. So an instance can keep what `init` gave it, apart from every other instance:

```javascript
import {defineService, format} from 'microql'

const reporter = defineService({
  requires: ['log'],
  init(env) {
    this.env = env
  },
  '/report': {
    input: {on: ['any', 'optional', {tags: ['target']}]},
    async call({on}) {
      await this.env.log(format(on), {color: 'cyan'})
      return on
    }
  },
  async tearDown() {
    await flushBuffers()
  }
})
```

**An instance belongs to one scope.** A runtime keeps an instance of each service per scope, such as a tenant, and makes it with that scope's config, so what an instance holds (a token, a browser context) is that tenant's. Several Runs may use one instance at once, so an instance keeps what `init` gave it and what its calls share by design (a connection pool, a client), never anything about the Run it's serving.

**Keep nothing in module scope or on the definition.** Two instances share the definition and the module, and with them anything stored there, so that is how one tenant's data reaches another's instance. Store on `this`, which is the instance's own, and beware of mutating objects `this` inherits from the definition.

**Authentication is the service's business.** A service may read credentials from its configuration (received through `init`), exchange a refresh token its runtime filed for it ([OAuth](#oauth)), or authenticate on its first call; core neither knows nor cares. A token an instance keeps on `this` is its scope's own.

## Configuration

A service that needs configuration, such as a base URL or an API key, declares it in `config`, a zodly document of the keys it reads, and reads them from `env.config` in `init`. Its runtime keeps each service's configuration by scope and name, and checks it against the service's config declaration as it's filed, so an instance is only ever made with config its service accepts. A service declares its keys plainly (`token`), never sees another service's configuration, and never knows which tenant it is configured for. One service under two names, such as two accounts, gets two instances, each with its own configuration. A service that declares config, with none filed, fails its first call with `invalid-config`.

In node, a Query brings its services and their configuration, by service name:

```javascript
import query, {defineService} from 'microql'

const github = defineService({
  config: {token: ['string', {min: 1}]},
  init(env) {
    this.baseUrl = 'https://api.github.com'
    this.token = env.config.token
  },
  async '/get'({endpoint, params}) {
    const url = new URL(endpoint, this.baseUrl)
    Object.entries(params ?? {}).forEach(([key, value]) => url.searchParams.set(key, value))
    const response = await fetch(url, {headers: {Authorization: `Bearer ${this.token}`}})
    if (!response.ok) throw new Error(`API error: ${response.status} ${response.statusText}`)
    return response.json()
  }
})

await query({
  services: {github, githubWork: github},
  config: {
    github: {token: process.env.GITHUB_TOKEN},
    githubWork: {token: process.env.GITHUB_WORK_TOKEN}
  },
  phases: {...}
})
```

Configuration the declaration doesn't accept fails the Query before any call, with `invalid-config`, naming the service and what was wrong. A platform files configuration with its runtime's `config.set(scope, name, value)`, which checks it the same way ([Runtime Integration § Config](runtime-integration.md#config)).

### OAuth

A service whose API uses OAuth declares an `oauth` type in its config, with the provider's details, and leaves the protocol to its runtime:

```javascript
const github = defineService({
  config: {github: ['oauth', {authorizeUrl: 'https://github.com/login/oauth/authorize', tokenUrl: 'https://github.com/login/oauth/access_token', scopes: ['repo']}]},
  async init(env) {
    const {clientId, clientSecret, refreshToken} = env.config.github
    this.token = await exchange({clientId, clientSecret, refreshToken})
  },
  async '/repos'() { /* ... */ }
})
```

`oauth` reads as an object of what the runtime files once it has run the consent flow: `clientId`, `clientSecret` and `refreshToken`, each optional, since none is there before the flow has run, and each for the runtime to fill, not for a person to edit. `init` exchanges the refresh token for an access token, and keeps it on `this`. In node, where no platform runs a consent flow, log in before running the Query and pass what you got as config.

## Error handling

Services may throw errors. MicroQL labels each error with the `address` and `key` of the call that raised it, the Query's form hash, and the inputs it was given.

```javascript
const users = defineService({
  async '/getUser'({id}) {
    const user = await db.users.findById(id)
    if (!user) throw new Error(`User not found: ${id}`)
    return user
  }
})
```

A Query author can catch the error, or can let it terminate the query.  `catch` will provide the error as [error data](runtime-integration.md#errors-as-data) available in the @err ref.

## Testing services

MicroQL ships smoke tests for services: `serviceSmokeTests(service, {env, config})` checks that a service keeps its side of this spec, without knowing its calls. It returns a table of tests, `[{describe, it, test}]`, where `test` is an async function that throws when the service fails it, so you can run them in whichever test runner you use. Run them from your service's own tests, and when you take up a newer MicroQL, its smoke tests check your service against the newer spec.

- `env` holds what a runtime gives your service's `init`. It must have every key your service `requires`.
- `config` is your service's own configuration and credentials, as its config declaration describes them.
- `confined: true` checks a service that answers only [confined keys](#confined-keys).

```javascript
import {describe, it} from 'node:test'
import {serviceSmokeTests} from 'microql'
import orders from '../orders.js'

const env = {log() {}}
const config = {apiKey: process.env.ORDERS_API_KEY}

for (const {describe: name, it: check, test} of serviceSmokeTests(orders, {env, config})) {
  describe(name, () => it(check, test))
}
```

They check that:

- the service has `lookup`, `supportedCalls` and `init`, `env` has every key it `requires`, and its config declaration accepts `config`, as a runtime checks them;
- `supportedCalls()` lists each call by `resource` and `method`, with no functions;
- `lookup` answers each listed call with its declaration, and the declaration reads;
- `lookup` refuses a resource the service lacks, and a key whose custody it doesn't answer;
- `init` makes a fresh instance each time, with `call`, and `call` refuses a resource the service lacks;
- an instance's `tearDown` can run twice.

Behaviour is your service's own: give example rows, (key, fields, expected), and run them through MicroQL:

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

To test against a runtime of your own, capturing output or keeping the cache in memory, pass it as `runtime`. A `NodeRuntime` of the test's own keeps its own instances, too:

```javascript
import query, {NodeRuntime, memoryCache} from 'microql'

const logged = []
const runtime = new NodeRuntime({cache: memoryCache()})
runtime.env = {log: (text, {to} = {}) => logged.push({text, to})}
await query({runtime, services: {orders}, phases: {...}})
```

## Best practices

1. **One responsibility per service call.** Compose in the Query, where MicroQL can see the dependencies and run independent calls in parallel, rather than calling one service from another.
2. **Clear field names.** `{to, subject, body}`, not `{a, b, c}`.
3. **Declare what you can.** A concrete type on each input field and on the output catches bad calls at their first run, and lets `plan()` type everything downstream.
4. **Stateless calls.** MicroQL runs identical calls once and reuses results from the Run State and the Cache, so a call's result should depend only on its fields. What `init` gives an instance isn't call state.
5. **Reach the environment through the runtime**, so a service runs wherever MicroQL does.
6. **Support as many runtime environments as you can.** MicroQL runs on node and on Cloudflare Workers ([Runtime Integration § Runtime environments](runtime-integration.md#runtime-environments)). A service that needs only `fetch` and what its runtime gives it runs on all of them. One that needs more, such as the local file system or a node-only library, says which environments it supports.

