/**
 * @fileoverview Utility service for common data transformations in MicroQL.
 * Resources are addressed by service key: `GET [util]/each`.
 *
 * `print` and `recordFailure` reach the outside world through the runtime,
 * which MicroQL hands to the service at init.
 */

import _ from 'lodash'

// An item that failed: an Error, or the null left by ignoreErrors.
const isFailure = (item) => item === null || item instanceof Error
const successes = (list) => list.filter(item => !isFailure(item))

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

const util = {
  // Receives the runtime's capabilities before a Run uses this service.
  init(runtime) {
    this.runtime = runtime
  },

  /**
   * Run a service for every item; `flatten` concatenates the results.
   */
  async '/each'({on, service, flatten = false, skipInputErrors = false, skipOutputErrors = false}) {
    const input = skipInputErrors ? successes(on) : on
    const results = await Promise.all(input.map(item => service(item)))
    const kept = skipOutputErrors ? successes(results) : results
    return flatten ? kept.flat() : kept
  },

  /**
   * Keep (or remove, with mode: 'remove') the items for which the service is truthy.
   */
  async '/filter'({on, service, mode = 'keep'}) {
    const tests = await Promise.all(on.map(item => service(item)))
    const keep = mode === 'keep'
    return on.filter((_, index) => Boolean(tests[index]) === keep)
  },

  /**
   * Remove Error objects and null values from an array
   * Useful for removing failed items when ignoreErrors is used
   */
  async '/removeErrors'({on}) {
    return successes(on)
  },

  /**
   * Remove only null values from an array, keeping Error objects
   */
  async '/removeNulls'({on}) {
    return on.filter(item => item !== null)
  },

  /**
   * Remove successful results, keeping only Error objects and nulls
   */
  async '/removeSuccesses'({on}) {
    return on.filter(isFailure)
  },

  /**
   * Partition an array into {successes, failures}; failures include Errors and nulls
   */
  async '/partitionErrors'({on}) {
    return {successes: successes(on), failures: on.filter(isFailure)}
  },

  /**
   * Concatenate multiple arrays into a single array
   */
  async '/concat'({args}) {
    return [].concat(...args)
  },

  /**
   * Conditional logic - `then` when test is truthy, otherwise `otherwise`
   */
  async '/when'({test, then, otherwise}) {
    return test ? then : otherwise
  },

  async '/eq'({l, r}) {
    return l === r
  },

  async '/gt'({l, r}) {
    return l > r
  },

  async '/lt'({l, r}) {
    return l < r
  },

  /**
   * Check if value exists (not null/undefined)
   */
  async '/exists'({value}) {
    return value != null
  },

  /**
   * Get length of array or string
   */
  async '/length'({value}) {
    return value?.length || 0
  },

  /**
   * Pick specific fields from an object (similar to lodash pick)
   */
  async '/pick'({on, fields}) {
    return _.pick(on, fields.filter(field => Object.hasOwn(on, field)))
  },

  /**
   * Deep merge of 'with' onto 'on', returning a new object
   */
  async '/merge'({on, with: withObj}) {
    return _.merge({}, on, withObj)
  },

  /**
   * Print a value through the runtime, formatted with the Query's inspect settings
   */
  async '/print'({on, settings, color}) {
    const timestamp = settings?.ts ? `[${new Date().toISOString()}] ` : ''
    const formatted = typeof on === 'string' ? truncate(on, settings?.inspect?.maxStringLength) :
      this.runtime.inspect(filterHidden(on), settings?.inspect)

    this.runtime.print(timestamp + formatted, {color})

    // Return the original value for chaining
    return on
  },

  /**
   * Record a failure, with the error context MicroQL attached, through the runtime
   */
  async '/recordFailure'({on, location}) {
    await this.runtime.recordFailure(location, {
      timestamp: new Date().toISOString(),
      error: on.message,
      address: on.address,
      key: on.key,
      args: on.args,
      stack: on.stack
    })

    // Return the error for potential chaining
    return on
  },

  /**
   * Template service - returns the provided template object
   * MicroQL handles @ symbol resolution automatically through arg compilation
   */
  '/template'(args) {
    return args
  }
}

// Argument type metadata for MicroQL service compilation. `reserve` marks
// arguments that configure the call rather than feed it data.
util['/each']._argtypes = {
  on: {argOrder: 0},
  service: {type: 'service'},
  skipInputErrors: {reserve: true},
  skipOutputErrors: {reserve: true}
}
util['/filter']._argtypes = {
  on: {argOrder: 0},
  service: {type: 'service', returns: ['boolean']}
}

for (const resource of ['/each', '/filter', '/removeErrors', '/removeNulls', '/removeSuccesses', '/partitionErrors']) {
  util[resource]._noTimeout = true
}

const takesTarget = {on: {argOrder: 0}}
for (const resource of ['/removeErrors', '/removeNulls', '/removeSuccesses', '/partitionErrors', '/pick', '/merge', '/recordFailure', '/template']) {
  util[resource]._argtypes = takesTarget
}
util['/print']._argtypes = {on: {argOrder: 0}, settings: {type: 'settings'}}
util['/concat']._argtypes = {args: {argOrder: 0}}

// Argument (precheck) and return (postcheck) schemas for each resource
const listOfAnything = {precheck: {on: ['array']}, postcheck: ['array']}

util['/each']._validators = {
  precheck: {
    on: ['array'],
    service: ['any'],
    flatten: ['boolean', 'optional'],
    skipInputErrors: ['boolean', 'optional'],
    skipOutputErrors: ['boolean', 'optional']
  },
  postcheck: ['array']
}

util['/filter']._validators = {
  precheck: {
    on: ['array'],
    service: ['any'],
    mode: ['enum', ['keep', 'remove'], 'optional']
  },
  postcheck: ['array']
}

util['/removeErrors']._validators = listOfAnything
util['/removeNulls']._validators = listOfAnything
util['/removeSuccesses']._validators = listOfAnything

util['/partitionErrors']._validators = {
  precheck: {on: ['array']},
  postcheck: {successes: ['array'], failures: ['array']}
}

util['/concat']._validators = {
  precheck: {args: ['array', ['array'], {min: 1}]},
  postcheck: ['array']
}

util['/when']._validators = {
  precheck: {test: ['any'], then: ['any'], otherwise: ['any']}
}

const comparison = (type) => ({precheck: {l: [type], r: [type]}, postcheck: ['boolean']})
util['/eq']._validators = comparison('any')
util['/gt']._validators = comparison('number')
util['/lt']._validators = comparison('number')

util['/exists']._validators = {precheck: {value: ['any']}, postcheck: ['boolean']}
util['/length']._validators = {precheck: {value: ['any']}, postcheck: ['number']}

util['/pick']._validators = {
  precheck: {on: ['object'], fields: ['array', ['string'], {min: 1}]},
  postcheck: ['object']
}

util['/merge']._validators = {
  precheck: {on: ['object'], with: ['object']},
  postcheck: ['object']
}

util['/print']._validators = {
  precheck: {
    on: ['any'],
    settings: ['any', 'optional'],
    color: ['string', 'optional']
  }
}

util['/recordFailure']._validators = {
  precheck: {
    on: {
      message: ['string'],
      address: ['string'],
      key: ['string'],
      args: ['any']
    },
    location: ['string', {min: 1, regex: /^[^<>:"|?*\t\n\r\0]+$/}]
  }
}

export default util
