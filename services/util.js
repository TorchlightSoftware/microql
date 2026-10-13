/**
 * @fileoverview Utility service for common data transformations in MicroQL.
 * Resources are addressed by verbless service keys: `[util]/each`.
 *
 * `inspect` and `log` reach the outside world through the runtime's `log`,
 * which MicroQL hands to the service at init. Both return what they were
 * given, so they sit anywhere in a chain.
 */

import {z} from 'zod'
import {isPlainObject, mapValues, pick} from '../common.js'
import {canonical} from '../forms.js'
import {serviceFromTable} from '../service-table.js'
import {format} from '../format.js'
import {isErrorData, fromErrorData} from '../errors.js'
import {parseSchema} from '../zodly.js'

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

// Shared types and tags
const list = z.array(z.any())
const object = z.record(z.string(), z.any())
const destination = z.string().min(1).optional()
const typed = (schema) => ['type', {fromZod: schema}]
const listTarget = {on: ['target', typed(list)]}

// What `each` and `flattenEach` share: a nested call for every item of `on`,
// and a zodly schema of the results to leave out.
// What `each` and `flattenEach` return of their nested calls' results: those
// not fitting the zodly schema written in skip.
const leftOver = (results) => ({difference: [results, {fromZodly: {fromValue: 'skip'}}]})

const eachInput = {
  ...listTarget,
  service: [['call', {fromList: 'on'}]],
  skip: [typed(z.any().optional())]
}

const eachItem = ({on, service}) => Promise.all(on.map(item => service(item)))

// The list without the items that fit the skip schema, if there is one.
function leaveOut(list, skip) {
  if (skip === undefined) return list
  const schema = parseSchema(skip)
  return list.filter(item => !schema.safeParse(item).success)
}

// A value as an Error: error data as the error it describes, anything else
// as an error saying what it is.
const asError = (value) => isErrorData(value) ? fromErrorData(value) : new Error(format(value))

// Resources that are gone, with what replaced them.
const RETIRED = {
  '/print': 'Use [util]/inspect',
  '/recordFailure': 'Use [util]/log with to:',
  '/removeErrors': 'Use skip: [\'error\'] on the iteration',
  '/removeNulls': 'Use skip: [\'null\'] on the iteration',
  '/removeSuccesses': 'Use [util]/partitionErrors and take its failures'
}

// MicroQL's builtin service, as a table of operations (see service-table.js).
// It is also the reference for writing one: each operation's declaration
// says which field method syntax fills, which fields hold nested calls and
// what they receive, and the types of its input and output.
const table = {
  requires: ['log'],

  // Receives the runtime's capabilities before a Run uses this service.
  init(runtime) {
    this.runtime = runtime
  },

  '/each': {
    description: 'Run a call for every item of a list, returning their results in order, less those that fit skip',
    input: eachInput,
    output: [['type', {toList: leftOver({fromField: 'service'})}]],
    call: async (args) => leaveOut(await eachItem(args), args.skip)
  },

  '/flattenEach': {
    description: 'Run a call that returns a list for every item of a list, returning one list of all their items, less those that fit skip',
    input: {...eachInput, service: [['call', {fromList: 'on'}], typed(list)]},
    output: [['type', leftOver({fromField: 'service'})]],
    call: async (args) => leaveOut((await eachItem(args)).flat(), args.skip)
  },

  '/try': {
    description: 'Run a call on `on`, returning its result: a catch here handles its failure',
    input: {on: ['target'], service: [['call', {fromField: 'on'}]]},
    output: [['type', {fromField: 'service'}]],
    call: async ({on, service}) => service(on)
  },

  '/throw': {
    description: 'Fail with `on`: error data as the error it describes, anything else as an error saying it; `cause` is the error behind it',
    input: {on: ['target'], cause: [typed(z.any().optional())]},
    output: [typed(z.never())],
    async call({on, cause}) {
      throw Object.assign(asError(on), cause === undefined ? {} : {cause: asError(cause)})
    }
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

  '/partitionErrors': {
    description: 'Split a list into {successes, failures}; failures are errors as data',
    input: listTarget,
    output: [typed(z.object({successes: list, failures: list}))],
    call: async ({on}) => ({successes: on.filter(item => !isErrorData(item)), failures: on.filter(isErrorData)})
  },

  '/concat': {
    description: 'Concatenate several lists into one',
    input: {args: ['target', typed(z.array(list).min(1))]},
    output: [typed(list)],
    call: async ({args}) => [].concat(...args)
  },

  '/when': {
    description: '`then` when test is truthy, otherwise `otherwise`',
    output: [['type', {union: [{fromField: 'then'}, {fromField: 'otherwise'}]}]],
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
    output: [['type', {pick: [{fromField: 'on'}, {fromValue: 'fields'}]}]],
    call: async ({on, fields}) => pick(on, fields)
  },

  '/merge': {
    description: 'Deep merge of `with` onto `on`, as a new object; lists are a set union',
    input: {on: ['target', typed(object)], with: [typed(object)]},
    output: [['type', {merge: [{fromField: 'on'}, {fromField: 'with'}]}]],
    call: async ({on, with: withObj}) => mergeValues(on, withObj)
  },

  '/format': {
    description: 'A value as text, shown with the Query\'s inspect settings',
    input: {on: ['target'], settings: ['settings']},
    output: [typed(z.string())],
    call: async ({on, settings}) => format(on, settings?.inspect)
  },

  '/inspect': {
    description: 'Show a value through the runtime\'s log, formatted with the Query\'s inspect settings, and return it',
    input: {on: ['target'], settings: ['settings'], color: [typed(z.string().optional())], to: [typed(destination)]},
    output: [['type', {fromField: 'on'}]],
    async call({on, settings, color, to}) {
      const timestamp = settings?.ts ? `[${new Date().toISOString()}] ` : ''
      await this.runtime.log(timestamp + format(on, settings?.inspect), {color, to})
      return on
    }
  },

  '/log': {
    description: 'Write a value, as text, through the runtime\'s log, and return it',
    input: {on: ['target'], to: [typed(destination)]},
    output: [['type', {fromField: 'on'}]],
    async call({on, to}) {
      await this.runtime.log(format(on), {to})
      return on
    }
  },

  '/template': {
    description: 'Its own fields, with every reference resolved',
    input: {on: ['target']},
    call: async (args) => args
  }
}

const tableService = serviceFromTable(table)

// A retired resource is refused with what replaced it.
const util = {
  ...tableService,
  lookup(parts) {
    if (Object.hasOwn(RETIRED, parts.resource)) throw new Error(`[util]${parts.resource} is retired. ${RETIRED[parts.resource]}`)
    return tableService.lookup(parts)
  }
}

export default util
