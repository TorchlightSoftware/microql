/**
 * @fileoverview Utility service for common data transformations in MicroQL
 * Provides map, filter, flatMap, concat and other operations
 */

import path from 'node:path'
import fs from 'fs-extra'

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
  reset: '\x1b[0m',
}

/**
 * Ordered list of color names for service assignment
 */
const COLOR_NAMES = ['green', 'yellow', 'blue', 'magenta', 'cyan', 'white']

/**
 * Validation utility for checking argument types
 * @param {*} value - Value to validate
 * @param {string} expectedType - Expected type ('array', 'object', etc.)
 * @param {string} name - Parameter name for error message
 * @throws {Error} If validation fails
 */
const validateType = (value, expectedType, name) => {
  if (expectedType === 'array' && !Array.isArray(value)) {
    throw new Error(`${name}: expected array, got ${typeof value}`)
  }
  if (
    expectedType === 'object' &&
    (!value || typeof value !== 'object' || Array.isArray(value))
  ) {
    throw new Error(`${name}: expected object, got ${typeof value}`)
  }
}

// Check if we should skip based on timestamp
async function shouldSkipSnapshot(timestamp, out) {
  if (timestamp && (await fs.pathExists(out))) {
    try {
      const existingSnapshot = JSON.parse(await fs.readFile(out, 'utf8'))
      if (existingSnapshot.timestamp === snapshotRestoreTimestamp) {
        // Skip - this snapshot was already taken
        return true
      }
    } catch (_error) {
      return false
    }
  }
  return false
}

/**
 * Utility service for common data transformations in MicroQL
 * Provides map, filter, flatMap, concat and other operations
 */
const util = {
  /**
   * Transform each item in a collection using a function
   */
  async map({ on, fn }) {
    validateType(on, 'array', 'on')

    if (fn && typeof fn === 'function') {
      return Promise.all(on.map(fn))
    }

    throw new Error('fn must be provided for map operation')
  },

  /**
   * Filter collection based on a predicate function
   */
  async filter({ on, predicate }) {
    validateType(on, 'array', 'on')

    if (!predicate || typeof predicate !== 'function') {
      throw new Error('Predicate function is required for filter operation')
    }

    const keepResults = await Promise.all(on.map(predicate))
    return on.filter((_, index) => keepResults[index])
  },

  /**
   * Map and then flatten the results
   */
  async flatMap({ on, fn }) {
    const results = await util.map({ on, fn })
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
      if (Object.hasOwn(on, field)) {
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
    if (settings && typeof settings !== 'object')
      throw new Error('`settings` if provided must be an object')

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

    // use util.inspect with provided settings
    const util = await import('node:util')
    let formatted

    if (typeof on === 'string') {
      formatted = on
    } else {
      const filtered = filterHidden(on)
      formatted = util.inspect(filtered, settings?.inspect)
    }

    // Apply color if specified
    const colorCode = COLORS[color] || ''
    const resetCode = colorCode ? COLORS.reset : ''

    // Print with formatting and color
    process.stdout.write(`${colorCode + timestamp + formatted + resetCode}\n`)

    // Return the original value for chaining
    return on
  },

  /**
   * Save data to a JSON snapshot file
   *
   * Design: This service supports two distinct arguments to separate timing control from data capture:
   * - `on`: Controls when the snapshot executes (dependency timing) - what to wait for
   * - `capture`: Controls what data to save - what to capture
   *
   * Common patterns:
   * - `capture: '$'` - Captures all completed queries at service execution time
   * - `on: '$.someQuery'` - Waits for someQuery to complete before executing
   * - `on: '@'` - Waits for a step in a chain (should be unnecessary, because chains run in fixed order anyway)
   * - Default behavior: If no `capture` specified, captures the `on` value
   *
   * The `$` reference unlike most paths, does not imply waiting for any queries to finish.
   * This allows capturing current execution state at any point.
   */
  async snapshot({ on, capture, out }) {
    if (!out) {
      throw new Error('snapshot requires "out" argument specifying file path')
    }
    capture ??= on

    // Skip logic: if we have a restore timestamp and file exists with same timestamp
    if (await shouldSkipSnapshot(capture.snapshotRestoreTimestamp, out))
      return on

    const snapshotData = {
      timestamp: new Date().toISOString(),
      results: capture,
    }

    // Ensure directory exists
    await fs.ensureDir(path.dirname(out))

    // Write snapshot file
    await fs.writeFile(out, JSON.stringify(snapshotData, null, 2))

    // Return the on argument for chaining
    return on
  },

  /**
   * Record a failure to disk with error context from MicroQL
   * @param {Object} args - Arguments
   * @param {Object} args.on - Error context from MicroQL onError
   * @param {string} args.location - Directory path where to save failure records
   * @returns {Object} The error context for potential chaining
   */
  async recordFailure({ on, location }) {
    if (!location) {
      throw new Error(
        'recordFailure requires "location" argument specifying directory path'
      )
    }

    if (!on || typeof on !== 'object') {
      throw new Error(
        'recordFailure expects error context from MicroQL onError'
      )
    }

    // Ensure directory exists
    await fs.ensureDir(location)

    // Create failure record
    const failureRecord = {
      timestamp: new Date().toISOString(),
      error: on.error,
      serviceName: on.serviceName,
      action: on.action,
      queryName: on.queryName,
      args: on.args,
      // Include stack trace if available
      stack: on.originalError?.stack,
    }

    // Generate filename with timestamp
    const filename = `failure-${Date.now()}.json`
    const filePath = path.join(location, filename)

    // Write failure record
    await fs.writeFile(filePath, JSON.stringify(failureRecord, null, 2))

    console.error(
      `❌ Failure recorded: ${path.relative(process.cwd(), filePath)}`
    )

    // Return the error context for potential chaining
    return on
  },

  /**
   * Template service - returns the provided template object
   * MicroQL handles @ symbol resolution automatically through arg compilation
   */
  template(templateArgs) {
    // Remove any non-template arguments (like auto-injected settings)
    const { settings, ...template } = templateArgs
    return template
  },
}

// Argument type metadata for MicroQL function compilation
util.map._argtypes = {
  fn: { type: 'function' },
}

util.filter._argtypes = {
  predicate: { type: 'function' },
}

util.flatMap._argtypes = {
  fn: { type: 'function' },
}

util.when._argtypes = {
  test: { type: 'function' }, // Test can be a service call
}

util.print._argtypes = {
  settings: { type: 'settings' },
}

util.snapshot._argtypes = {
  // capture argument will be resolved by MicroQL context ($ references)
  // out argument is a simple string path
}

util.template._argtypes = {}

export default util
export { COLOR_NAMES }
