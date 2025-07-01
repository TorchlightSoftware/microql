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
 * Utility service for common data transformations in MicroQL
 * Provides map, filter, flatMap, concat and other operations with sophisticated context handling
 */
const util = {
  /**
   * Transform each item in a collection using a function or template
   */
  async map({ on, fn, template }) {
    if (!Array.isArray(on)) throw new Error(`expected array, got ${typeof on}`)

    // Both templates and functions are now compiled functions by MicroQL
    const mapFunction = template || fn
    if (mapFunction && typeof mapFunction === 'function') {
      return Promise.all(on.map(mapFunction))
    }

    throw new Error('Either template or fn must be provided for map operation')
  },

  /**
   * Filter collection based on a predicate function
   */
  async filter({ on, predicate }) {
    if (!Array.isArray(on)) throw new Error(`expected array, got ${typeof on}`)

    if (!predicate || typeof predicate !== 'function') {
      throw new Error('Predicate function is required for filter operation')
    }

    const keepResults = await Promise.all(on.map(predicate))
    return on.filter((_, index) => keepResults[index])
  },

  /**
   * Map and then flatten the results
   */
  async flatMap({ on, template, fn }) {
    const results = await util.map({on, template, fn})
    return results.flat()
  },

  /**
   * Concatenate multiple arrays into a single array
   */
  async concat({ args }) {
    if (!Array.isArray(args)) {
      throw new Error('Args must be an array of arrays')
    }

    return [].concat(...args)
  },

  /**
   * Conditional logic - return different values based on test
   */
  async when({ test, then, or }) {
    return test ? then : or
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
   */
  async pick({ on, fields }) {
    if (!on || typeof on !== 'object' || Array.isArray(on)) {
      throw new Error('`on` must be an object')
    }

    if (!Array.isArray(fields)) {
      throw new Error('`fields` must be an array of field names')
    }

    const result = {}
    for (const field of fields) {
      if (on.hasOwnProperty(field)) {
        result[field] = on[field]
      }
    }

    return result
  },

  /**
   * Print values to console with formatting options and color coding
   * Uses query-level inspect settings for consistent formatting
   */
  async print({ on, settings, color, ts = true }) {
    if (settings && typeof settings !== 'object') throw new Error("`settings` if provided must be an object")

    const inspectSettings = {
      depth: 3,
      colors: false,
      compact: false,
      maxArrayLength: 10,
      maxStringLength: 200,
      ...settings?.inspect
    }

    // Format timestamp if enabled
    const timestamp = ts ? `[${new Date().toISOString()}] ` : ''

    // Filter hidden properties (starting with _) before formatting
    const filterHidden = (val) => {
      if (Array.isArray(val)) {
        return val.map(filterHidden)
      }
      if (typeof val === 'object' && val !== null) {
        const filtered = {}
        for (const [key, value] of Object.entries(val)) {
          if (!key.startsWith('_')) {
            filtered[key] = filterHidden(value)
          }
        }
        return filtered
      }
      return val
    }

    // Use provided inspect settings or defaults if inspector function wasn't passed
    const util = await import('util')
    let formatted

    if (typeof on === 'string') {
      formatted = on
    } else {
      const filtered = filterHidden(on)
      formatted = util.inspect(filtered, inspectSettings)
    }

    // Apply color if specified
    const colorCode = COLORS[color] || ''
    const resetCode = colorCode ? COLORS.reset : ''

    // Print with formatting and color
    process.stdout.write(colorCode + timestamp + formatted + resetCode + '\n')

    // Return the original value for chaining
    return on
  }
}

// Parameter metadata for MicroQL function compilation
util.map._params = {
  fn: { type: 'function' },
  template: { type: 'template' }
}

util.filter._params = {
  predicate: { type: 'function' }
}

util.flatMap._params = {
  fn: { type: 'function' },
  template: { type: 'template' }
}

util.when._params = {
  test: { type: 'function' }  // Test can be a service call
}

util.print._params = {
  settings: {type: 'settings'}
}

export default util
export { COLOR_NAMES }
