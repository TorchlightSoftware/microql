# MicroQL Service Development Guide

This guide explains how to write and structure services for MicroQL. Services are the core building blocks that contain your business logic and can be composed together to create complex workflows.

## Table of Contents

- [Service Basics](#service-basics)
- [Service Structure](#service-structure)  
- [Argument Types](#argument-types)
- [Validation](#validation)
- [Error Handling](#error-handling)
- [Testing Services](#testing-services)
- [Best Practices](#best-practices)
- [Built-in Services](#built-in-services)

## Service Basics

A MicroQL service is a JavaScript object containing async methods. Each method represents an operation that can be called from queries.

### Simple Service Example

```javascript
const userService = {
  async getUser({id}) {
    // Fetch user from database
    const user = await db.users.findById(id)
    return user
  },
  
  async createUser({userData}) {
    // Validate and create user
    const user = await db.users.create(userData)
    return user
  },
  
  async updateUser({id, updates}) {
    // Update user data
    const user = await db.users.updateById(id, updates)
    return user
  }
}
```

### Key Principles

1. **Async Methods**: All service methods should be `async` functions
2. **Single Argument**: Methods take exactly one argument object (destructured)  
3. **Return Values**: Methods return the data that will be available to other queries
4. **Pure Logic**: Services should contain pure business logic, not MicroQL-specific code

## Service Structure

### Method Signature

All service methods must follow this pattern:

```javascript
async methodName({arg1, arg2, ...otherArgs}) {
  // Your logic here
  return result
}
```

**Important**: The method receives a single object argument. Use destructuring to extract the values you need.

### Example: Math Service

```javascript
const mathService = {
  async add({a, b}) {
    return a + b
  },
  
  async multiply({values}) {
    return values.reduce((acc, val) => acc * val, 1)
  },
  
  async statistics({numbers}) {
    const sum = numbers.reduce((a, b) => a + b, 0)
    const avg = sum / numbers.length
    const min = Math.min(...numbers)
    const max = Math.max(...numbers)
    
    return {sum, avg, min, max, count: numbers.length}
  }
}
```

### Using the Service

```javascript
const result = await query({
  given: {numbers: [1, 2, 3, 4, 5]},
  services: {math: mathService},
  queries: {
    sum: ['math:add', {a: 10, b: 20}],
    product: ['math:multiply', {values: '$.given.numbers'}],
    stats: ['math:statistics', {numbers: '$.given.numbers'}]
  }
})
```

## Argument Types

You can specify type information for service arguments using the `_argtypes` property. This helps with validation and documentation.

### Basic Argument Types

```javascript
const dataService = {
  async processData({input, options, settings}) {
    // Process the data
    return processedData
  }
}

// Define argument types
dataService.processData._argtypes = {
  input: {type: 'object'},
  options: {type: 'object', optional: true},
  settings: {type: 'settings'}  // Special type for MicroQL settings
}
```

### Service Arguments

For methods that accept other services (like callbacks or transformers), use `type: 'service'`:

```javascript
const transformService = {
  async transform({data, transformer}) {
    return data.map(transformer)
  }
}

transformService.transform._argtypes = {
  data: {type: 'array'},
  transformer: {type: 'service'}
}

// Usage
const queries = {
  result: ['transform:transform', {
    data: '$.given.items',
    transformer: ['util:template', {name: '@.name', upper: '@.name.toUpperCase()'}]
  }]
}
```

## Validation

MicroQL provides built-in validation using Zod schemas. Add validation to enforce contracts on your service inputs and outputs. See the [Validation Guide](validation.md) for complete details.

### Basic Validation

```javascript
const userService = {
  async createUser({userData}) {
    // Create user logic
    return {id: generateId(), ...userData}
  }
}

// Add input validation
userService.createUser._validators = {
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

### Advanced Validation

```javascript
const orderService = {
  async createOrder({order}) {
    // Order processing logic
    return processedOrder
  }
}

orderService.createOrder._validators = {
  precheck: {
    order: {
      customerId: ['string', 'uuid'],
      items: ['array', [{
        productId: ['string'],
        quantity: ['number', 'positive', 'int'],
        price: ['number', 'positive']
      }], {min: 1}],
      shippingAddress: {
        street: ['string'],
        city: ['string'],
        zipCode: ['string', {regex: /^\d{5}(-\d{4})?$/}],
        country: ['enum', ['US', 'CA', 'MX']]
      },
      paymentMethod: ['enum', ['credit', 'debit', 'paypal']]
    }
  }
}
```

## Error Handling

Services should throw errors for exceptional conditions. MicroQL will handle these automatically and provide context.

### Throwing Errors

```javascript
const userService = {
  async getUser({id}) {
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
const queries = {
  user: ['users:getUser', {
    id: '$.given.userId',
    onError: ['users:getDefaultUser'],     // Fallback on error
    retry: 3,                              // Retry 3 times
    timeout: 5000                          // 5 second timeout
  }]
}
```

## Testing Services

Services are just regular JavaScript objects, so they're easy to unit test.

### Unit Testing

```javascript
import assert from 'node:assert'
import {describe, it} from 'node:test'

describe('Math Service', () => {
  it('should add two numbers', async () => {
    const result = await mathService.add({a: 5, b: 3})
    assert.strictEqual(result, 8)
  })
  
  it('should calculate statistics', async () => {
    const result = await mathService.statistics({numbers: [1, 2, 3, 4, 5]})
    assert.deepStrictEqual(result, {
      sum: 15,
      avg: 3,
      min: 1,
      max: 5,
      count: 5
    })
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
      queries: {
        created: ['users:createUser', {userData: '$.given.userData'}],
        retrieved: ['users:getUser', {id: '$.created.id'}]
      }
    })
    
    assert.strictEqual(result.retrieved.name, 'John')
    assert.strictEqual(result.retrieved.email, 'john@example.com')
  })
})
```

## Best Practices

### 1. Single Responsibility

Each service method should do one thing well:

```javascript
// Good: Focused responsibilities
const userService = {
  async getUser({id}) { /* ... */ },
  async createUser({userData}) { /* ... */ },
  async updateUser({id, updates}) { /* ... */ },
  async deleteUser({id}) { /* ... */ }
}

// Avoid: Mixed responsibilities
const messyService = {
  async getUserAndSendEmail({id}) { /* ... */ }  // Does too many things
}
```

### 2. Clear Argument Names

Use descriptive argument names that make the intent clear:

```javascript
// Good: Clear intent
async sendEmail({to, subject, body, attachments}) { /* ... */ }

// Avoid: Unclear arguments  
async send({a, b, c, d}) { /* ... */ }
```

### 3. Consistent Return Types

Be consistent about what your methods return:

```javascript
// Good: Consistent structure
const apiService = {
  async getUser({id}) {
    return {id, name, email, createdAt}
  },
  
  async getOrder({id}) {
    return {id, items, total, createdAt}  // Same structure pattern
  }
}
```

### 4. Use Validation

Add validation to catch errors early and document your contracts:

```javascript
const apiService = {
  async fetchData({url, options}) {
    // Implementation
  }
}

apiService.fetchData._validators = {
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
  async divide({numerator, denominator}) {
    if (denominator === 0) {
      throw new Error('Cannot divide by zero')
    }
    
    return numerator / denominator
  },
  
  async average({numbers}) {
    if (!numbers || numbers.length === 0) {
      throw new Error('Cannot calculate average of empty array')
    }
    
    return numbers.reduce((a, b) => a + b, 0) / numbers.length
  }
}
```

### 6. Keep Services Stateless

Services should not maintain state between calls:

```javascript
// Good: Stateless
const mathService = {
  async calculate({operation, values}) {
    // Uses only the arguments provided
    switch (operation) {
      case 'sum': return values.reduce((a, b) => a + b, 0)
      case 'product': return values.reduce((a, b) => a * b, 1)
      default: throw new Error(`Unknown operation: ${operation}`)
    }
  }
}

// Avoid: Stateful services
const statefulService = {
  lastResult: null,  // Don't do this
  
  async calculate({values}) {
    this.lastResult = values.reduce((a, b) => a + b, 0)  // Don't do this
    return this.lastResult
  }
}
```

## Built-in Services

MicroQL provides several built-in utility services:

### Util Service

The `util` service provides common data transformation operations:

```javascript
import {util} from 'microql/services'

const queries = {
  // Array operations
  filtered: ['util:filter', {on: '$.data', fn: item => item.active}],
  mapped: ['util:map', {on: '$.filtered', fn: item => item.name}],
  flattened: ['util:flatMap', {on: '$.nested', fn: item => item.children}],
  
  // Object operations
  picked: ['util:pick', {on: '$.user', fields: ['name', 'email']}],
  
  // Conditional logic
  result: ['util:when', {
    condition: '$.user.isAdmin',
    then: 'admin_data',
    else: 'regular_data'
  }],
  
  // Utilities
  length: ['util:length', {on: '$.items'}],
  exists: ['util:exists', {on: '$.optionalField'}]
}
```

### Available Util Methods

- `map({on, fn})` - Transform array elements
- `filter({on, fn})` - Filter array elements  
- `flatMap({on, fn})` - Map and flatten results
- `concat({arrays})` - Concatenate arrays
- `pick({on, fields})` - Extract object fields
- `length({on})` - Get length/size
- `exists({on})` - Check if value exists
- `when({condition, then, else})` - Conditional logic
- `template({...})` - Create object templates

See the [util service source](../services/util.js) for complete details.

## Creating Reusable Services

### Service Factory Pattern

For services that need configuration:

```javascript
function createApiService(baseUrl, apiKey) {
  return {
    async get({endpoint, params}) {
      const url = new URL(endpoint, baseUrl)
      if (params) {
        Object.entries(params).forEach(([key, value]) => {
          url.searchParams.set(key, value)
        })
      }
      
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      })
      
      if (!response.ok) {
        throw new Error(`API error: ${response.status} ${response.statusText}`)
      }
      
      return response.json()
    }
  }
}

// Usage
const services = {
  github: createApiService('https://api.github.com', process.env.GITHUB_TOKEN),
  stripe: createApiService('https://api.stripe.com', process.env.STRIPE_KEY)
}
```

### Service Composition

Services can use other services internally:

```javascript
const dataService = {
  async processUserData({userId}) {
    // This service composes multiple operations
    const user = await userService.getUser({id: userId})
    const preferences = await userService.getPreferences({userId})
    const orders = await orderService.getOrderHistory({userId})
    
    return {
      profile: user,
      settings: preferences,
      recentOrders: orders.slice(0, 10)
    }
  }
}
```

## Summary

Good MicroQL services are:

1. **Simple**: One responsibility per method
2. **Async**: All methods are async functions  
3. **Stateless**: Don't maintain internal state
4. **Well-typed**: Use `_argtypes` and validation
5. **Documented**: Clear method and argument names
6. **Testable**: Easy to unit test in isolation
7. **Composable**: Can be combined with other services

Following these patterns will make your services reliable, maintainable, and easy to work with in MicroQL queries.
