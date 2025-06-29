# MicroQL Context Syntax: @ vs @@ Symbols

This document explains MicroQL's context reference syntax using `@` symbols and how function compilation works.

## Overview

MicroQL provides a powerful context reference system that allows you to access data at different levels of nesting:

- `@` - References the most recent context level (contextStack[contextStack.length - 1])
- `@@` - References the second most recent context level (contextStack[contextStack.length - 2])
- `@@@` - References the third most recent context level (contextStack[contextStack.length - 3])
- And so on...

## Context Hierarchy

MicroQL maintains a context stack that grows as you nest operations. Context levels are added to the stack in execution order:

1. **Chain Results**: Each step in a service chain adds its result to the context stack
2. **Iteration Items**: Each level of iteration (map, flatMap, filter) adds the current item to the context stack
3. **Relative Indexing**: @ always refers to the most recent context (contextStack[length-1]), @@ to the second most recent (contextStack[length-2]), etc.

## Parameter Metadata

Services can declare parameter metadata to control how MicroQL processes their arguments:

```javascript
// Parameter metadata tells MicroQL how to handle arguments
util.map._params = {
  fn: { type: 'function' },      // Compile service descriptors to functions
  template: { type: 'template' }  // Skip @ resolution, let service handle it
}

util.filter._params = {
  predicate: { type: 'function' }
}

util.flatMap._params = {
  fn: { type: 'function' }
}
```

## Function Compilation

When MicroQL encounters a parameter marked as `{ type: 'function' }` that contains a service descriptor with `@` symbols, it compiles the descriptor into a JavaScript function.

### Example: Simple Mapping

```javascript
['util', 'map', {
  collection: [
    { name: 'Alice', department: 'Engineering' },
    { name: 'Bob', department: 'Marketing' }
  ],
  fn: ['logger', 'log', { message: '@.name' }]  // @ refers to current item
}]
```

MicroQL compiles `['logger', 'log', { message: '@.name' }]` into:
```javascript
async (item) => {
  return await logger('log', { message: item.name })
}
```

## Context Stack Examples

### Single Level Context

```javascript
['@.users', 'util:map', {
  template: { name: '@.name', role: '@.role' }
}]
```

- `@.users` - Chain result (from previous step)
- `@.name` - Current user in iteration
- `@.role` - Current user in iteration

### Nested Context (Multiple Levels)

```javascript
['$.companies', 'util:flatMap', {             // Iterate over companies
  fn: ['util', 'flatMap', {                  
    collection: '@.departments',              // @ = company (contextStack[0])
    fn: ['util', 'map', {
      collection: '@.teams',                  // @ = company, @@ = department
      fn: ['user', 'create', {
        name: '@@@.name',                     // @@@ = team member (contextStack[2])
        team: '@@.name',                      // @@ = department (contextStack[1])
        company: '@.name'                     // @ = company (contextStack[0])
      }]
    }]
  }]
}]
```

Context stack during execution:
1. `@` (most recent) - Team member object
2. `@@` (second most recent) - Department object  
3. `@@@` (third most recent) - Company object

### Complex Example

```javascript
['$.companies', 'util:flatMap', {
  fn: ['@.departments', 'util:flatMap', {
    fn: ['@.teams', 'util:map', {
      fn: ['db', 'createUser', {
        name: '@.name',           // Current team member (most recent context)
        email: '@.email',         // Current team member (most recent context)
        team: '@@.name',          // Team name (second most recent context)
        department: '@@@.name',   // Department name (third most recent context)
        company: '@@@@.name'      // Company name (fourth most recent context)
      }]
    }]
  }]
}]
```

## Template vs Function Parameters

### Templates

Templates (marked with `{ type: 'template' }`) are processed by the service itself:

```javascript
['util', 'map', {
  collection: [{ id: 1 }, { id: 2 }],
  template: { newId: '@.id', processed: true }
}]
```

The util service receives the template as-is and processes `@` symbols during iteration.

### Functions

Functions (marked with `{ type: 'function' }`) are compiled by MicroQL:

```javascript
['util', 'map', {
  collection: [{ id: 1 }, { id: 2 }],
  fn: ['processor', 'transform', { input: '@.id' }]
}]
```

MicroQL compiles this into a function before passing it to the util service.

## Error Handling

MicroQL validates context depth:

```javascript
// Error: @@@ used but only 2 levels of function context available
['@.items', 'util:map', {
  fn: ['service', 'action', { value: '@@@.field' }]
}]
```

This error occurs when you try to access a context level that doesn't exist.

## Migration Guide

### Before (Separation of Concerns Violation)

```javascript
// util.js had duplicate resolution logic
const executeServiceCall = async (serviceCall, currentItem, services) => {
  // Manual @ resolution and service execution
}
```

### After (Clean Separation)

```javascript
// MicroQL handles all resolution and function compilation
util.map._params = { fn: { type: 'function' } }

async map({ fn }) {
  // fn is now a compiled function
  return items.map(item => fn(item))
}
```

## Best Practices

1. **Use explicit context levels**: Prefer `@@.field` over relying on implicit binding
2. **Document context expectations**: Comment complex nested operations
3. **Validate context depth**: Test with various nesting levels
4. **Keep nesting shallow**: Deep nesting can be hard to understand

## Implementation Details

- Context stack is maintained as an array that grows during nested operations
- `@` binds to `contextStack[contextStack.length - 1]` (most recent context)
- `@@` binds to `contextStack[contextStack.length - 2]` (second most recent context)
- Function compilation creates closures that capture the context stack at compilation time
- Parameter metadata prevents premature @ resolution for function and template parameters

For complete service writing guidance, see [SERVICE_WRITER_GUIDE.md](SERVICE_WRITER_GUIDE.md).

For architectural details, see [HOW_MICROQL_WORKS.md](HOW_MICROQL_WORKS.md).