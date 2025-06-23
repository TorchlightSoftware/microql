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

### Service Object Auto-Wrapping

You can now provide service objects that get automatically wrapped:

```js
const dataService = {
  async validate({ email }) { 
    return email.includes('@') && email.includes('.')
  },
  async normalize({ email }) { 
    return email.toLowerCase().trim()
  }
}

await query({
  given: { userEmail: 'John.Doe@EXAMPLE.COM' },
  services: { dataService },
  query: {
    isValid: ['dataService', 'validate', { email: '$.given.userEmail' }],
    normalized: ['dataService', 'normalize', { email: '$.given.userEmail' }]
  }
})
```

### Method Syntax

Use method syntax for cleaner queries:

```js
await query({
  given: { items: ['laptop', 'mouse', 'keyboard'] },
  services: { inventory },
  methods: ['inventory'],  // Enable method syntax for inventory
  query: {
    inStock: ['$.given.items', 'inventory:checkStock', { warehouse: 'east' }]
  }
})
```

### Service Chains

Chain operations using the `@` symbol:

```js
await query({
  given: { documentUrl: 'https://example.com/report.pdf' },
  services: { downloader, parser, analyzer },
  query: {
    processedDoc: [
      ['downloader', 'fetch', { url: '$.given.documentUrl' }],
      ['parser', 'extractText', { data: '@' }],  // @ refers to downloaded data
      ['analyzer', 'getSummary', { text: '@', maxLength: 500 }]
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
  select: 'resultName',   // What to return
  timeouts: {}            // Timeout configuration (optional)
}
```

### Service Types

**Function Services:**
```js
const myService = async (action, args) => {
  if (action === 'getData') return await fetchData(args.id)
  if (action === 'saveData') return await saveData(args.data)
}
```

**Object Services (auto-wrapped):**
```js
const myService = {
  async getData({ id }) { return await fetchData(id) },
  async saveData({ data }) { return await saveData(data) }
}
```

### @ Symbol Usage

- `@` - Previous result in a chain
- `@.field` - Access field of previous result

## Timeouts

MicroQL provides comprehensive timeout support to prevent hanging service calls:

### Configuration

```js
await query({
  given: { data: 'example' },
  services: { api, database },
  timeouts: {
    default: 3000,    // 3 second default for all services
    api: 10000,       // 10 seconds for API calls
    database: 5000    // 5 seconds for database calls
  },
  query: {
    result: ['api', 'getData', { id: '$.given.data' }]
  }
})
```

### Timeout Priority (highest to lowest)

1. **Argument-level timeout** - Set `timeout` in service call arguments
2. **Service-specific timeout** - Set in `timeouts.serviceName`
3. **Default timeout** - Set in `timeouts.default`
4. **No timeout** - Service runs indefinitely

### Argument-Level Timeouts

```js
query: {
  // This call will timeout after 500ms regardless of config
  urgentCall: ['api', 'getData', { 
    id: '$.given.id',
    timeout: 500
  }],
  
  // This call uses service/default timeout from config
  normalCall: ['api', 'getData', { id: '$.given.id' }]
}
```

### Timeout Behavior

- Timeouts apply to individual service calls, not entire queries
- Service chains: each step gets its own timeout
- Parallel execution: each service call gets its own timeout
- The `timeout` argument is passed through to services for their own use
- Timeout errors include service name and duration for debugging

## Migration from v0.1

- `input` → `given`
- `jobs` → `query`
- Callbacks → Promises/async-await
- Add `methods: []` for method syntax support

## Dependencies

- `jsonpath` - For JSONPath query support

## License

MIT
