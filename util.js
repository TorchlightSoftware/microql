/**
 * @fileoverview Utility service for common data transformations in MicroQL
 * Provides map, filter, flatMap, concat and other operations with proper context handling
 */

import retrieve from './retrieve.js'
import { resolveArgsWithContext } from './query.js'

/**
 * Available color names for util:print service
 */
const COLORS = {
  red: '\x1b[31m',
  green: '\x1b[32m', 
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  reset: '\x1b[0m'
}

/**
 * Ordered list of color names for service assignment
 */
const COLOR_NAMES = ['green', 'yellow', 'blue', 'magenta', 'cyan', 'white']

/**
 * Resolve template values using MicroQL's canonical context resolution system
 * This ensures consistent handling of @, @@, @@@, etc. across the entire system
 * 
 * @param {Object} template - Template object with @ symbol references
 * @param {*} currentItem - Current iteration item for context
 * @param {Array} [contextStack] - Full context stack for nested @ resolution
 * @returns {Object} Resolved template object
 */
const resolveTemplate = (template, currentItem, contextStack = []) => {
  // Create context stack with current item as @ and any outer context for @@, @@@, etc.
  const fullContextStack = [currentItem, ...contextStack]
  
  // Delegate to MicroQL's canonical resolution system
  // This ensures consistent handling of @, @@, @@@, etc.
  return resolveArgsWithContext(template, {}, fullContextStack, new Set())
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
  async map({ on, collection, fn, template, _services, _contextStack }) {
    const items = on || collection || []
    if (!Array.isArray(items)) return []
    
    // Template-based mapping
    if (template) {
      return items.map(item => resolveTemplate(template, item, _contextStack))
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
  async flatMap({ on, collection, fn, _services, _contextStack }) {
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
   * Pick specific fields from an object (similar to lodash pick)
   * 
   * @param {Object} params - Parameters object
   * @param {*} [params.on] - Object from method syntax (e.g., ['@.data', 'util:pick', ...])
   * @param {*} [params.obj] - Object from direct calls
   * @param {Array} params.fields - Array of field names to pick
   * @returns {Promise<Object>} New object with only specified fields
   * 
   * @example
   * // Pick text and href from each item
   * ['@.items', 'util:map', {
   *   fn: ['@@', 'util:pick', { fields: ['text', 'href'] }]
   * }]
   */
  async pick({ on, obj, fields }) {
    const source = on || obj
    
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
      return {}
    }
    
    if (!Array.isArray(fields)) {
      throw new Error('Fields must be an array of field names')
    }
    
    const result = {}
    for (const field of fields) {
      if (source.hasOwnProperty(field)) {
        result[field] = source[field]
      }
    }
    
    return result
  },

  /**
   * Print values to console with formatting options and color coding
   * Uses query-level inspect settings for consistent formatting
   * 
   * @param {Object} params - Parameters object
   * @param {*} [params.on] - Value from method syntax (e.g., ['@.data', 'util:print', ...])
   * @param {*} [params.value] - Value from direct calls
   * @param {Object} [params.inspect] - Inspect settings from query or override (handled by MicroQL)
   * @param {string} [params.color] - Color for output (red, green, yellow, blue, magenta, cyan, white)
   * @param {boolean} [params.ts=true] - Whether to include timestamp
   * @returns {Promise<*>} Returns the input value for chaining
   * 
   * @example
   * // Method syntax with color for database calls
   * ['@.data', 'util:print', { color: 'blue' }]
   * 
   * @example
   * // Scraper logging in cyan with custom inspect settings
   * ['util', 'print', { value: 'Scraped 10 items', color: 'cyan', inspect: { depth: 1 } }]
   */
  async print({ on, value, inspect: inspectSettings, color, ts = true }) {
    const printValue = on !== undefined ? on : value
    
    // ANSI color codes for terminal output
    const colors = COLORS
    
    // Format timestamp if enabled
    const timestamp = ts ? `[${new Date().toISOString()}] ` : ''
    
    // Use provided inspect settings or defaults if inspector function wasn't passed
    const { inspect } = await import('util')
    let formatted
    
    if (typeof printValue === 'string') {
      formatted = printValue
    } else if (typeof inspectSettings === 'function') {
      // inspectSettings is actually the compiled inspector function from MicroQL
      formatted = inspectSettings(printValue)
    } else {
      // Fallback to default inspect with provided settings
      const defaultSettings = {
        depth: 3,
        colors: false,
        compact: false,
        maxArrayLength: 10,
        maxStringLength: 200,
        ...inspectSettings
      }
      formatted = inspect(printValue, defaultSettings)
    }
    
    // Apply color if specified
    const colorCode = color && colors[color] ? colors[color] : ''
    const resetCode = colorCode ? colors.reset : ''
    
    // Print with formatting and color
    process.stdout.write(colorCode + timestamp + formatted + resetCode + '\n')
    
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

util.print._params = {
  inspect: { type: 'inspect' }  // Use query-level inspect settings
}

export default util
export { COLOR_NAMES }