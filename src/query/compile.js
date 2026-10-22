/**
 * @fileoverview MicroQL Query Compiler
 *
 * Compiles a Query into a plain tree of phases and service calls. Compile is
 * pure: it reads the Query and the services of the scope it runs in, checks
 * every reference against the context it appears in, and assigns each call
 * its Service Call Address. It never makes a call: execute does, through the
 * scope.
 *
 * Domain:
 *   Phase     a named node of the Query; a chain of service calls (a chain of
 *             one is just a call). `$name` refers to its result.
 *   Call      one service call: a service key, its data arguments, its
 *             settings, and its positions.
 *   Position  a field that holds a call or a chain of calls: one the service
 *             call's declaration types `call`, or `catch`, which handles a
 *             failure of any of them.
 *   Address   a call's Service Call Address (`$listings.@1a2`): calls are
 *             numbered, positions lettered in sorted key order, alternating;
 *             `e` is kept for catch, so adding one moves no other address.
 *
 * We intentionally did not use zod schemas for the Query's grammar: compile
 * checks it as it walks the Query. A schema would repeat the compiler's
 * structure and logic, and its errors couldn't carry the compile error codes
 * and Service Call Addresses that compile reports.
 */

import {parseServiceKey} from '@tlsft/service-key'

import {errorOf, locate, isCatalogued, reasonOf} from '../common/error-catalog.js'
import {RESERVE_ARGS, VALIDATION_NAMES, isPlainObject, mapValues, pick, omit, omitIn, getIn, setIn, defaults} from '../common/common.js'
import {readDeclaration} from '../types/declaration.js'
import {isReference, parseReference, readOf, readsOutside} from './reference.js'
import {parseSchema} from '@tlsft/zodly'
import {fieldPathOf} from './addresses.js'

// Nodes resolved before the first phase runs; never valid phase names.
const ROOT_NODES = ['given', 'trigger']

// The retired `service:action` form, recognised only to explain its replacement.
const RETIRED_KEY = /^(\w+):(\w+)$/

// Call fields' letters, in sorted key order; catch is always `e`, for error.
const CATCH_LETTER = 'e'
const FIELD_LETTERS = [...'abcdefghijklmnopqrstuvwxyz'].filter(letter => letter !== CATCH_LETTER)

// Each position's letter, by field path.
const lettersOf = (fields) => {
  const held = fields.filter(({path}) => path !== 'catch')
  return Object.fromEntries([...held.map(({path}, i) => [path, FIELD_LETTERS[i]]), ['catch', CATCH_LETTER]])
}

// Arguments and settings that are gone, with what replaced them.
const RETIRED_ARGS = {
  onError: 'Use catch: on the call holding the calls whose failures it handles',
  ignoreErrors: 'A catch handles a failure in place; without one, a failure fails the call that holds it',
  skipInputErrors: 'Failures stay thrown until a catch handles them, so no input holds one',
  skipOutputErrors: 'Use catch: to handle each failure, then skip: [\'error\'] to leave them out'
}

// Fails on the first retired argument among the keys.
function checkRetired(site, keys) {
  const retired = keys.find(key => Object.hasOwn(RETIRED_ARGS, key))
  if (retired) fail(site, 'retired-key', {retired, replacement: `${RETIRED_ARGS[retired]}.`})
}

// A compile-time error at its site: its message starts with the address, and
// the error carries it (see docs/runtime-integration.md § Errors).
const atSite = (site, error) => Object.assign(locate(error, `[${site.address}]`), {address: site.address})

// Fails at a site with the catalog's error for a code.
const fail = (site, code, details, cause) => {
  throw atSite(site, errorOf(code, details, {cause}))
}

// A chain is an array of service descriptors (each itself an array).
const isChain = (value) =>
  Array.isArray(value) && value.length > 0 && value.every(Array.isArray)


// Splits a descriptor into its service key, arguments and the method-syntax
// target, if any: ['KEY', {...}] or [target, 'KEY', {...}].
function parseDescriptor(site, descriptor) {
  const methodParts = parseServiceKey(descriptor[1])
  if (methodParts) {
    const [target, key, args = {}] = descriptor
    return {key, parts: methodParts, args, target, hasTarget: true}
  }

  const [key, args = {}] = descriptor
  const parts = parseServiceKey(key)
  if (!parts) {
    const retired = descriptor.find(d => typeof d === 'string' && RETIRED_KEY.test(d))?.match(RETIRED_KEY)
    if (retired) fail(site, 'retired-key', {retired: retired[0], replacement: `The service:action form is replaced by '[${retired[1]}]/${retired[2]}'.`})
    fail(site, 'invalid-descriptor', {descriptor: JSON.stringify(descriptor)})
  }
  return {key, parts, args, hasTarget: false}
}

const SERVICE_METHODS = ['lookup', 'supportedCalls', 'init']
const isService = (service) => SERVICE_METHODS.every(method => typeof service?.[method] === 'function')

// The first key a service requires that an env lacks, if any.
export const missingCapability = (service, env) => service.requires?.find(key => !(key in env))

// The service a key names among the scope's, once it's known to be a service
// whose env keys the scope has.
function serviceAt(site, {scope}, parts) {
  const service = scope.services.get(parts.service)
  if (!service) fail(site, 'unknown-service', {service: parts.service})
  if (!isService(service)) fail(site, 'not-a-service', {service: parts.service})
  const missing = missingCapability(service, scope.env)
  if (missing) fail(site, 'missing-capability', {service: parts.service, capability: missing})
  return service
}

// What a service's lookup answers for a key: its declaration, or a refusal
// for a key it won't take, such as a resource it lacks or a method it doesn't.
// A refusal not from the catalog is the service's own: a refused key.
function lookedUp(site, service, {key, parts}) {
  try {
    return service.lookup(parts)
  } catch (error) {
    if (isCatalogued(error)) throw atSite(site, error)
    fail(site, 'refused-key', {key, reason: error.message}, error)
  }
}

// The declaration of the service call a key names, as its service's lookup
// answers it, read and checked; any error in it is reported at the call.
function declarationAt(site, service, parsed) {
  const declaration = lookedUp(site, service, parsed)
  try {
    return readDeclaration(declaration)
  } catch (error) {
    fail(site, 'malformed-declaration', {key: parsed.key, reason: reasonOf(error)}, error)
  }
}

// Method syntax puts its target in the field the declaration tags target.
function targetField(site, declaration, key) {
  if (!declaration.target) fail(site, 'no-target', {key})
  return declaration.target.path
}

// A shorthand schema as zod, with an error in it reported at its site.
function parseSchemaAt(site, designation, order, schema) {
  try {
    return parseSchema(schema)
  } catch (error) {
    fail(site, 'malformed-schema', {validation: designation, order, details: error.message}, error)
  }
}

// A call's Service Call Validations (from its fields) woven with its Service
// Service Defined Validations (the service call's declared schemas), parsed, by order.
const compileValidators = (site, args, declaration) => {
  const order = {
    precheck: {call: args.precheck, schema: declaration.inputSchema},
    postcheck: {schema: declaration.outputSchema, call: args.postcheck}
  }
  let hasValidators = false
  for (const o in order) {
    for (const d in order[o]) {
      if (order[o][d]) {
        hasValidators = true
        order[o][d] = parseSchemaAt(site, VALIDATION_NAMES[d], o, order[o][d])
      }
    }
  }
  return hasValidators ? order : undefined
}

// A call's settings: its own reserve args, then any settings-tagged fields,
// then the Query's global settings (except those that only apply globally).
const compileSettings = (serviceName, args, settingsArgs, querySettings) => {
  const ownSettings = omit(pick(args, RESERVE_ARGS), ['catch', 'precheck', 'postcheck'])
  const globalSettings = omit(querySettings, ['catch', 'cache', 'rateLimit', 'concurrency'])
  const settings = defaults(ownSettings, ...Object.values(settingsArgs), globalSettings)
  settings.rateLimit = querySettings.rateLimit?.[serviceName]
  return settings
}

// Checks every reference in a call's data arguments against its context, and
// returns the phases they depend on and what they read.
function checkReferences(site, args, context, query) {
  const dependencies = new Set()
  const reads = []
  const check = (value) => {
    if (isReference(value)) {
      const ref = parseWithSite(site, value)
      checkReference(site, ref, value, context, query)
      reads.push(readOf(ref, context))
      if (ref.sigil === '$' && !ROOT_NODES.includes(ref.name)) dependencies.add(ref.name)
    } else if (Array.isArray(value)) {
      value.forEach(check)
    } else if (isPlainObject(value)) {
      Object.values(value).forEach(check)
    }
  }
  check(args)
  return {dependencies, reads}
}

// One read per key.
const uniqueReads = (reads) => [...new Map(reads.map(read => [read.key, read])).values()]

function parseWithSite(site, text) {
  try {
    return parseReference(text)
  } catch (error) {
    throw atSite(site, error)
  }
}

function checkReference(site, {sigil, name, depth}, text, context, query) {
  if (sigil === '$' && !query.nodeNames.has(name)) fail(site, 'unknown-reference', {reference: text})
  if (depth > context.errors) fail(site, 'unknown-error', {reference: text, catches: context.errors})
  if (sigil === '@' && name && !depth && !context.bindings.includes(name)) fail(site, 'unknown-binding', {reference: text, binding: name})
  if (sigil === '@' && !name && !context.flow) fail(site, 'nothing-flows', {reference: text})
}

// Declares an iteration name; names are Query-scoped, so each is used once.
function declareBinding(site, name, query) {
  if (name === 'err') fail(site, 'reserved-name', {reserved: name, naming: 'an iteration: @err is the error in catch'})
  if (query.bindingNames.has(name)) fail(site, 'duplicate-binding', {binding: name})
  query.bindingNames.add(name)
  if (query.nodeNames.has(name)) {
    query.warnings.push({address: site.address, message: `Binding '@${name}' shares its name with '$${name}'`})
  }
}

// The sites of a call or chain's steps: addresses numbered from 1 under an
// address prefix, and JSON paths under the container's path.
const sitesAt = (prefix, path) => (i, chain) => ({
  address: `${prefix}${i + 1}`,
  path: chain ? [...path, i] : path
})

// Compiles a call or chain at consecutive sites. Each step's flow is the
// previous step's result; a lone call receives the container's input, if it
// has one, and a chain's first step receives nothing.
function compileSteps(value, siteOf, context, hasInput, query) {
  const chain = isChain(value)
  const descriptors = chain ? value : [value]
  return descriptors.map((descriptor, i) =>
    compileCall(descriptor, siteOf(i, chain), {...context, flow: i > 0 || (hasInput && !chain)}, query))
}

// A position: the field's call or chain, compiled in the owner's context plus
// its iteration name. A single call receives its input as `@`; a chain's
// first step receives nothing, so a chain reaches its input by name only.
// catch's input is the error, reached as @err (with one more @ for each catch
// it is inside); `as:` names the item whose call failed, as in the others.
function compilePosition(owner, field, letter, value, context, as, query) {
  // an object in a service position is a template of its input
  const descriptor = isPlainObject(value) ? ['[util]/template', value] : value
  const chain = isChain(descriptor)
  if (chain && field !== 'catch' && !as) {
    fail(owner, 'unreachable-input', {field})
  }

  const inner = {
    bindings: as ? [...context.bindings, as] : context.bindings,
    errors: field === 'catch' ? context.errors + 1 : context.errors
  }
  const siteOf = sitesAt(`${owner.address}${letter}`, fieldPathOf(owner, field))
  return {
    field,
    chain,
    as,
    steps: compileSteps(descriptor, siteOf, inner, true, query)
  }
}

// The fields of a call that hold calls, by path: those its declaration types
// call, and catch.
function positionFields(site, args, declaration, key) {
  const fields = [...declaration.calls, {path: 'catch', segments: ['catch']}]
    .filter(({segments}) => getIn(args, segments) !== undefined)
  for (const {path, segments} of fields) {
    if (typeof getIn(args, segments) === 'function') {
      fail(site, 'raw-function', {key, path})
    }
  }
  // a reference or literal in a call field stays data
  return fields
    .filter(({path, segments}) => path === 'catch' || Array.isArray(getIn(args, segments)) || isPlainObject(getIn(args, segments)))
    .sort((a, b) => a.path.localeCompare(b.path))
}

// Compiles one service descriptor at a site, in a context.
function compileCall(descriptor, site, context, query) {
  if (!Array.isArray(descriptor)) fail(site, 'invalid-descriptor', {descriptor: JSON.stringify(descriptor)})
  const parsed = parseDescriptor(site, descriptor)
  const service = serviceAt(site, query, parsed.parts)
  const declaration = declarationAt(site, service, parsed)
  if (!isPlainObject(parsed.args)) fail(site, 'invalid-arguments', {key: parsed.key})

  const call = {
    address: site.address,
    path: site.path,
    argsPath: [...site.path, parsed.hasTarget ? 2 : 1],
    targetField: parsed.hasTarget ? targetField(site, declaration, parsed.key) : undefined,
    key: parsed.key,
    parts: parsed.parts,
    declaration,
    ownTimeout: parsed.args.timeout !== undefined
  }

  const args = parsed.hasTarget ? setIn(parsed.args, declaration.target.segments, parsed.target) : parsed.args
  checkRetired(site, Object.keys(args))
  const {as} = args
  const fields = positionFields(site, args, declaration, parsed.key)
  const holdsCalls = fields.some(f => f.path !== 'catch')
  if (as !== undefined) {
    if (!holdsCalls) fail(site, 'misplaced-as', {key: parsed.key})
    declareBinding(site, as, query)
  }
  if (args.catch !== undefined && !holdsCalls) {
    fail(site, 'misplaced-catch', {key: parsed.key})
  }

  const held = [...fields, ...declaration.settings]
  call.args = omit(held.reduce((rest, {segments}) => omitIn(rest, segments), args), [...RESERVE_ARGS, 'as'])
  call.settingsArgs = Object.fromEntries(declaration.settings.map(({path, segments}) => [path, getIn(args, segments) ?? {}]))
  call.settings = compileSettings(parsed.parts.service, args, call.settingsArgs, query.settings)
  call.checks = pick(args, ['precheck', 'postcheck'])
  call.validators = compileValidators(site, args, declaration)
  const own = checkReferences(site, {...call.args, ...call.settingsArgs}, context, query)
  const letters = lettersOf(fields)
  call.positions = Object.fromEntries(fields.map(({path, segments}) =>
    [path, compilePosition(call, path, letters[path], getIn(args, segments), context, as, query)]))

  // what the calls it holds read from outside it is part of its input, as
  // much as its own fields are: their results differ with it
  const steps = Object.values(call.positions).flatMap(position => position.steps)
  call.closure = uniqueReads(steps.flatMap(step => step.reads).filter(read => readsOutside(read, context)))
  call.reads = uniqueReads([...own.reads, ...call.closure])
  call.dependencies = steps.reduce((deps, step) => deps.union(step.dependencies), own.dependencies)
  query.calls.push(call)
  return call
}

function compilePhase(name, descriptor, query) {
  if (ROOT_NODES.includes(name)) fail({address: `$${name}`}, 'reserved-name', {reserved: name, naming: 'a phase'})
  const steps = compileSteps(descriptor, sitesAt(`$${name}.@`, ['phases', name]), {bindings: [], errors: 0}, false, query)
  return {
    name,
    steps,
    dependencies: steps.reduce((deps, step) => deps.union(step.dependencies), new Set())
  }
}

// The Query's catch handles each phase that fails: its result is the phase's.
function compileGlobalCatch(value, query) {
  const siteOf = sitesAt('settings.catch.@', ['settings', 'catch'])
  return {field: 'catch', chain: isChain(value), steps: compileSteps(value, siteOf, {bindings: [], errors: 1}, true, query)}
}

// `select` names what the Query returns: one reference, or a list of phases.
function compileSelect(select, query) {
  if (select === undefined) return undefined
  const site = {address: 'select'}
  const refs = [].concat(select).map(text => {
    const ref = isReference(text) ? parseWithSite(site, text) : fail(site, 'invalid-select', {select: text})
    if (ref.sigil !== '$' || !query.nodeNames.has(ref.name)) fail(site, 'unknown-reference', {reference: text})
    return ref
  })
  return Array.isArray(select) ? refs : refs[0]
}

/**
 * Compile a Query into its tree of phases and calls, for the scope it runs in.
 * @returns {Object} {phases, calls, given, trigger, triggerSchema, select, settings, scope, warnings},
 *   where scope is the one the Query was compiled in, which execute runs it in
 */
export function compile(config) {
  const {phases = {}, given, trigger, settings = {}, scope} = config
  if (!scope) throw errorOf('missing-scope', {}, {where: 'compile:'})
  checkRetired({address: 'settings'}, Object.keys(settings))

  const query = {
    scope,
    settings,
    // $trigger always exists: it holds whatever payload the Run is given
    nodeNames: new Set([...Object.keys(phases), ...(given !== undefined ? ['given'] : []), 'trigger']),
    bindingNames: new Set(),
    warnings: [],
    calls: []
  }

  const compiledPhases = mapValues(phases, (descriptor, name) => compilePhase(name, descriptor, query))

  return {
    phases: compiledPhases,
    calls: query.calls,
    given,
    trigger,
    triggerSchema: trigger?.schema && parseSchemaAt({address: '$trigger'}, 'trigger', 'schema', trigger.schema),
    select: compileSelect(config.select, query),
    settings: {
      ...settings,
      catch: settings.catch ? compileGlobalCatch(settings.catch, query) : undefined
    },
    scope,
    warnings: query.warnings
  }
}

export default compile
