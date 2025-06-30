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

Services can be either functions or objects:

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

### Reserved Parameters

MicroQL reserves certain parameter names for special handling:

- **`timeout`**: Execution timeout in milliseconds
- **`retry`**: Number of retry attempts on failure

Your service receives these values but MicroQL handles the actual logic:

```javascript
const myService = {
  async fetchData({ url, timeout, retry }) {
    // You can use timeout/retry for logging or service-specific behavior
    console.log(`Fetching ${url} (timeout: ${timeout}ms, retry: ${retry})`)
    
    // Your service logic here
    return await fetch(url)
  }
}
```

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

### Function Parameters

If your service accepts functions that should be executed by MicroQL:

```javascript
const utilService = {
  async map({ collection, fn, template }) {
    const items = collection || []
    
    // For function parameters, MicroQL compiles them
    if (fn && typeof fn === 'function') {
      return await Promise.all(items.map(fn))
    }
    
    // For templates, handle @ symbol substitution
    if (template) {
      return items.map(item => applyTemplate(template, item))
    }
  }
}

// Mark parameters that need special handling
utilService.map._params = {
  fn: { type: 'function' },    // Compiled as service call function
  template: { type: 'template' }  // Skip @ resolution, handle in service
}

// For services that need inspect settings (like util.print)
utilService.print._params = {
  inspect: { type: 'inspect' }  // Use query-level inspect settings
}
```

### Parameter Types

MicroQL supports several parameter type annotations:

- **`{type: 'function'}`** - Parameter contains service descriptor that MicroQL compiles into a callable function
- **`{type: 'template'}`** - Parameter contains @ symbols for context-aware object transformation. Service receives raw template with @ symbols and the full context stack for proper @ resolution (including @@, @@@, etc.)
- **`{type: 'inspect'}`** - Parameter receives the query's inspector function for consistent formatting

#### Template Parameter Details

Template parameters provide context-aware object transformation with full @ symbol support:

```javascript
// Query using template with nested @ context
['$.items', 'util:flatMap', {
  fn: ['@.categories', 'util:map', {
    template: { 
      name: '@.text',        // Current category
      parentUrl: '@@.href'   // Parent item's href
    }
  }]
}]
```

When using `{type: 'template'}`, your service receives:
- The raw template object with unresolved @ symbols
- `_contextStack` parameter containing the execution context stack for proper @@ resolution

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
   * @param {Object} args - Arguments object
   * @param {string} args.imageUrl - URL of the image to resize
   * @param {number} args.width - Target width in pixels
   * @param {number} args.height - Target height in pixels
   * @param {string} [args.format='jpeg'] - Output format (jpeg, png, webp)
   * @returns {Promise<Buffer>} Resized image buffer
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

## Example: Complete Service

Here's a complete example following all best practices:

```javascript
/**
 * Weather service for fetching weather data
 * Works standalone or with MicroQL
 */
class WeatherService {
  constructor(apiKey = process.env.WEATHER_API_KEY) {
    this.apiKey = apiKey
    this.baseUrl = 'https://api.weather.com/v1'
  }

  /**
   * Get current weather for a location
   * @param {Object} args
   * @param {string} args.location - City name or coordinates
   * @param {string} [args.units='metric'] - Temperature units
   * @param {number} [args.timeout] - Request timeout (handled by MicroQL)
   * @param {number} [args.retry] - Retry attempts (handled by MicroQL)
   * @returns {Promise<Object>} Weather data
   */
  async getCurrent({ location, units = 'metric', timeout, retry }) {
    if (!location) {
      throw new Error('Location is required')
    }
    
    const url = `${this.baseUrl}/current?location=${location}&units=${units}`
    
    try {
      const response = await fetch(url, {
        headers: { 'X-API-Key': this.apiKey }
      })
      
      if (!response.ok) {
        throw new Error(`Weather API error: ${response.status}`)
      }
      
      return await response.json()
    } catch (error) {
      throw new Error(`Failed to fetch weather for ${location}: ${error.message}`)
    }
  }

  /**
   * Get weather forecast
   * @param {Object} args
   * @param {string} args.location - City name or coordinates  
   * @param {number} [args.days=5] - Number of days to forecast
   * @returns {Promise<Array>} Forecast data
   */
  async getForecast({ location, days = 5 }) {
    // Implementation similar to getCurrent
  }
}

// Export as MicroQL-compatible service object
export default new WeatherService()
```

## Testing Your Service

Always test your service both standalone and with MicroQL:

```javascript
// Standalone test
const weather = await weatherService.getCurrent({ 
  location: 'London' 
})

// MicroQL test
const result = await query({
  given: { city: 'London' },
  services: { weather: weatherService },
  query: {
    current: ['weather', 'getCurrent', { 
      location: '$.given.city' 
    }]
  }
})
```

## Summary

- Services are independent modules that know nothing about MicroQL
- MicroQL orchestrates services without coupling to them
- Services can be tested and used standalone
- The query is the only coupling point between services and MicroQL
- This separation ensures maximum reusability and maintainability