/**
 * @fileoverview Utility service for common data transformations in MicroQL.
 * Resources are addressed by service keys with no method: `[util]/each`.
 *
 * `inspect` and `log` reach the outside world through env's `log`, which the
 * runtime hands each instance of the service at init. Both return what they
 * were given, so they sit anywhere in a chain.
 */

import {isPlainObject, mapValues, pick} from '../common/common.js'
import {canonical} from '../query/forms.js'
import {defineService} from './define-service.js'
import {errorOf} from '../common/error-catalog.js'
import {format} from '../common/format.js'
import {isErrorData, fromErrorData} from '../execute/errors.js'
import {parseSchema, formatError} from '@tlsft/zodly'

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

// The call's results for every item, in order: all run at once, or one at a
// time when sequential.
const eachItem = ({on, service, sequential}) => sequential ? inSequence(on, service) : Promise.all(on.map(item => service(item)))

const inSequence = (items, service) =>
  items.reduce(async (done, item) => [...await done, await service(item)], Promise.resolve([]))

// The list without the items that fit the skip schema, if there is one.
function leaveOut(list, skip) {
  if (skip === undefined) return list
  const schema = parseSchema(skip)
  return list.filter(item => !schema.safeParse(item).success)
}

const pause = (ms) => new Promise(resolve => setTimeout(resolve, ms))

// Runs a pass up to `times` times, `interval` ms apart, until one is done:
// every pass's outcome, and what stopped them (until or times).
async function runPasses({pass, done, times, interval = 0}) {
  const outcomes = []
  while (outcomes.length < times) {
    if (outcomes.length) await pause(interval)
    const outcome = await pass()
    outcomes.push(outcome)
    if (done(outcome)) return {outcomes, stoppedBy: 'until'}
  }
  return {outcomes, stoppedBy: 'times'}
}

// Why a waitFor attempt missed: its error, or how its result misses expect;
// nothing when it passed.
function missOf(expected, {result, error}) {
  if (error) return error.message
  const parsed = expected?.safeParse(result)
  return parsed && !parsed.success ? formatError(parsed.error, result) : undefined
}

// One waitFor attempt: the call's result, or how it failed, and why it missed.
async function attempt(service, expected) {
  const outcome = await service().then(result => ({result}), error => ({error}))
  return {...outcome, miss: missOf(expected, outcome)}
}

// A value as an Error: error data as the error it describes, anything else
// as an error saying what it is.
const asError = (value) => isErrorData(value) ? fromErrorData(value) : new Error(format(value))

// Resources that are gone, with what replaced them.
const RETIRED = {
  '/print': 'Use [util]/inspect.',
  '/recordFailure': 'Use [util]/log with to:.',
  '/removeErrors': 'Use skip: [\'error\'] on the iteration.',
  '/removeNulls': 'Use skip: [\'null\'] on the iteration.',
  '/removeSuccesses': 'Use [util]/partitionErrors and take its failures.'
}

// MicroQL's builtin service, as a service definition (see define-service.js).
// It is also the reference for writing one: each service call's declaration
// says which field method syntax fills, which fields hold nested calls and
// what they receive, and the types of its input and output.
const serviceDefinition = {
  requires: ['log'],

  // Keeps the env this instance was made with.
  init(env) {
    this.env = env
  },

  '/each': {
    description: 'Run a call for every item of a list, all at once or one at a time (sequential), returning their results in order, less those that fit skip',
    input: {
      on: ['array', {tags: ['target']}],
      service: ['call', {input: ['type', {fromList: 'on'}]}],
      skip: ['any', 'optional'],
      sequential: ['boolean', {default: false}]
    },
    // a list of what the call returns, less what fits the schema written in skip
    output: ['array', ['type', {without: [{fromField: 'service'}, {fromZodly: {fromValue: 'skip'}}]}]],
    call: async (args) => leaveOut(await eachItem(args), args.skip)
  },

  '/flattenEach': {
    description: 'Run a call that returns a list for every item of a list, all at once or one at a time (sequential), returning one list of all their items, less those that fit skip',
    input: {
      on: ['array', {tags: ['target']}],
      service: ['call', {input: ['type', {fromList: 'on'}], output: ['array']}],
      skip: ['any', 'optional'],
      sequential: ['boolean', {default: false}]
    },
    // a list of the items of the lists the call returns, less what fits the schema written in skip
    output: ['array', ['type', {without: [{fromList: 'service'}, {fromZodly: {fromValue: 'skip'}}]}]],
    call: async (args) => leaveOut((await eachItem(args)).flat(), args.skip)
  },

  '/waitFor': {
    description: 'Run a call until it succeeds and its result fits expect, every interval, at most tries times; its passing result',
    input: {
      service: ['call'],
      expect: ['any', 'optional'],
      tries: ['number', 'int', {min: 1}, {default: 10}],
      interval: ['number', {min: 0}, {default: 200}]
    },
    output: ['type', {fromField: 'service'}],
    async call({service, expect, tries, interval}) {
      const expected = expect === undefined ? undefined : parseSchema(expect)
      const {outcomes, stoppedBy} = await runPasses({
        pass: () => attempt(service, expected),
        done: ({miss}) => miss === undefined,
        times: tries,
        interval
      })
      const last = outcomes.at(-1)
      if (stoppedBy === 'until') return last.result
      throw errorOf('gave-up', {tries: outcomes.length, miss: last.miss})
    }
  },

  '/repeat': {
    description: 'Run a call times times, every interval, or until its result fits until; every pass\'s result, and what stopped them',
    input: {
      service: ['call'],
      until: ['any', 'optional'],
      times: ['number', 'int', {min: 1}, {default: 10}],
      interval: ['number', {min: 0}, 'optional']
    },
    output: {passes: ['array', ['type', {fromField: 'service'}]], stoppedBy: ['enum', ['until', 'times']]},
    async call({service, until, times, interval}) {
      const fits = until === undefined ? () => false : (result) => parseSchema(until).safeParse(result).success
      const {outcomes, stoppedBy} = await runPasses({pass: () => service(), done: fits, times, interval})
      return {passes: outcomes, stoppedBy}
    }
  },

  '/try': {
    description: 'Run a call on `on`, returning its result: a catch here handles its failure',
    input: {on: ['any', 'optional', {tags: ['target']}], service: ['call', {input: ['type', {fromField: 'on'}]}]},
    output: ['type', {fromField: 'service'}],
    call: async ({on, service}) => service(on)
  },

  '/throw': {
    description: 'Fail with `on`: error data as the error it describes, anything else as an error saying it; `cause` is the error behind it',
    input: {on: ['any', 'optional', {tags: ['target']}], cause: ['any', 'optional']},
    output: ['never'],
    async call({on, cause}) {
      throw Object.assign(asError(on), cause === undefined ? {} : {cause: asError(cause)})
    }
  },

  '/filter': {
    description: 'Keep the items for which a call is truthy, or remove them with mode: remove',
    input: {
      on: ['array', {tags: ['target']}],
      service: ['call', {input: ['type', {fromList: 'on'}], output: ['boolean']}],
      mode: ['enum', ['keep', 'remove'], {default: 'keep'}]
    },
    output: ['type', {fromField: 'on'}],
    async call({on, service, mode}) {
      const tests = await Promise.all(on.map(item => service(item)))
      const keep = mode === 'keep'
      return on.filter((_, index) => Boolean(tests[index]) === keep)
    }
  },

  '/partitionErrors': {
    description: 'Split a list into {successes, failures}; failures are errors as data',
    input: {on: ['array', {tags: ['target']}]},
    output: {successes: ['array'], failures: ['array']},
    call: async ({on}) => ({successes: on.filter(item => !isErrorData(item)), failures: on.filter(isErrorData)})
  },

  '/concat': {
    description: 'Concatenate several lists into one',
    input: {args: ['array', ['array'], {min: 1, tags: ['target']}]},
    output: ['array'],
    call: async ({args}) => [].concat(...args)
  },

  '/when': {
    description: '`then` when test is truthy, otherwise `otherwise`',
    output: ['union', ['type', {fromField: 'then'}], ['type', {fromField: 'otherwise'}]],
    call: async ({test, then, otherwise}) => test ? then : otherwise
  },

  '/eq': {
    description: 'Whether l and r are the same value',
    output: ['boolean'],
    call: async ({l, r}) => l === r
  },

  '/gt': {
    description: 'Whether l is greater than r',
    input: {l: ['number'], r: ['number']},
    output: ['boolean'],
    call: async ({l, r}) => l > r
  },

  '/lt': {
    description: 'Whether l is less than r',
    input: {l: ['number'], r: ['number']},
    output: ['boolean'],
    call: async ({l, r}) => l < r
  },

  '/exists': {
    description: 'Whether value is neither null nor undefined',
    output: ['boolean'],
    call: async ({value}) => value != null
  },

  '/length': {
    description: 'The length of a list or string, 0 for anything else',
    output: ['number'],
    call: async ({value}) => value?.length || 0
  },

  '/pick': {
    description: 'The listed fields that an object has',
    input: {on: ['record', {tags: ['target']}], fields: ['array', ['string'], {min: 1}]},
    output: ['type', {picked: [{fromField: 'on'}, {fromValue: 'fields'}]}],
    call: async ({on, fields}) => pick(on, fields)
  },

  '/merge': {
    description: 'Deep merge of `with` onto `on`, as a new object; lists are a set union',
    input: {on: ['record', {tags: ['target']}], with: ['record']},
    output: ['type', {merged: [{fromField: 'on'}, {fromField: 'with'}]}],
    call: async ({on, with: withObj}) => mergeValues(on, withObj)
  },

  '/format': {
    description: 'A value as text, shown with the Query\'s inspect settings',
    input: {on: ['any', 'optional', {tags: ['target']}], settings: ['any', 'optional', {tags: ['settings']}]},
    output: ['string'],
    call: async ({on, settings}) => format(on, settings?.inspect)
  },

  '/inspect': {
    description: 'Show a value through the runtime\'s log, formatted with the Query\'s inspect settings, and return it',
    input: {
      on: ['any', 'optional', {tags: ['target']}],
      settings: ['any', 'optional', {tags: ['settings']}],
      color: ['string', 'optional'],
      to: ['string', {min: 1}, 'optional']
    },
    output: ['type', {fromField: 'on'}],
    async call({on, settings, color, to}) {
      const timestamp = settings?.ts ? `[${new Date().toISOString()}] ` : ''
      await this.env.log(timestamp + format(on, settings?.inspect), {color, to})
      return on
    }
  },

  '/log': {
    description: 'Write a value, as text, through the runtime\'s log, and return it',
    input: {on: ['any', 'optional', {tags: ['target']}], to: ['string', {min: 1}, 'optional']},
    output: ['type', {fromField: 'on'}],
    async call({on, to}) {
      await this.env.log(format(on), {to})
      return on
    }
  },

  '/template': {
    description: 'Its own fields, with every reference resolved',
    // any fields at all: they're what it returns
    input: [{on: ['any', 'optional', {tags: ['target']}]}, 'loose'],
    call: async (args) => args
  }
}

const definedService = defineService(serviceDefinition)

// A retired resource is refused with what replaced it.
const util = {
  ...definedService,
  lookup(key) {
    if (Object.hasOwn(RETIRED, key.resource)) throw errorOf('retired-key', {retired: `[util]${key.resource}`, replacement: RETIRED[key.resource]})
    return definedService.lookup(key)
  }
}

export default util
