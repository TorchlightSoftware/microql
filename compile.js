/**
 * @fileoverview MicroQL Query Compiler
 *
 * Compiles a Query into a plain tree of phases and service calls. Compile is
 * pure: it reads the Query and the service definitions, checks every reference
 * against the scope it appears in, and assigns each call its Service Call
 * Address. Nothing here touches the runtime; execute attaches that.
 *
 * Domain:
 *   Phase     a named node of the Query; a chain of service calls (a chain of
 *             one is just a call). `$name` refers to its result.
 *   Call      one service call: a service key, its data arguments, its
 *             settings, and its positions.
 *   Position  a field that takes a service — a service-typed argument or
 *             `onError` — holding a call or a chain of calls.
 *   Address   a call's Service Call Address (`$listings.@1a2`): calls are
 *             numbered, positions lettered in sorted key order, alternating.
 */

import _ from 'lodash'
import {parseServiceKey} from '@tlsft/service-key'

import {RESERVE_ARGS} from './common.js'
import {isReference, parseReference} from './reference.js'
import {parseSchema} from './validation.js'
import {fieldPathOf} from './addresses.js'
import util from './services/util.js'

// Nodes resolved before the first phase runs; never valid phase names.
const ROOT_NODES = ['given', 'trigger']

// The retired `service:action` form, recognised only to explain its replacement.
const RETIRED_KEY = /^(\w+):(\w+)$/

const LETTERS = 'abcdefghijklmnopqrstuvwxyz'

const fail = (site, message) => {
  throw new Error(`[${site.address}] ${message}`)
}

// A chain is an array of service descriptors (each itself an array).
const isChain = (value) =>
  Array.isArray(value) && value.length > 0 && value.every(Array.isArray)

const isPlainObject = (value) => _.isPlainObject(value)

// Splits a descriptor into its service key, arguments and the method-syntax
// target, if any: ['KEY', {...}] or [target, 'KEY', {...}].
function parseDescriptor(site, descriptor) {
  const methodParts = typeof descriptor[1] === 'string' && parseServiceKey(descriptor[1])
  if (methodParts) {
    const [target, key, args = {}] = descriptor
    return {key, parts: methodParts, args, target, hasTarget: true}
  }

  const [key, args = {}] = descriptor
  const parts = parseServiceKey(key)
  if (!parts) {
    const retired = descriptor.find(d => typeof d === 'string' && RETIRED_KEY.test(d))?.match(RETIRED_KEY)
    if (retired) fail(site, `Service key '${retired[0]}' uses the retired service:action form. Use 'GET [${retired[1]}]/${retired[2]}'`)
    fail(site, `Invalid service descriptor. Expected ['METHOD [service]/resource', {...}] format. Got: ${JSON.stringify(descriptor)}`)
  }
  return {key, parts, args, hasTarget: false}
}

// The function answering a service key: the service by name, its resource,
// then the resource's method. A resource given as a function answers GET; one
// with several methods is an object of one function per method.
function lookupAction(site, services, {service: serviceName, resource, method}) {
  const service = services[serviceName]
  if (!service) fail(site, `Service '${serviceName}' not found`)
  if (typeof service !== 'object') {
    fail(site, `Service '${serviceName}' must be an object of resources in the form: {'/resource': async (args) => result}`)
  }

  const entry = service[resource]
  if (!entry) fail(site, `Resource '${resource}' not found on service '${serviceName}'`)

  const methods = typeof entry === 'function' ? {GET: entry} : entry
  const action = methods[method]
  if (typeof action !== 'function') {
    fail(site, `Method '${method}' is not declared by [${serviceName}]${resource} (declares ${Object.keys(methods).join(', ')})`)
  }
  return {service, action}
}

// Method syntax puts its target in the argument declared {argOrder: 0}.
function targetField(site, argtypes, key) {
  const [field] = Object.entries(argtypes).find(([, info]) => info.argOrder === 0) || []
  if (!field) fail(site, `Method syntax was used for ${key} but no {argOrder: 0} was defined.`)
  return field
}

function parseSchemaWithErrorContext(designation, order, schema) {
  try {
    return parseSchema(schema)
  } catch (error) {
    error.message = `${designation} ${order} schema parse error:\n${error.message}`
    throw error
  }
}

// The Query's checks (from the call's arguments) woven with the service's own.
const compileValidators = (args, validators) => {
  const order = {
    precheck: {query: args.precheck, service: validators.precheck},
    postcheck: {service: validators.postcheck, query: args.postcheck}
  }
  let hasValidators = false
  for (const o in order) {
    for (const d in order[o]) {
      if (order[o][d]) {
        hasValidators = true
        order[o][d] = parseSchemaWithErrorContext(d, o, order[o][d])
      }
    }
  }
  return hasValidators ? order : undefined
}

// A call's settings: its own reserve args, then any settings-typed arguments,
// then the Query's global settings (except those that only apply globally).
const compileSettings = (serviceName, args, argtypes, querySettings) => {
  const ownSettings = _.omit(_.pick(args, RESERVE_ARGS), ['onError', 'precheck', 'postcheck'])
  const settingsArgs = _.pickBy(args, (a, k) => argtypes[k]?.type === 'settings')
  const globalSettings = _.omit(querySettings, ['onError', 'ignoreErrors', 'cache', 'rateLimit', 'concurrency'])
  const settings = _.defaults({}, ownSettings, ...Object.values(settingsArgs), globalSettings)
  settings.rateLimit = querySettings.rateLimit?.[serviceName]
  return settings
}

// Checks every reference in a call's data arguments against its scope, and
// returns the phases they depend on.
function checkReferences(site, args, scope, query) {
  const dependencies = new Set()
  const check = (value) => {
    if (isReference(value)) {
      const ref = parseWithSite(site, value)
      checkReference(site, ref, value, scope, query)
      if (ref.sigil === '$' && !ROOT_NODES.includes(ref.name)) dependencies.add(ref.name)
    } else if (Array.isArray(value)) {
      value.forEach(check)
    } else if (isPlainObject(value)) {
      Object.values(value).forEach(check)
    }
  }
  check(args)
  return dependencies
}

function parseWithSite(site, text) {
  try {
    return parseReference(text)
  } catch (error) {
    fail(site, error.message)
  }
}

function checkReference(site, {sigil, name, depth}, text, scope, query) {
  if (sigil === '$' && !query.nodeNames.has(name)) fail(site, `Unknown reference '${text}': no phase or node named '${name}'`)
  if (depth > scope.errors) {
    fail(site, scope.errors ? `Unknown reference '${text}': it is inside only ${scope.errors} onError` : `Unknown reference '${text}': no enclosing onError`)
  }
  if (sigil === '@' && name && !depth && !scope.bindings.includes(name)) fail(site, `Unknown reference '${text}': no enclosing iteration is named '${name}' by as:`)
  if (sigil === '@' && !name && !scope.flow) fail(site, `Invalid reference '${text}': nothing flows into this call. The first call of a phase or chain receives nothing; name an iteration with as: to reach its item`)
}

// Declares an iteration name; names are Query-scoped, so each is used once.
function declareBinding(site, name, query) {
  if (name === 'err') fail(site, '\'err\' is reserved for the error in onError (@err); name the iteration something else')
  if (query.bindingNames.has(name)) fail(site, `Binding name '${name}' is used more than once. Binding names are Query-scoped.`)
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
function compileSteps(value, siteOf, scope, hasInput, query) {
  const chain = isChain(value)
  const descriptors = chain ? value : [value]
  return descriptors.map((descriptor, i) =>
    compileCall(descriptor, siteOf(i, chain), {...scope, flow: i > 0 || (hasInput && !chain)}, query))
}

// A position: the field's call or chain, compiled in the owner's scope plus
// its iteration name. A single call receives its input as `@`; a chain's
// first step receives nothing, so a chain reaches its input by name only.
// onError's input is the error, not an iteration: `as:` never names it, and
// it is reached as @err (with one more @ for each onError it is inside).
function compilePosition(owner, field, letter, value, scope, as, returns, query) {
  const iteration = field === 'onError' ? undefined : as

  // an object in a service position is a template of its input
  const descriptor = isPlainObject(value) ? ['GET [util]/template', value] : value
  const chain = isChain(descriptor)
  if (chain && field !== 'onError' && !iteration) {
    fail(owner, `The chain in '${field}' can't reach its input. Name it with as: and reference it as @name`)
  }

  const inner = {
    bindings: iteration ? [...scope.bindings, iteration] : scope.bindings,
    errors: field === 'onError' ? scope.errors + 1 : scope.errors
  }
  const siteOf = sitesAt(`${owner.address}${letter}`, fieldPathOf(owner, field))
  return {
    field,
    chain,
    as: iteration,
    returns: returns && parseSchemaWithErrorContext('service', `${field} returns`, returns),
    steps: compileSteps(descriptor, siteOf, inner, true, query)
  }
}

// The fields of a call that take a service: service-typed arguments and onError.
function positionFields(site, args, argtypes, key) {
  const fields = Object.keys(args).filter(k => argtypes[k]?.type === 'service' || k === 'onError')
  for (const field of fields) {
    if (typeof args[field] === 'function') {
      fail(site, `Raw JavaScript functions are not supported in MicroQL. Use service descriptors instead of raw functions for argument '${field}' in ${key}. Example: ['GET [service]/resource', {arg: '@'}]`)
    }
  }
  // a reference or literal in a service-typed argument stays data
  return fields.filter(k => k === 'onError' || Array.isArray(args[k]) || isPlainObject(args[k])).sort()
}

// Compiles one service descriptor at a site, in a scope.
function compileCall(descriptor, site, scope, query) {
  if (!Array.isArray(descriptor)) fail(site, `Invalid service descriptor. Expected ['METHOD [service]/resource', {...}] format. Got: ${JSON.stringify(descriptor)}`)
  const parsed = parseDescriptor(site, descriptor)
  const {service, action} = lookupAction(site, query.services, parsed.parts)
  const argtypes = action._argtypes || {}
  if (!isPlainObject(parsed.args)) fail(site, `Arguments for ${parsed.key} must be an object`)

  const call = {
    address: site.address,
    path: site.path,
    argsPath: [...site.path, parsed.hasTarget ? 2 : 1],
    targetField: parsed.hasTarget ? targetField(site, argtypes, parsed.key) : undefined,
    iterates: Object.keys(argtypes).find(k => argtypes[k].argOrder === 0),
    key: parsed.key,
    parts: parsed.parts,
    service,
    action,
    noTimeout: action._noTimeout || false,
    ownTimeout: parsed.args.timeout !== undefined
  }

  const args = parsed.hasTarget ? {...parsed.args, [call.targetField]: parsed.target} : parsed.args
  const {as} = args
  const fields = positionFields(site, args, argtypes, parsed.key)
  if (as !== undefined) {
    if (!fields.some(f => f !== 'onError')) fail(site, `as: names an iteration, but ${parsed.key} takes no service`)
    declareBinding(site, as, query)
  }

  const settingsFields = Object.keys(argtypes).filter(k => argtypes[k]?.type === 'settings')
  call.args = _.omit(args, [...RESERVE_ARGS, 'as', ...fields, ...settingsFields])
  call.settingsArgs = Object.fromEntries(settingsFields.map(field => [field, args[field] ?? {}]))
  call.settings = compileSettings(parsed.parts.service, args, argtypes, query.settings)
  call.checks = _.pick(args, ['precheck', 'postcheck'])
  call.validators = compileValidators(args, action._validators || {})
  call.dependencies = checkReferences(site, {...call.args, ...call.settingsArgs}, scope, query)
  call.positions = Object.fromEntries(fields.map((field, i) =>
    [field, compilePosition(call, field, LETTERS[i], args[field], scope, as, argtypes[field]?.returns, query)]))

  for (const position of Object.values(call.positions)) {
    for (const step of position.steps) call.dependencies = call.dependencies.union(step.dependencies)
  }
  query.calls.push(call)
  return call
}

function compilePhase(name, descriptor, query) {
  if (ROOT_NODES.includes(name)) throw new Error(`[$${name}] '${name}' is reserved and can't name a phase`)
  const steps = compileSteps(descriptor, sitesAt(`$${name}.@`, ['phases', name]), {bindings: [], errors: 0}, false, query)
  return {
    name,
    steps,
    dependencies: steps.reduce((deps, step) => deps.union(step.dependencies), new Set())
  }
}

// The global onError handler receives the error that ended the Run.
function compileGlobalOnError(value, query) {
  const siteOf = sitesAt('settings.onError.@', ['settings', 'onError'])
  return {field: 'onError', chain: isChain(value), steps: compileSteps(value, siteOf, {bindings: [], errors: 1}, true, query)}
}

// `select` names what the Query returns: one reference, or a list of phases.
function compileSelect(select, query) {
  if (select === undefined) return undefined
  const site = {address: 'select'}
  const refs = [].concat(select).map(text => {
    const ref = isReference(text) ? parseWithSite(site, text) : fail(site, `select takes references: '$${text}'`)
    if (ref.sigil !== '$' || !query.nodeNames.has(ref.name)) fail(site, `Unknown reference '${text}' in select`)
    return ref
  })
  return Array.isArray(select) ? refs : refs[0]
}

/**
 * Compile a Query into its tree of phases and calls.
 * @returns {Object} {phases, calls, given, trigger, select, settings, services, runtime, warnings}
 */
export function compile(config) {
  const {phases = {}, given, trigger, settings = {}} = config
  const services = _.defaults({}, config.services, {util})

  const query = {
    services,
    settings,
    nodeNames: new Set([...Object.keys(phases), ...(given !== undefined ? ['given'] : []), ...(trigger ? ['trigger'] : [])]),
    bindingNames: new Set(),
    warnings: [],
    calls: []
  }

  const compiledPhases = _.mapValues(phases, (descriptor, name) => compilePhase(name, descriptor, query))

  return {
    phases: compiledPhases,
    calls: query.calls,
    given,
    trigger,
    select: compileSelect(config.select, query),
    settings: {
      ...settings,
      onError: settings.onError ? compileGlobalOnError(settings.onError, query) : undefined
    },
    services,
    runtime: config.runtime,
    warnings: query.warnings
  }
}

export default compile
