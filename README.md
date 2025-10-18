# MicroQL

MicroQL is a declarative JSON-based query language for composing and orchestrating microservices. It automatically handles dependency resolution, parallel execution, error handling, and validation while providing a clean, expressive syntax for complex service interactions.

## Target Audience

If you're a programmer and you want to achieve the low risk/high productivity of something like Zapier or n8n, but without all the baggage that those services come with, use MicroQL.  You may 1) make yourself more productive, 2) enable a non-coder on the team to be able to compose queries, enabling a division of labor where you and other coders can focus on building out new services, or working on something else entirely.

## Core Concepts

### Basic Service Orchestration

```javascript
import query from 'microql'
import users from './users.js'
import audit from './audit.js'

const result = await query({
  given: {userId: 'user123'},
  services: {users, audit},
  queries: {
    // depends on $.given, which is provided by the query definition
    // so this will run first
    profile: ['users', 'getProfile', {id: '$.given.userId'}],

    // depends on $.profile, so MicroQL will run this after the profile query is complete
    auditLog: ['audit', 'log', {action: 'profile_access', user: '$.profile'}]
  }
})

console.log(result.profile) // {id: 'user123', name: 'John Doe', email: 'john@example.com'}
console.log(result.auditLog) // {timestamp: 1642533600000, action: 'profile_access', userId: 'user123'}
```

### Data References

Data references imply dependency, and MicroQL will automatically execute queries as their dependencies become available.  Circular references (unprocessable queries) are detected at query parse time and aborted.

- `$` - All query results in their present state - does not depend or wait on any queries
- `$.given.field` - Access initial input data
- `$.queryName` - Reference results from other queries, implies dependency on that query
- `$.queryName.foo[0].bar` - Arbitrary (and safe) nested data access - returns undefined or value
- `@` - Current context: May be a chain (result of previous step), an iterator value, or the error for an `onError` handler
- `@@` - Parent context, `@@@` - grandparent context
- `@.foo[0].bar` - nested paths work on context

### Service Implementation

Services are just objects containing asynchronous methods.  They take an object containing named args and return a promise, with data up to the service's discretion.  This allows you to easily wrap many kinds of API calls, databases, etc. and make them available to be orchestrated within a MicroQL query.  If your target is well formed e.g. REST, perhaps you can programmatically create the service wrapper.

```javascript
services: {
  users: {
    async getProfile({id}) {
      return {id, name: 'John Doe', email: 'john@example.com'}
    }
  },
  audit: {
    async log({action, user}) {
      return {timestamp: Date.now(), action, userId: user.id}
    }
  }
},
```

### Data Transformation Chains

You can 'pipe' values through chains, using '@' context, which in this case will refer to the previous value in the chain.  Steps in a chain will run sequentially, but any paths referenced by the entire query tree (including the chain) will be considered dependencies of that query, and will determine the execution sequence of queries.

```javascript
const result = await query({
  given: {data: [1, 2, 3, 4, 5]},

  // these are typically in other files, not inline, but presented here for a complete example
  services: {
    math: {
      async double({values}) {
        return values.map(x => x * 2)
      },
      async sum({values}) {
        return values.reduce((a, b) => a + b, 0)
      }
    }
  },
  queries: {
    // Sequential chain: double the numbers, then sum them
    result: [
      ['math', 'double', {values: '$.given.data'}],
      ['math', 'sum', {values: '@'}] // @ refers to return of 'math:double'
    ]
  }
})

console.log(result.result) // 30 (sum of [2, 4, 6, 8, 10])
```

### First Class Services

A service can be passed as an argument to another service.  Services that support other services as arguments have arg defined with `{type: 'service'}`.

```javascript
util.map._argtypes = {
  service: {type: 'service'},
}
```

This means the argument is expecting a service definition.  The child service (`stringLib:toUppercase` in this case) will have access to '@' context - this is how it accesses the iteration value.

```javascript
    uppercase: ['util', 'map', {
        on: '$.filtered',
        service: ['stringLib', 'toUppercase', {on: '@'}]
    }],
```

Remember: `{type: 'service'}` declared on the service is MicroQL's cue to compile the argument as a service descriptor.  Otherwise the same argument will be interpreted as an array with some strings and an object in it - no compilation and no service lookup.

The syntax used here can be further condensed; read below for method syntax.

### Method Syntax

MicroQL supports 'infix' notation where the first argument appears on the left.

```javascript
['$.filtered', 'util:map', {service: ['@', 'stringLib:toUppercase']}],
```

Services that support method syntax have an arg defined with `{argOrder: 0}`.  By convention we typically use `on` for `{argOrder: 0}`:

```javascript
util.map._argtypes = {
  on: {argOrder: 0}
}
```

Method syntax is transformed into the equivalent service definitions, and then compiled and executed in the same way.  So it's purely for user convenience and has the same semantics.

```javascript
// method syntax:
['$.filtered', 'util:map', {service: ['@', 'stringLib:toUppercase']}],

// is transformed into standard service calls
['util', 'map', {
    on: '$.filtered',
    service: ['stringLib', 'toUppercase', {on: '@'}]}],

// and then the service lookups are performed and these become functions which get called by the execution engine

```

## Features

- **Declarative Query Language**: Express complex service orchestration with simple JSON
- **Automatic Dependency Resolution**: Infers execution order from data dependencies
- **Parallel Execution**: Runs independent operations concurrently for optimal performance
- **Context Chaining**: Pass data between services using `@` and `$` references
- **Method Syntax**: Concise `service:method` notation for transformations
- **Sequential Chains**: Execute multi-step workflows with automatic data flow
- **Validation System**: Built-in Zod-based validation for inputs and outputs
- **Error Handling**: Comprehensive error recovery with `onError` chains
- **Retry & Timeout**: Built-in resilience patterns for unreliable services
- **Circular Dependency Detection**: Prevents infinite loops at compile time

## Advanced Features

### Validation

`precheck` and `postcheck` validations can be created at both the service and query level. See [Validation Guide](docs/validation.md) for details.

```javascript
const userService = {
  async createUser(args) {
    return {id: generateId(), ...args.userData}
  }
}

// service level validation
userService.createUser._validators = {
  precheck: {
    userData: {
      name: ['string'],
      email: ['string', 'email'],
      age: ['number', 'positive']
    }
  },
  postcheck: {
    id: ['string', 'uuid'],
    name: ['string'],
    email: ['string', 'email']
  }
}
```

### Error Handling

All service calls support an `onError` handler, and optional `ignoreErrors: true`.  Error handlers are just regular services.  The builtin `util` service has a `print` action that can be useful for this.

```javascript
const queries = {
  user: ['users', 'getUser', {
    id: '$.given.userId',
    onError: ['@', 'util:print'],
    ignoreErrors: true,
  }]
}
```

### Built-in Utilities

MicroQL includes utility functions for common data operations:

```javascript
import {util} from 'microql/services'

const queries = {
  // Filter, map, reduce operations
  filtered: ['util', 'filter', {on: '$.data', service: ['data', 'isActive', {item: '@'}]}],
  mapped: ['util', 'map', {on: '$.filtered', service: ['data', 'getName', {item: '@'}]}],

  // Conditional logic
  result: ['util', 'when', {
    condition: '$.user.isAdmin',
    then: ['admin', 'getAdminData'],
    else: ['user', 'getRegularData']
  }],

  // Error handling utilities
  // When using ignoreErrors: true, failed items become null or Error objects
  cleanResults: ['$.processed', 'util:removeErrors'],    // Remove both nulls and Errors
  noNulls: ['$.processed', 'util:removeNulls'],          // Remove nulls, keep Errors for inspection
  onlyFailures: ['$.processed', 'util:removeSuccesses'], // Keep only nulls and Errors

  // Partition for batch processing
  separated: ['$.processed', 'util:partitionErrors']     // Returns {successes: [], failures: []}
}
```

#### Error Removal Utilities

When processing arrays with `ignoreErrors: true`, failed service calls return either `null` (no error handler) or the Error object (with error handler). These utilities help clean up results:

- **`util:removeErrors`** - Removes both Error objects and null values, returning only successful results
- **`util:removeNulls`** - Removes only null values, keeping Error objects for inspection/logging
- **`util:removeSuccesses`** - Inverse operation, keeps only failures (nulls and Errors)
- **`util:partitionErrors`** - Splits array into `{successes: [], failures: []}` for separate processing

Example use case:

```javascript
const result = await query({
  given: {urls: ['http://api1.com', 'http://api2.com', 'http://api3.com']},
  services: {http, storage, util},
  queries: {
    // Fetch all URLs, ignoring errors
    responses: ['$.given.urls', 'util:map', {
      service: ['http:fetch', {
        url: '@',
        onError: ['util:recordFailure', {on: '@', location: 'logs/failures'}],
        ignoreErrors: true
      }]
    }],

    // Separate successes from failures
    partitioned: ['$.responses', 'util:partitionErrors'],

    // Store only successful responses
    stored: ['$.partitioned.successes', 'storage:bulkInsert']
  }
})

// Result contains:
// - partitioned.successes: successful API responses
// - partitioned.failures: null values (errors were recorded to disk)
// - stored: confirmation of successful storage
```

### Settings & Configuration

Configure global behavior:

```javascript
const result = await query({
  settings: {
    debug: true,           // Enable debug logging
    timeout: 30000,        // Set a default timeout (30s)
    retry: 2,             // Set a default retry count
    onError: ['@', 'util:print']  // Set a global error handler
  },
  // ... services and queries
})
```

## Documentation

- **[Service Development Guide](docs/service_guide.md)** - How to write and structure services
- **[Validation System](docs/validation.md)** - Type validation and contracts

## Installation

```bash
npm install microql
```

## Examples

### API Orchestration

```javascript
// Orchestrate multiple API calls with dependency resolution
const result = await query({
  given: {customerId: 'cust_123'},
  services: {api, cache, notifications},
  queries: {
    // These run in parallel since they're independent
    customer: ['api', 'getCustomer', {id: '$.given.customerId'}],
    preferences: ['api', 'getPreferences', {id: '$.given.customerId'}],

    // This waits for customer data
    orders: ['api', 'getOrders', {customerId: '$.customer.id'}],

    // Cache the complete customer profile
    profile: ['cache', 'store', {
      key: 'profile_$.customer.id',
      data: {
        customer: '$.customer',
        preferences: '$.preferences',
        recentOrders: '$.orders'
      }
    }],

    // Send notification after everything is cached
    notification: ['notifications', 'send', {
      to: '$.customer.email',
      template: 'welcome',
      data: '$.profile'
    }]
  }
})
```

### Data Processing Pipeline

```javascript
// Transform and validate data through multiple steps
const result = await query({
  given: {csvData: "name,age,email\nJohn,25,john@example.com\n..."},
  services: {parser, validator, transformer, storage},
  queries: {
    // Chain: parse → validate → transform → store
    // uses method syntax to implicitly pass to {argOrder: 0}
    processed: [
      ['$.given.csvData', 'parser:parseCsv'],
      ['@', 'validator:validateRows'],
      ['@', 'transformer:enrichData'],
      ['@', 'storage:bulkInsert']
    ]
  }
})
```

## Testing

```bash
npm test
```

## Questions

### How is this different from GraphQL?

GraphQL is primarily developed for field extraction, whereas MicroQL was designed for service orchestration.  You can do service orchestration with GraphQL but it requires that you put a lot more leg work into resolvers and that you manually think about dependency resolution.  MicroQL infers dependency resolution and parallelism from the paths that are referenced.  MicroQL also doesn't invent a completely new syntax - it's mostly a subset of JSON.  We found ways to do that without being pedantic and verbose.

The MicroQL codebase is also small (<1000 lines), dependencies `lodash` and `zod`.

[See here for a more detailed comparison](docs/comparison-graphql.md).


### Why isn't this library written in TypeScript?

I think the problem that most people are trying to solve with TypeScript would be better solved with input validations.  That is: you can type for internal consistency all you like, but as soon as you incorporate something outside your domain, your static type analysis fails.  MicroQL is literally for composing things outside of your domain.

Secondly, Javascript compilation layers became a Tower of Babel over ten years ago.  Your main tool is literally called `babel`.  Do you really need all that?  Maybe all you need is JSON.  Try it out.

### Is it fast?

It's faster than n8n, slower than native Javascript.  Performance optimization should be considered in its infancy - particularly I have not tried this with any long running processes to ensure that there are no memory leaks.

## License

MIT

---

**MicroQL** - Microservice orchestration made simple.
