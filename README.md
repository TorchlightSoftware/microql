# MicroQL

![Yo dawg, I heard you like JSON](/joke.jpg)

A query language for composing microservices using promises and modern JavaScript.

## Overview

MicroQL lets you compose multiple async services (APIs, databases, etc.) declaratively using JSON. It automatically infers dependencies and executes with maximum concurrency.

## Basic Usage

```js
import query from 'microql'

const result = await query({
  given: { car: 'Monkey' },
  services: { fieldAgent, truck },
  query: {
    // result       service        action            args
    monkey:    ['fieldAgent', 'findAnimal',     { animal: '$.given.car' }],
    caged:     ['fieldAgent', 'tranquilize',    { animal: '$.monkey' }],
    pet:       ['truck',      'bringHome',      { animal: '$.caged' }],
  },
  select: 'pet'
})
// Returns: "Friendly Sleepy Monkey"
```

## New Features

### Service Object Auto-Wrapping

You can now provide service objects that get automatically wrapped:

```js
const util = {
  async map({ on, fn }) { /* implementation */ },
  async filter({ on, predicate }) { /* implementation */ }
}

await query({
  given: { items: ['apple', 'banana', 'cherry'] },
  services: { util },
  query: {
    filtered: ['util', 'filter', { on: '$.given.items', predicate: 'a' }]
  }
})
```

### Method Syntax

Use method syntax for cleaner queries:

```js
await query({
  given: { items: ['test1', 'test2'] },
  services: { util },
  methods: ['util'],  // Enable method syntax for util
  query: {
    filtered: ['$.given.items', 'util:filter', { predicate: '1' }]
  }
})
```

### Service Chains

Chain operations using the `@` symbol:

```js
await query({
  given: { creatureType: 'Cat' },
  services: { fieldAgent, truck },
  query: {
    petChain: [
      ['fieldAgent', 'findAnimal', { animal: '$.given.creatureType' }],
      ['fieldAgent', 'tranquilize', { animal: '@' }],  // @ refers to previous result
      ['truck', 'bringHome', { animal: '@' }]
    ]
  }
})
```

## API Reference

### Query Structure

```js
{
  given: {},              // Input data (was 'input' in v0.1)
  services: {},           // Available services  
  methods: [],            // Services that support method syntax
  query: {},              // Jobs to execute (was 'jobs' in v0.1)
  select: 'resultName'    // What to return
}
```

### Service Types

**Function Services:**
```js
const myService = async (action, args) => {
  if (action === 'doSomething') return 'result'
}
```

**Object Services (auto-wrapped):**
```js
const myService = {
  async doSomething(args) { return 'result' }
}
```

### @ Symbol Usage

- `@` - Previous result in a chain
- `@.field` - Access field of previous result
- `@fieldName` - Access named field of previous result

## Migration from v0.1

- `input` → `given`
- `jobs` → `query`
- Callbacks → Promises/async-await
- Add `methods: []` for method syntax support

## Dependencies

- `jsonpath` - For JSONPath query support

## License

MIT