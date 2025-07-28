/**
 * @fileoverview Utility service for common data transformations in MicroQL
 * Provides map, filter, flatMap, concat and other operations
 */

import path from 'node:path'
import fs from 'fs-extra'
import {ANSI_COLORS} from '../common.js'
import _ from 'lodash'

/**
 * Ordered list of color names for service assignment
 */
const COLOR_NAMES = ['green', 'yellow', 'blue', 'magenta', 'cyan', 'white']

// Filter hidden properties (starting with _) before formatting
const filterHidden = (val) => {
  if (Array.isArray(val)) {
    return val.map(filterHidden)
  }
  if (typeof val === 'object' && val !== null) {
    return _.omitBy(val, (v, k) => k.startsWith('_'))
  }
  return val
}

const truncate = (str, maxStr) => !!maxStr && typeof str === 'string' ?
  str.slice(0, maxStr) : str

// Check if we should skip based on timestamp
async function shouldSkipSnapshot(timestamp, out) {
  if (timestamp && (await fs.pathExists(out))) {
    try {
      const existingSnapshot = JSON.parse(await fs.readFile(out, 'utf8'))
      if (existingSnapshot.timestamp === timestamp) {
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
  async map({on, service}) {
    return Promise.all(on.map(service))
  },

  /**
   * Filter collection based on a service
   */
  async filter({on, service}) {
    const keepResults = await Promise.all(on.map(service))
    return on.filter((_, index) => keepResults[index])
  },

  /**
   * Map and then flatten the results
   */
  async flatMap({on, service}) {
    const results = await util.map({on, service})
    return results.flat()
  },

  /**
   * Concatenate multiple arrays into a single array
   */
  async concat({args}) {
    return [].concat(...args)
  },

  /**
   * Conditional logic - return different values based on test
   */
  async when({test, then, or}) {
    return test ? then : or
  },

  /**
   * Equality comparison
   */
  async eq({l, r}) {
    return l === r
  },

  /**
   * Greater than comparison
   */
  async gt({l, r}) {
    return l > r
  },

  /**
   * Less than comparison
   */
  async lt({l, r}) {
    return l < r
  },

  /**
   * Check if value exists (not null/undefined)
   */
  async exists({value}) {
    return value != null
  },

  /**
   * Get length of array or string
   */
  async length({value}) {
    return value?.length || 0
  },

  /**
   * Pick specific fields from an object (similar to lodash pick)
   */
  async pick({on, fields}) {
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
  async print({on, settings, color}) {
    // Format timestamp if enabled
    const timestamp = settings?.ts ? `[${new Date().toISOString()}] ` : ''

    // use util.inspect with provided settings
    const util = await import('node:util')

    const maxStr = settings?.inspect?.maxStringLength

    const formatted = typeof on === 'string' ? truncate(on, maxStr) :
      util.inspect(filterHidden(on), settings?.inspect)

    // Apply color if specified
    const colorCode = ANSI_COLORS[color] || ''
    const resetCode = colorCode ? ANSI_COLORS.reset : ''

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
  async snapshot({on, capture, out}) {
    capture ??= on

    // Skip logic: if we have a restore timestamp and file exists with same timestamp
    if (await shouldSkipSnapshot(capture.snapshotRestoreTimestamp, out))
      return on

    const snapshotData = {
      timestamp: new Date().toISOString(),
      results: capture
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
   */
  async recordFailure({on, location}) {
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
      stack: on.originalError?.stack
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
  template(args) {
    return args
  }
}

// Argument type metadata for MicroQL service compilation
util.map._argtypes = {
  on: {argOrder: 0},
  service: {type: 'service'}
}

util.filter._argtypes = {
  on: {argOrder: 0},
  service: {type: 'service'}
}

util.flatMap._argtypes = {
  on: {argOrder: 0},
  service: {type: 'service'}
}

util.when._argtypes = {
  test: {type: 'service'}
}

util.print._argtypes = {
  on: {argOrder: 0},
  settings: {type: 'settings'}
}

util.snapshot._argtypes = {
  on: {argOrder: 0}
  // capture argument will be resolved by MicroQL context ($ references)
  // out argument is a simple string path
}

util.template._argtypes = {on: {argOrder: 0}}

util.pick._argtypes = {
  on: {argOrder: 0}
}

util.recordFailure._argtypes = {
  on: {argOrder: 0}
}

util.concat._argtypes = {
  args: {argOrder: 0}
}

// Enhanced validation schemas for each service method
util.map._validators = {
  precheck: {
    on: ['array'],
    service: ['any'] // Compiled by MicroQL's _argtypes system
  }
}

util.filter._validators = {
  precheck: {
    on: ['array'],
    service: ['any'] // Compiled by MicroQL's _argtypes system
  }
}

util.flatMap._validators = {
  precheck: {
    on: ['array'],
    service: ['any'] // Compiled by MicroQL's _argtypes system
  }
}

util.concat._validators = {
  precheck: {
    args: ['array', ['array'], {min: 1}]
  }
}

util.when._validators = {
  precheck: {
    test: ['any'], // test can be any value (truthy/falsy)
    then: ['any'],
    or: ['any']
  }
}

util.eq._validators = {
  precheck: {
    l: ['any'],
    r: ['any']
  }
}

util.gt._validators = {
  precheck: {
    l: ['number'],
    r: ['number']
  }
}

util.lt._validators = {
  precheck: {
    l: ['number'],
    r: ['number']
  }
}

util.exists._validators = {
  precheck: {
    value: ['any']
  }
}

util.length._validators = {
  precheck: {
    value: ['any'] // Accepts strings and arrays, returns 0 for other types
  }
}

util.pick._validators = {
  precheck: {
    on: ['object'],
    fields: ['array', ['string'], {min: 1}]
  }
}

util.print._validators = {
  precheck: {
    on: ['any'],
    settings: ['any', 'optional'], // Settings object structure varies
    color: ['string', 'optional']
  }
}

util.snapshot._validators = {
  precheck: {
    on: ['any'],
    capture: ['any', 'optional'],
    out: ['string', {min: 1, regex: /^[^<>:"|?*\t\n\r\0]+$/}] // Basic path validation - exclude tab, newline, carriage return, null
  }
}

util.recordFailure._validators = {
  precheck: {
    on: {
      error: ['string'],
      serviceName: ['string'],
      action: ['string'],
      queryName: ['string'],
      args: ['any']
    },
    location: ['string', {min: 1, regex: /^[^<>:"|?*\t\n\r\0]+$/}] // Basic path validation - exclude tab, newline, carriage return, null
  }
}

util.template._validators = {
  // template accepts any arguments and returns them as-is
  precheck: {} // No validation needed - template is designed to accept any structure
}

export default util
export {COLOR_NAMES}
