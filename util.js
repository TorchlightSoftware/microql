/**
 * @fileoverview Utility service for common data transformations in MicroQL
 * Provides map, filter, flatMap, concat and other operations with proper context handling
 */

import retrieve from './retrieve.js'
import { resolveArgsWithContext } from './query.js'

/**
 * Resolve template values using MicroQL's canonical context resolution system
 * This ensures consistent handling of @, @@, @@@, etc. across the entire system
 * 
 * @param {Object} template - Template object with @ symbol references
 * @param {*} currentItem - Current iteration item for context
 * @returns {Object} Resolved template object
 */
const resolveTemplate = (template, currentItem) => {
  // Delegate to MicroQL's canonical resolution system
  // This ensures consistent handling of @, @@, @@@, etc.
  return resolveArgsWithContext(template, {}, null, [currentItem], new Set())
}

/**
 * Utility service for common data transformations in MicroQL
 * Provides map, filter, flatMap, concat and other operations with sophisticated context handling
 */
const util = {
  /**
   * Transform each item in a collection using a function or template
   * 
   * @param {Object} params - Parameters object
   * @param {Array} [params.on] - Collection from method syntax (e.g., ['@.items', 'util:map', ...])
   * @param {Array} [params.collection] - Collection from direct calls
   * @param {Function} [params.fn] - Compiled function from MicroQL for transformation
   * @param {Object} [params.template] - Template object with @ symbol references
   * @param {Object} [params._services] - MicroQL internal services context
   * @returns {Promise<Array>} Transformed collection
   * 
   * @example
   * // Template usage
   * ['util', 'map', { 
   *   collection: [{ name: 'Alice' }, { name: 'Bob' }],
   *   template: { greeting: 'Hello @.name' }
   * }]
   * // Returns: [{ greeting: 'Hello Alice' }, { greeting: 'Hello Bob' }]
   * 
   * @example  
   * // Function usage (compiled by MicroQL)
   * ['util', 'map', {
   *   collection: [{ id: 1 }, { id: 2 }],
   *   fn: ['service', 'process', { input: '@.id' }]
   * }]
   */
  async map({ on, collection, fn, template, _services }) {
    const items = on || collection || []
    if (!Array.isArray(items)) return []
    
    // Template-based mapping
    if (template) {
      return items.map(item => resolveTemplate(template, item))
    }
    
    // Function-based mapping - fn is now a compiled function from MicroQL
    if (fn && typeof fn === 'function') {
      const results = await Promise.all(
        items.map(item => fn(item))
      )
      return results
    }
    
    throw new Error('Either template or fn must be provided for map operation')
  },
  
  /**
   * Filter collection based on a predicate function
   */
  async filter({ on, collection, predicate, _services }) {
    const items = on || collection || []
    if (!Array.isArray(items)) return []
    
    if (!predicate || typeof predicate !== 'function') {
      throw new Error('Predicate function is required for filter operation')
    }
    
    const results = await Promise.all(
      items.map(async item => {
        const keep = await predicate(item)
        return { item, keep }
      })
    )
    
    return results.filter(({ keep }) => keep).map(({ item }) => item)
  },
  
  /**
   * Map and then flatten the results
   */
  async flatMap({ on, collection, fn, _services }) {
    const items = on || collection || []
    if (!Array.isArray(items)) return []
    
    if (!fn || typeof fn !== 'function') {
      throw new Error('Function is required for flatMap operation')
    }
    
    const results = await Promise.all(
      items.map(item => fn(item))
    )
    
    // Flatten the results
    return results.flat()
  },
  
  /**
   * Concatenate multiple arrays into a single array
   */
  async concat({ args }) {
    if (!Array.isArray(args)) {
      throw new Error('Args must be an array of arrays')
    }
    
    const result = []
    for (const arr of args) {
      if (Array.isArray(arr)) {
        result.push(...arr)
      }
    }
    
    return result
  },
  
  /**
   * Conditional logic - return different values based on test
   */
  async when({ test, then, or, _services, _context }) {
    let testResult
    
    if (typeof test === 'boolean') {
      testResult = test
    } else if (typeof test === 'function') {
      // Compiled function - call with context
      testResult = await test(_context)
    } else {
      testResult = Boolean(test)
    }
    
    return testResult ? then : or
  },
  
  /**
   * Equality comparison
   */
  async eq({ l, r }) {
    return l === r
  },
  
  /**
   * Greater than comparison
   */
  async gt({ l, r }) {
    return l > r
  },
  
  /**
   * Less than comparison
   */
  async lt({ l, r }) {
    return l < r
  },
  
  /**
   * Check if value exists (not null/undefined)
   */
  async exists({ value }) {
    return value != null
  },
  
  /**
   * Get length of array or string
   */
  async length({ value }) {
    return value?.length || 0
  },

  /**
   * Print values to console with formatting options
   * 
   * @param {Object} params - Parameters object
   * @param {*} [params.on] - Value from method syntax (e.g., ['@.data', 'util:print', ...])
   * @param {*} [params.value] - Value from direct calls
   * @param {number} [params.depth=3] - Depth for object inspection
   * @param {string} [params.lor] - Line-or-return override (terminal default if not specified)
   * @param {boolean} [params.ts=true] - Whether to include timestamp
   * @returns {Promise<*>} Returns the input value for chaining
   * 
   * @example
   * // Method syntax with options
   * ['@.data', 'util:print', { depth: 5, ts: false }]
   * 
   * @example
   * // Direct call
   * ['util', 'print', { value: { foo: 'bar' }, depth: 2 }]
   */
  async print({ on, value, depth = 3, lor, ts = true }) {
    const printValue = on !== undefined ? on : value
    
    // Format timestamp if enabled
    const timestamp = ts ? `[${new Date().toISOString()}] ` : ''
    
    // Handle line-or-return setting
    const lineEnding = lor !== undefined ? lor : ''
    
    // Use util.inspect for proper object formatting with depth control
    const { inspect } = await import('util')
    const formatted = typeof printValue === 'string' 
      ? printValue 
      : inspect(printValue, { depth, colors: true, compact: false })
    
    // Print with formatting
    process.stdout.write(timestamp + formatted + lineEnding)
    if (lor === undefined) {
      process.stdout.write('\n') // Default newline if lor not specified
    }
    
    // Return the original value for chaining
    return printValue
  }
}

// Parameter metadata for MicroQL function compilation
util.map._params = {
  fn: { type: 'function' },
  template: { type: 'template' }  // Templates also need @ resolution
}

util.filter._params = {
  predicate: { type: 'function' }
}

util.flatMap._params = {
  fn: { type: 'function' }
}

util.when._params = {
  test: { type: 'function' }  // Test can be a service call
}

// No special parameter metadata needed for print - all parameters are primitive values

export default util