# MicroQL Service Development Guide

This guide explains how to write and structure services for MicroQL. Services are the core building blocks that contain your business logic and can be composed together to create complex workflows.

## Table of Contents

- [Service Basics](#service-basics)
- [Service Keys](#service-keys)
- [Service Structure](#service-structure)
- [init and tearDown](#init-and-teardown)
- [Argument Types](#argument-types)
- [Validation and Descriptors](#validation-and-descriptors)
- [Error Handling](#error-handling)
- [Testing Services](#testing-services)
- [Best Practices](#best-practices)
- [Built-in Services](#built-in-services)

## Service Basics

A MicroQL service is a JavaScript object of **resources**. Each resource is keyed by its path — `'/getUser'` — and answers one or more **methods**. A Query names a call to it with a service key: `GET [users]/getUser`.

### Simple Service Example

```javascript
const userService = {
  // a resource given as a function answers GET
  async '/getUser'({id}) {
    return db.users.findById(id)
  },

  // a resource with several methods has one function per method
  '/users': {
    async GET({id}) {
      return db.users.findById(id)
    },
    async POST({userData}) {
      return db.users.create(userData)
    },
    async PATCH({id, updates}) {
      return db.users.updateById(id, updates)
    }
  }
}
```

Resource keys keep their leading `/`, and may contain more of them (`'/users/preferences'`), so they are written as quoted keys and read with `service['/users']`.

### Key Principles

1. **Async Functions**: All resource functions should be `async`
2. **Single Argument**: Functions take exactly one argument object (destructured)
3. **Return Values**: Functions return the data that will be available to other phases
4. **Pure Logic**: Services should contain pure business logic, not MicroQL-specific code

## Service Keys

A service key is `METHOD [service]/resource`, from [`@tlsft/service-key`](https://www.npmjs.com/package/@tlsft/service-key). It parses to parts — `{method, service, resource, local}` — and the parts are the contract between a Query and a service definition: the Query names a call with a string, the service definition answers to parts.

- `service` is the name the service is registered under in `config.services`.
- `resource` is the key of the resource on that service, leading `/` included.
- `method` must be one the resource declares: `GET` for a resource given as a function, or one of the keys of a resource given as an object of methods. A key whose method the resource doesn't declare is a compile error naming both.
- `[@service]` names a service embedded in the caller's own page. The `@` is syntax (`local: true` in the parts); what it means is the host's business. MicroQL looks the service up by name either way.

The retired `service:action` form is a compile error that names its replacement.

Dispatch is the caller's: services arrive through `config.services`, and a host may supply services backed by its own dispatcher (an HTTP router, a queue) as long as they answer to parts.

## Service Structure

### Function Signature

All resource functions follow this pattern:

```javascript
async '/resourceName'({arg1, arg2, ...otherArgs}) {
  // Your logic here
  return result
}
```

**Important**: The function receives a single object argument. Use destructuring to extract the values you need. It is called with `this` bound to the service object, so it can reach the service's other members.

### Example: Math Service

```javascript
const mathService = {
  async '/add'({a, b}) {
    return a + b
  },

  async '/multiply'({values}) {
    return values.reduce((acc, val) => acc * val, 1)
  },

  async '/statistics'({numbers}) {
    const sum = numbers.reduce((a, b) => a + b, 0)
    return {sum, avg: sum / numbers.length, min: Math.min(...numbers), max: Math.max(...numbers), count: numbers.length}
  }
}
```

### Using the Service

```javascript
const result = await query({
  given: {numbers: [1, 2, 3, 4, 5]},
  services: {math: mathService},
  phases: {
    sum: ['GET [math]/add', {a: 10, b: 20}],
    product: ['GET [math]/multiply', {values: '$given.numbers'}],
    stats: ['GET [math]/statistics', {numbers: '$given.numbers'}]
  }
})
```

## init and tearDown

A service may define two lifecycle functions. Neither is a resource (they have no leading `/`), so a Query can't call them.

- **`init(runtime)`** — called before orchestration begins, on each service the plan uses, at most once per runtime. It receives the runtime's instance-wide capabilities: `print`, `inspect`, `recordFailure` and `cache`. A service that writes output or records failures should use these rather than reaching for the platform, so it runs wherever MicroQL does.
- **`tearDown()`** — called after a Run, on each service the Run used. Errors thrown here are logged and swallowed.

```javascript
const reporter = {
  init(runtime) {
    this.runtime = runtime
  },
  async '/report'({on}) {
    this.runtime.print(this.runtime.inspect(on), {color: 'cyan'})
    return on
  },
  async tearDown() {
    await flushBuffers()
  }
}
```

`init` receives instance-wide capabilities only. Per-Run state — the Run State, which Run is executing — never passes through a service, so a host may keep its initialized services in a long-lived registry. A service object shared between two runtimes is initialized again when the runtime it is used with changes.

## Argument Types

Declare how MicroQL should treat a resource's arguments with `_argtypes`:

```javascript
const transformService = {
  async '/transform'({on, transformer, settings}) {
    return Promise.all(on.map(item => transformer(item)))
  }
}

transformService['/transform']._argtypes = {
  on: {argOrder: 0},              // the target of method syntax: ['$items', 'GET [transform]/transform', {...}]
  transformer: {type: 'service'}, // compiled as a service call; the function receives one input
  settings: {type: 'settings'}    // receives the call's merged MicroQL settings
}
```

- **`{argOrder: 0}`** — the argument method syntax fills. By convention it is `on`.
- **`{type: 'service'}`** — the argument is compiled as a call or chain and handed to the function as `(input) => Promise<result>`. A lone call receives `input` as `@`; a chain reaches it by the name the Query gives it with `as:`. An object in this position is a template of its input. `{type: 'service', returns: ['boolean']}` declares what the service must return, for the Builder's type checks (`util.filter` declares it).
- **`{type: 'settings'}`** — the argument receives the call's settings (`inspect`, `timeout`, ...), merged with any it is given.
- **`{reserve: true}`** — the argument configures the call rather than feeding it data (`util.each`'s `skipInputErrors`), so the Builder groups it under Config.

Usage:

```javascript
const phases = {
  result: ['$given.items', 'GET [transform]/transform', {
    transformer: ['GET [util]/template', {name: '@.name'}]
  }]
}
```

Set `_noTimeout = true` on a resource that only orchestrates other calls (as `util.each` does), so the default timeout applies to the calls it makes, not to it.

## Validation and Descriptors

MicroQL validates with Zod. A resource's `_validators` are its descriptor: `precheck` is the schema of its arguments, `postcheck` the schema of its return. They are enforced on every call, and `plan()` converts them to its seven types to infer what each argument expects and each call returns. See the [Validation Guide](validation.md) for the schema syntax; a raw Zod schema is accepted anywhere a descriptor is.

```javascript
const userService = {
  async '/createUser'({userData}) {
    return {id: generateId(), ...userData}
  }
}

userService['/createUser']._validators = {
  precheck: {
    userData: {
      name: ['string'],
      email: ['string', 'email'],
      age: ['number', 'positive', {min: 13}]
    }
  },
  postcheck: {
    id: ['string'],
    name: ['string'],
    email: ['string', 'email'],
    age: ['number']
  }
}
```

A Query may add its own `precheck` and `postcheck` to any call; those run alongside the service's. A resource with no `postcheck` returns the type mixed, which fits every slot.

Service definitions are due a revision of their own: one JSON descriptor per action, with schemas in zodex rather than this descriptor syntax, so that service definitions can be built and shared as documents. Until then, `_argtypes` and `_validators` are the descriptor.

## Error Handling

Services should throw errors for exceptional conditions. MicroQL labels each error with the `address` and `key` of the call that raised it, and the inputs it was given.

### Throwing Errors

```javascript
const userService = {
  async '/getUser'({id}) {
    if (!id) {
      throw new Error('User ID is required')
    }

    const user = await db.users.findById(id)
    if (!user) {
      throw new Error(`User not found: ${id}`)
    }

    return user
  }
}
```

### Using Error Handling in Queries

```javascript
const phases = {
  user: ['GET [users]/getUser', {
    id: '$given.userId',
    onError: ['GET [users]/getDefaultUser', {failed: '@.message'}],  // receives the error as @, or @err
    ignoreErrors: true,                    // return the handler's result instead of failing
    retry: 3,                              // Retry 3 times
    timeout: 5000                          // 5 second timeout
  }]
}
```

A handler that is a chain reaches the error as `@err`, since a chain's first call receives nothing. Inside a handler's own handler, `@err` is the inner error and `@@err` the outer one:

```javascript
onError: [
  ['@err', 'POST [sentry]/capture', {tags: {address: '@err.address'}}],
  ['GET [users]/getDefaultUser', {}]
]
```

## Testing Services

Services are just regular JavaScript objects, so they're easy to unit test.

### Unit Testing

```javascript
import assert from 'node:assert'
import {describe, it} from 'node:test'

describe('Math Service', () => {
  it('should add two numbers', async () => {
    const result = await mathService['/add']({a: 5, b: 3})
    assert.strictEqual(result, 8)
  })
})
```

### Integration Testing with MicroQL

```javascript
import query from 'microql'

describe('User Service Integration', () => {
  it('should create and retrieve user', async () => {
    const result = await query({
      given: {userData: {name: 'John', email: 'john@example.com', age: 25}},
      services: {users: userService},
      phases: {
        created: ['POST [users]/users', {userData: '$given.userData'}],
        retrieved: ['GET [users]/users', {id: '$created.id'}]
      }
    })

    assert.strictEqual(result.retrieved.name, 'John')
  })
})
```

To test against a runtime of your own — capturing output, or keeping the cache in memory — pass it as `runtime`:

```javascript
import query, {memoryStore} from 'microql'

const printed = []
const runtime = {print: (text) => printed.push(text), inspect: JSON.stringify, recordFailure: async () => {}, cache: memoryStore()}
await query({runtime, phases: {...}})
```

## Best Practices

### 1. Single Responsibility

Each resource should do one thing well:

```javascript
// Good: Focused responsibilities
const userService = {
  '/users': {
    async GET({id}) { /* ... */ },
    async POST({userData}) { /* ... */ },
    async DELETE({id}) { /* ... */ }
  }
}

// Avoid: Mixed responsibilities
const messyService = {
  async '/getUserAndSendEmail'({id}) { /* ... */ }  // Does too many things
}
```

### 2. Clear Argument Names

Use descriptive argument names that make the intent clear:

```javascript
// Good: Clear intent
async '/sendEmail'({to, subject, body, attachments}) { /* ... */ }

// Avoid: Unclear arguments
async '/send'({a, b, c, d}) { /* ... */ }
```

### 3. Consistent Return Types

Be consistent about what your resources return, and declare it with a `postcheck` so `plan()` can type everything downstream.

### 4. Use Validation

Add validation to catch errors early and document your contracts:

```javascript
apiService['/fetchData']._validators = {
  precheck: {
    url: ['string', 'url'],
    options: {
      method: ['enum', ['GET', 'POST', 'PUT', 'DELETE'], 'optional'],
      headers: ['object', 'optional'],
      timeout: ['number', 'positive', 'optional']
    }
  }
}
```

### 5. Handle Edge Cases

Think about and handle edge cases in your services:

```javascript
const mathService = {
  async '/divide'({numerator, denominator}) {
    if (denominator === 0) {
      throw new Error('Cannot divide by zero')
    }
    return numerator / denominator
  }
}
```

### 6. Keep Services Stateless

Services should not keep state between calls. MicroQL runs identical calls once and reuses results from the Run State and the Cache, so a call's result should depend only on its arguments. Capabilities received at `init` are not call state.

## Built-in Services

### Util Service

The `util` service is registered automatically, and provides common data operations:

```javascript
const phases = {
  // Array operations
  active: ['GET [util]/filter', {on: '$data', service: ['GET [data]/isActive', {item: '@'}]}],
  names: ['GET [util]/each', {on: '$active', service: ['GET [data]/getName', {item: '@'}]}],
  children: ['$nested', 'GET [util]/each', {flatten: true, service: ['@', 'GET [data]/getChildren']}],

  // Object operations
  picked: ['GET [util]/pick', {on: '$user', fields: ['name', 'email']}],

  // Conditional logic
  result: ['GET [util]/when', {test: '$user.isAdmin', then: 'admin_data', otherwise: 'regular_data'}],

  // Utilities
  length: ['GET [util]/length', {value: '$items'}],
  exists: ['GET [util]/exists', {value: '$optionalField'}]
}
```

### Available Util Resources

All answer `GET`.

- `/each({on, service, as, flatten, skipInputErrors, skipOutputErrors})` - Run a service for every item; `flatten` concatenates the results
- `/filter({on, service, mode})` - Keep the items the service is truthy for; `mode: 'remove'` removes them instead
- `/when({test, then, otherwise})` - `then` when `test` is truthy, otherwise `otherwise`
- `/concat({args})` - Concatenate arrays
- `/pick({on, fields})` - Extract object fields
- `/merge({on, with})` - Deep merge of `with` onto `on`: objects merge key by key, arrays are a set union by value (`on`'s items, then those of `with` not already present), and `undefined` in `with` keeps `on`'s value. Merging the same `with` twice changes nothing; to replace an array, shape it with `/template` first
- `/length({value})` - Get length of an array or string
- `/exists({value})` - Check that a value is not null or undefined
- `/eq`, `/gt`, `/lt` `({l, r})` - Comparisons
- `/removeErrors`, `/removeNulls`, `/removeSuccesses`, `/partitionErrors` `({on})` - Clean up results of `ignoreErrors`
- `/print({on, color, settings})` - Print through the runtime, returning `on`
- `/recordFailure({on, location})` - Record an error through the runtime, returning it
- `/template({...})` - Return its arguments, resolved

See the [util service source](../services/util.js) for complete details.

## Creating Reusable Services

### Configured Services

For services that need configuration, close over it:

```javascript
function apiService(baseUrl, apiKey) {
  return {
    async '/get'({endpoint, params}) {
      const url = new URL(endpoint, baseUrl)
      Object.entries(params ?? {}).forEach(([key, value]) => url.searchParams.set(key, value))

      const response = await fetch(url, {headers: {Authorization: `Bearer ${apiKey}`}})
      if (!response.ok) {
        throw new Error(`API error: ${response.status} ${response.statusText}`)
      }
      return response.json()
    }
  }
}

// Usage
const services = {
  github: apiService('https://api.github.com', process.env.GITHUB_TOKEN)
}
```

### Service Composition

Prefer composing services in the Query, where MicroQL can see the dependencies and run independent calls in parallel, over calling one service from another.

## Summary

Good MicroQL services are:

1. **Simple**: One responsibility per resource
2. **Async**: All resources are async functions
3. **Stateless**: A call's result depends only on its arguments
4. **Described**: `_argtypes` and `_validators` say what goes in and what comes out
5. **Portable**: They reach the platform through the runtime received at `init`
6. **Testable**: Easy to unit test in isolation
7. **Composable**: Can be combined with other services
