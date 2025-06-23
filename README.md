# MicroQL

![Yo dawg, I heard you like JSON](/joke.jpg)

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
  select: 'resultName'    // What to return
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