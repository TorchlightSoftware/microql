# MicroQL Service Writer's Guide

## Overview

This guide explains how to write services that work with MicroQL while maintaining proper architectural separation.

## Core Architectural Principle

**Services and MicroQL must remain completely independent**. Services should:
- Know nothing about MicroQL internals
- Not import from MicroQL modules
- Work as standalone JavaScript modules
- Only be coupled through the query execution

## Writing a Service

### Basic Service Structure

A collection of services can be either a functions or an object:

```javascript
// Function-based service
const myService = async (action, args) => {
  switch (action) {
    case 'getData':
      return await fetchData(args.id)
    case 'saveData':
      return await saveData(args.data)
    default:
      throw new Error(`Unknown action: ${action}`)
  }
}

// Object-based service (recommended)
const myService = {
  async getData({ id }) {
    return await fetchData(id)
  },

  async saveData({ data }) {
    return await saveData(data)
  }
}
```

You can also implement it as a class, which is particularly useful if you need to maintain state, like a database connection or a webserver.

### Reserved Parameters

MicroQL reserves certain parameter names for special handling:

- **`timeout`**: Execution timeout in milliseconds
- **`retry`**: Number of retry attempts on failure

Your service receives these values but in most cases you don't need to do anything with them because MicroQL implements the logic already.

### Method Syntax Support

To enable method syntax for your service, it must handle the `on` parameter:

```javascript
const dataProcessor = {
  async transform({ on, format }) {
    // 'on' contains the data when called with method syntax:
    // ['@.data', 'processor:transform', { format: 'json' }]
    const data = on

    switch (format) {
      case 'json':
        return JSON.stringify(data, null, 2)
      case 'csv':
        return convertToCSV(data)
      default:
        return data
    }
  }
}
```

### Function and Template Parameters

If your service calls other services or receives a template, the corresponding parameter must be annotated with a `type` property.

```javascript
const utilService = {
  async map({ on, fn, template }) {

    // For function parameters, MicroQL compiles them
    if (fn && typeof fn === 'function') {
      return await Promise.all(on.map(fn))
    }

    // For templates, handle @ symbol substitution
    if (template) {
      return on.map(item => applyTemplate(template, item))
    }
  }
}

// Service annotations tell MicroQL to prepare arguments appropriately
utilService.map._params = {
  fn: { type: 'function' },      // Compiled as service call function
  template: { type: 'template' } // Compiled as template resolver function
}
```

For both service and template functions:

- Receives the iteration item as a parameter
- Adds the iteration item to the context stack
- Returns the resolved template object with all @ symbols properly resolved
- Can be called with @, @@, @@@, etc. to represent first, second, third level context within the query.

### Inspect Parameter

- **`{type: 'inspect'}`** - Parameter receives the query's inspect configuration for consistent application of verbosity levels throughout our logging.

#### Template Parameters

Template objects marked with `{type: 'template'}` are compiled as functions with full @ symbol support:

```javascript
// Query using template with nested @ context
['$.items', 'util:flatMap', {
  fn: ['@.categories', 'util:map', {
    template: {
      categoryName: '@.name',  // parent item's category name
      url: '@@.href'   // current item's href
    }
  }]
}]
```

When using `{type: 'template'}`, MicroQL compiles the template into a function that:

These help MicroQL know how to handle special parameters while maintaining service independence.

## What NOT to Do

### ❌ Don't Import MicroQL Internals

```javascript
// WRONG - Creates coupling
import { resolveArgsWithContext } from '../microql/query.js'

const myService = {
  async process({ data }) {
    // Don't use MicroQL internals
    const resolved = resolveArgsWithContext(data, ...)
  }
}
```

### ❌ Don't Depend on MicroQL Context

```javascript
// WRONG - Service knows about MicroQL internals
const myService = {
  async process({ data, _microqlContext }) {
    // Services should not know about MicroQL's internal context
  }
}
```

### ❌ Don't Import Other Services Directly

```javascript
// WRONG - Direct service-to-service coupling
import otherService from './other-service.js'

const myService = {
  async process({ data }) {
    // Don't call other services directly
    return otherService.transform(data)
  }
}
```

## Best Practices

### 1. Keep Services Pure

Services should be pure business logic without framework dependencies:

```javascript
// GOOD - Pure service implementation
export default {
  async analyzeText({ text, language = 'en' }) {
    // Pure business logic
    const words = text.split(/\s+/)
    const sentences = text.split(/[.!?]+/)

    return {
      wordCount: words.length,
      sentenceCount: sentences.length,
      language
    }
  }
}
```

### 2. Handle Errors Gracefully

Return meaningful errors that help with debugging:

```javascript
const apiService = {
  async fetchData({ endpoint, apiKey }) {
    if (!endpoint) {
      throw new Error('Endpoint is required')
    }

    if (!apiKey) {
      throw new Error('API key is required')
    }

    try {
      const response = await fetch(endpoint, {
        headers: { 'Authorization': `Bearer ${apiKey}` }
      })

      if (!response.ok) {
        throw new Error(`API request failed: ${response.status} ${response.statusText}`)
      }

      return await response.json()
    } catch (error) {
      // Wrap errors with context
      throw new Error(`Failed to fetch from ${endpoint}: ${error.message}`)
    }
  }
}
```

**Error Handling Philosophy:**
- **Just throw errors** - Don't add console.log or console.error statements
- **MicroQL handles formatting** - All error output is centralized and consistent
- **Focus on clear messages** - Your error messages will be wrapped with service context automatically

### 3. Document Your Service

Use JSDoc to document parameters and return values:

```javascript
/**
 * Image processing service
 */
const imageService = {
  /**
   * Resize an image to specified dimensions
   */
  async resize({ imageUrl, width, height, format = 'jpeg' }) {
    // Implementation
  }
}
```

### 4. Make Services Testable

Services should be easily testable in isolation:

```javascript
// service.test.js
import imageService from './image-service.js'

describe('Image Service', () => {
  it('should resize images', async () => {
    const result = await imageService.resize({
      imageUrl: 'https://example.com/image.jpg',
      width: 200,
      height: 200
    })

    expect(result).toBeInstanceOf(Buffer)
  })
})
```

