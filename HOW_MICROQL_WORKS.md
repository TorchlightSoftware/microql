# How MicroQL Works - Architecture and Design Principles

This document explains MicroQL's architecture, execution model, and design principles to prevent confusion about how the system works.

## Core Architecture

MicroQL is a query language that orchestrates asynchronous service calls with sophisticated data flow and context management.

### 1. Query Structure

```javascript
{
  given: { /* input data */ },
  services: { /* service implementations */ },
  methods: ['service1', 'service2'], // Services that support method syntax
  query: { /* execution plan */ },
  select: 'resultField' // Optional: select specific result
}
```

### 2. Service Call Syntax

**Regular Syntax:**
```javascript
['serviceName', 'action', { arg1: 'value1', arg2: '@.field' }]
```

**Method Syntax (syntactic sugar):**
```javascript
['@.data', 'service:action', { arg1: 'value1' }]
// Transforms to: ['service', 'action', { on: '@.data', arg1: 'value1' }]
```

**Method syntax works everywhere** - in task definitions and within chain steps:
```javascript
// At task level
filtered: ['$.items', 'util:filter', { criteria: 'active' }]

// Within chains
result: [
  ['util', 'concat', { args: [...] }],
  ['@', 'util:map', { template: { processed: '@.value' } }]  // ✅ Works!
]
```

## Context System and @ Symbol Resolution

### Context Stack

MicroQL maintains a **context stack** during execution that enables sophisticated data flow:

```javascript
// Context stack grows left to right, @ symbols reference right to left
contextStack = [oldest, ..., newest]
contextStack[length-1] = @     // most recent (newest)
contextStack[length-2] = @@    // second most recent
contextStack[length-3] = @@@   // third most recent
// etc.
```

### Context Resolution Examples

**Single Level:**
```javascript
['$.users', 'util:map', {
  template: { name: '@.name', role: '@.role' }
}]
```
- `@.name` = current user's name in the iteration (most recent context)

**Nested Levels:**
```javascript
['$.companies', 'util:flatMap', {
  fn: ['@.departments', 'util:flatMap', {
    fn: ['@.employees', 'util:map', {
      fn: ['user', 'create', {
        name: '@.name',        // Current employee (most recent context)
        department: '@@.name', // Department name (second most recent context)
        company: '@@@.name'    // Company name (third most recent context)
      }]
    }]
  }]
}]
```

**Context Stack During Execution:**
1. Company iteration: `@` = company, `contextStack = [company]`
2. Department iteration: `@` = department, `@@` = company, `contextStack = [company, department]`
3. Employee iteration: `@` = employee, `@@` = department, `@@@` = company, `contextStack = [company, department, employee]`

Note: `@` always refers to the most recent context (rightmost in the stack).

## Execution Model

### 1. Task-Level Parsing

The main query processor:
1. **Parses descriptors** into tasks with dependencies
2. **Detects method syntax** using `parseMethodCall()`
3. **Creates execution plan** with proper dependency ordering
4. **Executes tasks** in parallel where possible

### 2. Function Compilation

When services need functions (e.g., `util.map({ fn: [...] })`):
1. **Compiles service descriptors** into JavaScript functions using `compileServiceFunction()`
2. **Handles method syntax** uniformly using `transformMethodSyntax()`
3. **Resolves context references** when functions execute
4. **Maintains context stack** through nested calls

### 3. Method Syntax Transformation

**Design Principle: Normalize Early, Execute Uniformly**

Method syntax is **syntactic sugar** that gets transformed once:

```javascript
// Input
['@.departments', 'util:flatMap', { fn: [...] }]

// Transformed to
['util', 'flatMap', { on: '@.departments', fn: [...] }]
```

This transformation happens in **one place** (`transformMethodSyntax`) and is used by:
- Task-level parsing (`parseMethodCall`)
- Function compilation (`compileServiceFunction`)

## Error Handling Architecture

### Service Execution Guard

All service calls are wrapped with `guardServiceExecution()` which:
1. **Provides context** about which query task is executing
2. **Shows service arguments** for debugging
3. **Preserves original errors** while adding context
4. **Points to query location** rather than internal implementation

### Error Message Format

```
Error in service util.flatMap in query task 'listings': Error in service scraper.extract: Protocol error
Args: { /* full arguments for debugging */ }
```

## Key Design Principles

### 1. DRY (Don't Repeat Yourself)

- **Single method syntax detection** in `transformMethodSyntax()`
- **Unified error handling** in `guardServiceExecution()`
- **Consistent context resolution** in `resolveArgsWithContext()`

### 2. Separation of Concerns

- **Transformation logic** separated from validation logic
- **Context resolution** separated from service execution
- **Error context** separated from error handling

### 3. Elegance Through Normalization

Method syntax is **not a special case** - it's normalized to regular syntax early, then everything else works uniformly.

## Common Patterns

### Nested Data Processing

```javascript
// Process nested data structures
results: ['$.companies', 'util:flatMap', {
  fn: ['@.departments', 'util:flatMap', {
    fn: ['@.employees', 'util:map', {
      fn: ['processor', 'transform', {
        employee: '@.name',
        dept: '@@.name', 
        company: '@@@.name'
      }]
    }]
  }]
}]
```

### Chain Operations

```javascript
// Sequence of transformations in a chain
obsidianRecords: [
  // Step 1: Merge data
  ['util', 'concat', { args: [...] }],
  // Step 2: Transform results from step 1
  ['@', 'util:map', { fn: [...] }]
]
```

## What NOT To Do

### ❌ Duplicate Logic
```javascript
// DON'T: Check for method syntax in multiple places
if (dataSource.startsWith('@') && methodName.includes(':')) { ... }
// DO: Use transformMethodSyntax() consistently
```

### ❌ Special Case Handling
```javascript
// DON'T: Handle method syntax as special case everywhere
// DO: Transform once, execute uniformly
```

### ❌ Break Query Structure
```javascript
// DON'T: Flatten sophisticated nested chains
obsidianRecords: [
  step1: ['...'],
  step2: ['...'], 
  // This loses the power of context chaining
]

// DO: Preserve nested structure for context flow
obsidianRecords: [
  ['util', 'concat', {
    args: [
      ['$.listings', 'util:flatMap', { 
        fn: ['@.images', 'util:map', { fn: [...] }] 
      }]
    ]
  }]
]
```

## Reserved Parameters

MicroQL interprets certain parameters specially before passing them to services:

### timeout
Controls execution timeout in milliseconds:
```javascript
['service', 'action', { 
  data: '@.value',
  timeout: 5000  // 5 second timeout
}]
```

### retry
Automatically retry failed operations:
```javascript
['claude', 'ocr', { 
  imageUrl: '@.src',
  retry: 3  // Try up to 4 times total (1 initial + 3 retries)
}]
```

Services receive these values in args but MicroQL handles the actual timeout/retry logic.

For complete details on reserved parameters and service writing, see [SERVICE_WRITER_GUIDE.md](SERVICE_WRITER_GUIDE.md).

## Summary

MicroQL's power comes from:
1. **Sophisticated context chaining** with @ symbols (most recent context first)
2. **Method syntax** as clean syntactic sugar universally available
3. **Uniform execution model** after early normalization
4. **Comprehensive error context** for debugging
5. **Built-in reliability** with timeout and retry mechanisms

The system is designed to handle complex nested data transformations elegantly while providing clear error messages that point to the query location, not internal implementation details.

## Related Documentation

- [README.md](README.md) - Quick start and basic usage
- [SERVICE_WRITER_GUIDE.md](SERVICE_WRITER_GUIDE.md) - Complete guide for service developers
- [CONTEXT_SYNTAX.md](CONTEXT_SYNTAX.md) - Detailed @ symbol syntax and examples