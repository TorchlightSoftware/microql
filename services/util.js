/**
 * @fileoverview Utility service for common data transformations in MicroQL.
 * Resources are addressed by verbless service keys: `[util]/each`.
 *
 * `print` and `recordFailure` reach the outside world through the runtime,
 * which MicroQL hands to the service at init.
 */

import {z} from 'zod'
import {isPlainObject, mapValues, filterObject, pick} from '../common.js'
import {canonical} from '../forms.js'
import {serviceFromTable} from '../service-table.js'

// An item that failed: an Error, or the null left by ignoreErrors.
const isFailure = (item) => item === null || item instanceof Error
const successes = (list) => list.filter(item => !isFailure(item))

// Filter hidden properties (starting with _) before formatting
const filterHidden = (val) => {
  if (Array.isArray(val)) {
    return val.map(filterHidden)
  }
  if (typeof val === 'object' && val !== null) {
    return filterObject(val, (_v, k) => !k.startsWith('_'))
  }
  return val
}

// A copy of plain data: arrays and plain objects are rebuilt, everything else
// (dates, errors, instances) is shared.
const copyPlain = (value) =>
  Array.isArray(value) ? value.map(copyPlain) : isPlainObject(value) ? mapValues(value, copyPlain) : value

// `on`'s items, then those of `more` not yet present, compared by value.
function union(on, more) {
  const present = new Set(on.map(canonical))
  const added = more.filter(item => {
    const key = canonical(item)
    if (present.has(key)) return false
    present.add(key)
    return true
  })
  return [...on, ...added].map(copyPlain)
}

// `with` merged onto `on`: plain objects merge key by key, arrays are a set
// union, an undefined value in `with` keeps `on`'s, and any other value wins.
// So merging the same `with` twice changes nothing.
function mergeValues(on, withValue) {
  if (withValue === undefined) return copyPlain(on)
  if (isPlainObject(on) && isPlainObject(withValue)) {
    const keys = new Set([...Object.keys(on), ...Object.keys(withValue)])
    return Object.fromEntries([...keys].map(key => [key, mergeValues(on[key], withValue[key])]))
  }
  if (Array.isArray(on) && Array.isArray(withValue)) return union(on, withValue)
  return copyPlain(withValue)
}

const truncate = (str, maxStr) => !!maxStr && typeof str === 'string' ?
  str.slice(0, maxStr) : str

// Shared types and tags
const list = z.array(z.any())
const object = z.record(z.string(), z.any())
const optionalBoolean = z.boolean().optional()
const typed = (schema) => ['type', {fromZod: schema}]
const listTarget = {on: ['target', typed(list)]}

// What `each` and `flattenEach` share: a nested call for every item of `on`.
const eachInput = {
  ...listTarget,
  service: [['call', {fromList: 'on'}]],
  skipInputErrors: ['reserve', typed(optionalBoolean)],
  skipOutputErrors: ['reserve', typed(optionalBoolean)]
}

async function eachItem({on, service, skipInputErrors = false, skipOutputErrors = false}) {
  const input = skipInputErrors ? successes(on) : on
  const results = await Promise.all(input.map(item => service(item)))
  return skipOutputErrors ? successes(results) : results
}

// MicroQL's builtin service, as a table of operations (see service-table.js).
// It is also the reference for writing one: each operation's declaration
// says which field method syntax fills, which fields hold nested calls and
// what they receive, and the types of its input and output.
const table = {
  // Receives the runtime's capabilities before a Run uses this service.
  init(runtime) {
    this.runtime = runtime
  },

  '/each': {
    description: 'Run a call for every item of a list, returning their results in order',
    input: eachInput,
    output: [['type', {toList: {fromField: 'service'}}]],
    call: eachItem
  },

  '/flattenEach': {
    description: 'Run a call that returns a list for every item of a list, returning one list of all their items',
    input: {...eachInput, service: [['call', {fromList: 'on'}], typed(list)]},
    output: [['type', {fromField: 'service'}]],
    call: async (args) => (await eachItem(args)).flat()
  },

  '/filter': {
    description: 'Keep the items for which a call is truthy, or remove them with mode: remove',
    input: {
      ...listTarget,
      service: [['call', {fromList: 'on'}], typed(z.boolean())],
      mode: [typed(z.enum(['keep', 'remove']).optional())]
    },
    output: [['type', {fromField: 'on'}]],
    async call({on, service, mode = 'keep'}) {
      const tests = await Promise.all(on.map(item => service(item)))
      const keep = mode === 'keep'
      return on.filter((_, index) => Boolean(tests[index]) === keep)
    }
  },

  '/removeErrors': {
    description: 'Remove failed items, Errors and the nulls ignoreErrors leaves, from a list',
    input: listTarget,
    output: [['type', {fromField: 'on'}]],
    call: async ({on}) => successes(on)
  },

  '/removeNulls': {
    description: 'Remove nulls from a list, keeping Errors',
    input: listTarget,
    output: [['type', {fromField: 'on'}]],
    call: async ({on}) => on.filter(item => item !== null)
  },

  '/removeSuccesses': {
    description: 'Keep only the failed items, Errors and nulls, of a list',
    input: listTarget,
    output: [['type', {fromField: 'on'}]],
    call: async ({on}) => on.filter(isFailure)
  },

  '/partitionErrors': {
    description: 'Split a list into {successes, failures}; failures are Errors and nulls',
    input: listTarget,
    output: [typed(z.object({successes: list, failures: list}))],
    call: async ({on}) => ({successes: successes(on), failures: on.filter(isFailure)})
  },

  '/concat': {
    description: 'Concatenate several lists into one',
    input: {args: ['target', typed(z.array(list).min(1))]},
    output: [typed(list)],
    call: async ({args}) => [].concat(...args)
  },

  '/when': {
    description: '`then` when test is truthy, otherwise `otherwise`',
    call: async ({test, then, otherwise}) => test ? then : otherwise
  },

  '/eq': {
    description: 'Whether l and r are the same value',
    output: [typed(z.boolean())],
    call: async ({l, r}) => l === r
  },

  '/gt': {
    description: 'Whether l is greater than r',
    input: {l: [typed(z.number())], r: [typed(z.number())]},
    output: [typed(z.boolean())],
    call: async ({l, r}) => l > r
  },

  '/lt': {
    description: 'Whether l is less than r',
    input: {l: [typed(z.number())], r: [typed(z.number())]},
    output: [typed(z.boolean())],
    call: async ({l, r}) => l < r
  },

  '/exists': {
    description: 'Whether value is neither null nor undefined',
    output: [typed(z.boolean())],
    call: async ({value}) => value != null
  },

  '/length': {
    description: 'The length of a list or string, 0 for anything else',
    output: [typed(z.number())],
    call: async ({value}) => value?.length || 0
  },

  '/pick': {
    description: 'The listed fields that an object has',
    input: {on: ['target', typed(object)], fields: [typed(z.array(z.string()).min(1))]},
    output: [typed(object)],
    call: async ({on, fields}) => pick(on, fields)
  },

  '/merge': {
    description: 'Deep merge of `with` onto `on`, as a new object; lists are a set union',
    input: {on: ['target', typed(object)], with: [typed(object)]},
    output: [typed(object)],
    call: async ({on, with: withObj}) => mergeValues(on, withObj)
  },

  '/print': {
    description: 'Print a value through the runtime, formatted with the Query\'s inspect settings, and return it',
    input: {on: ['target'], settings: ['settings'], color: [typed(z.string().optional())]},
    output: [['type', {fromField: 'on'}]],
    async call({on, settings, color}) {
      const timestamp = settings?.ts ? `[${new Date().toISOString()}] ` : ''
      const formatted = typeof on === 'string' ? truncate(on, settings?.inspect?.maxStringLength) :
        this.runtime.inspect(filterHidden(on), settings?.inspect)
      this.runtime.print(timestamp + formatted, {color})
      return on
    }
  },

  '/recordFailure': {
    description: 'Record a failure, with the error context MicroQL attached, through the runtime, and return it',
    input: {
      on: ['target', typed(z.object({message: z.string(), address: z.string(), key: z.string(), args: z.any()}))],
      location: [typed(z.string().min(1).regex(/^[^<>:"|?*\t\n\r\0]+$/))]
    },
    output: [['type', {fromField: 'on'}]],
    async call({on, location}) {
      await this.runtime.recordFailure(location, {
        timestamp: new Date().toISOString(),
        error: on.message,
        address: on.address,
        key: on.key,
        args: on.args,
        stack: on.stack
      })
      return on
    }
  },

  '/template': {
    description: 'Its own fields, with every reference resolved',
    input: {on: ['target']},
    call: async (args) => args
  }
}

const util = serviceFromTable(table)

export default util
