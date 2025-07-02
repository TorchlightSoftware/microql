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
- **Chain References**: Use `@`, `@@`, `@@@` for sophisticated nested data access
- **Built-in Reliability**: Timeout and retry mechanisms

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

Services can be functions or objects (auto-wrapped). For complete service writing guidance including best practices, parameter handling, and examples, see [SERVICE_WRITER_GUIDE.md](SERVICE_WRITER_GUIDE.md).

### @ Symbol Usage

- `@` - first level in chain
- `@@` - second level in chain  
- `@.field` - Access field from chain level

## Timeouts & Reliability

MicroQL provides built-in reliability features:

- **Timeouts**: Prevent hanging service calls with configurable timeouts
- **Retries**: Automatically retry failed operations
- **Error Context**: Rich error messages with query context
- **Error Handling**: Flexible error handling with onError and ignoreErrors

### Implicit Parameters

All service calls support these reserved parameters:

```js
query: {
  // All implicit parameters example
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
