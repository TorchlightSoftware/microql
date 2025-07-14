# MicroQL

A query language for composing microservices using promises and modern JavaScript.

## Overview

MicroQL lets you compose multiple async services (APIs, databases, etc.) declaratively using JSON. It automatically infers dependencies and executes with maximum concurrency.

## Basic Usage

```js
import query from 'microql'

const result = await query({
  given: { orderId: 'ORDER-123', customerId: 'CUST-456' },
  services: { orders, payments, shipping },
  query: {
    // Fetch order details
    order: ['orders', 'getOrder', { id: '$.given.orderId' }],
    
    // Process payment using order total
    payment: ['payments', 'chargeCard', { 
      customerId: '$.given.customerId',
      amount: '$.order.total' 
    }],
    
    // Create shipment after payment succeeds
    shipment: ['shipping', 'createLabel', {
      order: '$.order',
      paymentId: '$.payment.transactionId'
    }],
  },
  select: 'shipment'
})
// Returns: { trackingNumber: "1Z999AA1012345678", status: "ready" }
```

## New Features

### Key Features

- **Service Object Auto-Wrapping**: Provide service objects that get automatically wrapped
- **Method Syntax**: Use cleaner syntax like `['@.data', 'service:method', args]`
- **Service Chains**: Chain operations using the `@` symbol for chain flow
- **Context References**: Use `@`, `@@`, `@@@` for current, parent, or grandparent context
- **Array Literal Support**: Pass arrays directly as static arguments (e.g., `numbers: [1, 2, 3]`)
- **Built-in Reliability**: Timeout and retry mechanisms
- **AST-Based Execution**: Compile-time optimization with centralized execution state

For detailed examples and advanced usage, see [HOW_MICROQL_WORKS.md](HOW_MICROQL_WORKS.md).

## API Reference

### Query Structure

```js
{
  given: {},              // Input data (was 'input' in v0.1)
  services: {},           // Available services  
  methods: [],            // Services that support method syntax
  query: {},              // Jobs to execute (was 'jobs' in v0.1)
  select: 'resultName',   // What to return
  settings: {             // Query configuration (optional)
    timeout: { default: 5000 },  // Default timeout settings
    inspect: {                   // Error output and util:print formatting
      depth: 2,
      maxArrayLength: 3,
      maxStringLength: 140
    }
  }
}
```

### Service Types

Services can be functions or objects (auto-wrapped). For complete service writing guidance including best practices, argument handling, and examples, see [SERVICE_WRITER_GUIDE.md](SERVICE_WRITER_GUIDE.md).

### Array Literal Arguments

Arrays can be passed directly as static arguments to services:

```js
query: {
  processed: ['math', 'sum', { numbers: [1, 2, 3, 4, 5] }],
  joined: ['text', 'concatenate', { strings: ['hello', 'world', 'test'] }],
  mixed: ['calc', 'compute', { 
    data: [10, 20, 30], 
    multiplier: '$.given.factor' 
  }]
}
```

**Important**: Array literals are treated as static data. Service calls in arguments are only valid for `{type: 'function'}` arguments. Use `@` and `$` references for service dependencies.

### @ Symbol Usage

- `@` - current context (innermost)
- `@@` - parent context  
- `@@@` - grandparent context
- `@.field` - Access field from current context

## Timeouts & Reliability

MicroQL provides built-in reliability features:

- **Timeouts**: Prevent hanging service calls with configurable timeouts
- **Retries**: Automatically retry failed operations
- **Error Context**: Rich error messages with query context
- **Error Handling**: Flexible error handling with onError and ignoreErrors

### Implicit Arguments

All service calls support these reserved arguments:

```js
query: {
  // All implicit arguments example
  data: ['api', 'getData', { 
    id: '$.given.id',
    timeout: 5000,      // 5 second timeout
    retry: 3,           // Try up to 4 times total
    onError: ['@', 'logger', 'logError'],  // Custom error handler
    ignoreErrors: true  // Continue on error (returns null)
  }]
}
```

### Error Handling

MicroQL provides flexible error handling at both service and query levels:

#### Service-Level Error Handling
- **onError**: Call a service when this specific call fails
- **ignoreErrors**: Continue execution on error (returns null)

#### Query-Level Error Handling
```js
{
  services: { logger },
  query: { /* ... */ },
  onError: ['@', 'logger', 'logError'],  // Handle any unhandled errors
}
```

#### Default Error Behavior
Without explicit error handlers:
- Errors use consistent format: `Error: :queryName: [service:action] message`
- Args are displayed using compact inspect settings
- Errors are printed in red to stderr
- Process exits with code 1

Example error output:
```
Error: :listings: [util:flatMap][scraper:extract] Validation failed for "images"
Args: { url: 'https://example.com', queries: { images: 'img.photo' } }
```

For complete error handling details, see [HOW_MICROQL_WORKS.md#error-handling](HOW_MICROQL_WORKS.md#error-handling).

## Architecture

### AST-Based Execution

MicroQL uses a sophisticated Abstract Syntax Tree (AST) approach for optimal performance:

- **Compile-time optimization**: All transformations, dependency analysis, and wrapper application happen during compilation
- **Centralized execution state**: Query results, execution promises, and service usage tracked in `ast.execution`
- **AST navigation**: Context resolution uses parent/root references instead of runtime threading
- **Clean dependency coordination**: Nodes access query results via `node.getQueryResult(queryName)`

### Execution Flow

1. **Compilation Phase**: Parse queries into AST with all context relationships established
2. **Dependency Resolution**: Determine execution order based on `$` references
3. **Parallel Execution**: Execute independent queries concurrently while respecting dependencies
4. **Context Access**: Service chains access previous results through AST navigation
5. **Service Tracking**: Track used services for proper tearDown execution

This architecture provides:
- **Better Performance**: No runtime context threading or global state
- **Cleaner Code**: Elimination of complex detection rules and special cases
- **Easier Debugging**: Centralized execution state and clear AST structure
- **Maintainability**: Separation of compile-time vs runtime concerns

## Migration from v0.1

- `input` → `given`
- `jobs` → `query`
- Callbacks → Promises/async-await
- Add `methods: []` for method syntax support

## Dependencies

- `jsonpath` - For JSONPath query support

## Documentation

- **[SERVICE_WRITER_GUIDE.md](SERVICE_WRITER_GUIDE.md)** - Complete guide for writing services
- **[HOW_MICROQL_WORKS.md](HOW_MICROQL_WORKS.md)** - Architecture and execution model
- **[CONTEXT_SYNTAX.md](CONTEXT_SYNTAX.md)** - @ symbol syntax and complex examples

## License

MIT
