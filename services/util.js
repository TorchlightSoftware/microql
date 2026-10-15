/**
 * @fileoverview Utility service for common data transformations in MicroQL.
 * Resources are addressed by verbless service keys: `[util]/each`.
 *
 * `inspect` and `log` reach the outside world through the runtime's `log`,
 * which MicroQL hands to the service at init. Both return what they were
 * given, so they sit anywhere in a chain.
 */

import {isPlainObject, mapValues, pick} from '../common.js'
import {canonical} from '../forms.js'
import {defineService} from '../define-service.js'
import {format} from '../format.js'
import {isErrorData, fromErrorData} from '../errors.js'
import {parseSchema} from 'zodly'

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

// MicroQL's builtin service, as a service definition (see define-service.js).
// It is also the reference for writing one: each operation's declaration
// says which field method syntax fills, which fields hold nested calls and
// what they receive, and the types of its input and output.
const serviceDefinition = {
  requires: ['log'],

  // Receives the runtime's capabilities before a Run uses this service.
  init(runtime) {
    this.runtime = runtime
  },

  '/each': {
    description: 'Run a call for every item of a list, returning their results in order, less those that fit skip',
    input: {
      on: ['target', ['type', ['array']]],
      service: [['call', {fromList: 'on'}]],
      skip: [['type', ['any', 'optional']]]
    },
    // a list of what the call returns, less what fits the schema written in skip
    output: [['type', {toList: {difference: [{fromField: 'service'}, {fromZodly: {fromValue: 'skip'}}]}}]],
    call: async (args) => leaveOut(await eachItem(args), args.skip)
  },

  '/flattenEach': {
    description: 'Run a call that returns a list for every item of a list, returning one list of all their items, less those that fit skip',
    input: {
      on: ['target', ['type', ['array']]],
      service: [['call', {fromList: 'on'}], ['type', ['array']]],
      skip: [['type', ['any', 'optional']]]
    },
    // a list of the items of the lists the call returns, less what fits the schema written in skip
    output: [['type', {toList: {difference: [{fromList: 'service'}, {fromZodly: {fromValue: 'skip'}}]}}]],
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
    input: {on: ['target'], cause: [['type', ['any', 'optional']]]},
    output: [['type', ['never']]],
    async call({on, cause}) {
      throw Object.assign(asError(on), cause === undefined ? {} : {cause: asError(cause)})
    }
  },

  '/filter': {
    description: 'Keep the items for which a call is truthy, or remove them with mode: remove',
    input: {
      on: ['target', ['type', ['array']]],
      service: [['call', {fromList: 'on'}], ['type', ['boolean']]],
      mode: [['type', ['enum', ['keep', 'remove'], 'optional']]]
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
    input: {on: ['target', ['type', ['array']]]},
    output: [['type', ['object', {successes: ['array'], failures: ['array']}]]],
    call: async ({on}) => ({successes: on.filter(item => !isErrorData(item)), failures: on.filter(isErrorData)})
  },

  '/concat': {
    description: 'Concatenate several lists into one',
    input: {args: ['target', ['type', ['array', ['array'], {min: 1}]]]},
    output: [['type', ['array']]],
    call: async ({args}) => [].concat(...args)
  },

  '/when': {
    description: '`then` when test is truthy, otherwise `otherwise`',
    output: [['type', {union: [{fromField: 'then'}, {fromField: 'otherwise'}]}]],
    call: async ({test, then, otherwise}) => test ? then : otherwise
  },

  '/eq': {
    description: 'Whether l and r are the same value',
    output: [['type', ['boolean']]],
    call: async ({l, r}) => l === r
  },

  '/gt': {
    description: 'Whether l is greater than r',
    input: {l: [['type', ['number']]], r: [['type', ['number']]]},
    output: [['type', ['boolean']]],
    call: async ({l, r}) => l > r
  },

  '/lt': {
    description: 'Whether l is less than r',
    input: {l: [['type', ['number']]], r: [['type', ['number']]]},
    output: [['type', ['boolean']]],
    call: async ({l, r}) => l < r
  },

  '/exists': {
    description: 'Whether value is neither null nor undefined',
    output: [['type', ['boolean']]],
    call: async ({value}) => value != null
  },

  '/length': {
    description: 'The length of a list or string, 0 for anything else',
    output: [['type', ['number']]],
    call: async ({value}) => value?.length || 0
  },

  '/pick': {
    description: 'The listed fields that an object has',
    input: {on: ['target', ['type', ['record']]], fields: [['type', ['array', ['string'], {min: 1}]]]},
    output: [['type', {pick: [{fromField: 'on'}, {fromValue: 'fields'}]}]],
    call: async ({on, fields}) => pick(on, fields)
  },

  '/merge': {
    description: 'Deep merge of `with` onto `on`, as a new object; lists are a set union',
    input: {on: ['target', ['type', ['record']]], with: [['type', ['record']]]},
    output: [['type', {merge: [{fromField: 'on'}, {fromField: 'with'}]}]],
    call: async ({on, with: withObj}) => mergeValues(on, withObj)
  },

  '/format': {
    description: 'A value as text, shown with the Query\'s inspect settings',
    input: {on: ['target'], settings: ['settings']},
    output: [['type', ['string']]],
    call: async ({on, settings}) => format(on, settings?.inspect)
  },

  '/inspect': {
    description: 'Show a value through the runtime\'s log, formatted with the Query\'s inspect settings, and return it',
    input: {on: ['target'], settings: ['settings'], color: [['type', ['string', 'optional']]], to: [['type', ['string', {min: 1}, 'optional']]]},
    output: [['type', {fromField: 'on'}]],
    async call({on, settings, color, to}) {
      const timestamp = settings?.ts ? `[${new Date().toISOString()}] ` : ''
      await this.runtime.log(timestamp + format(on, settings?.inspect), {color, to})
      return on
    }
  },

  '/log': {
    description: 'Write a value, as text, through the runtime\'s log, and return it',
    input: {on: ['target'], to: [['type', ['string', {min: 1}, 'optional']]]},
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

const definedService = defineService(serviceDefinition)

// A retired resource is refused with what replaced it.
const util = {
  ...definedService,
  lookup(parts) {
    if (Object.hasOwn(RETIRED, parts.resource)) throw new Error(`[util]${parts.resource} is retired. ${RETIRED[parts.resource]}`)
    return definedService.lookup(parts)
  }
}

export default util
