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
 *   Position  a field that holds a call or a chain of calls: one the
 *             operation's declaration tags `call`, or `onError`.
 *   Address   a call's Service Call Address (`$listings.@1a2`): calls are
 *             numbered, positions lettered in sorted key order, alternating.
 */

import {parseServiceKey} from '@tlsft/service-key'

import {RESERVE_ARGS, VALIDATION_NAMES, isPlainObject, mapValues, pick, omit, omitIn, getIn, setIn, defaults} from './common.js'
import {declarationOf} from './declaration.js'
import {isReference, parseReference} from './reference.js'
import {parseSchema} from './validation.js'
import {fieldPathOf} from './addresses.js'
import util from './services/util.js'

// Nodes resolved before the first phase runs; never valid phase names.
const ROOT_NODES = ['given', 'trigger']

// The retired `service:action` form, recognised only to explain its replacement.
const RETIRED_KEY = /^(\w+):(\w+)$/

const LETTERS = 'abcdefghijklmnopqrstuvwxyz'

// A compile-time error: its message names the address, and the error carries
// the address and a code (see docs/runtime-integration.md § Errors).
const fail = (site, code, message) => {
  throw Object.assign(new Error(`[${site.address}] ${message}`), {address: site.address, code})
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
    if (retired) fail(site, 'retired-key', `Service key '${retired[0]}' uses the retired service:action form. Use '[${retired[1]}]/${retired[2]}'`)
    fail(site, 'invalid-descriptor', `Invalid service descriptor. Expected ['[VERB] [service]/resource', {...}] format. Got: ${JSON.stringify(descriptor)}`)
  }
  return {key, parts, args, hasTarget: false}
}

const isService = (service) => typeof service?.lookup === 'function' && typeof service.operations === 'function'

// The operation answering a key's parts: the service by name, then what its
// lookup answers. A lookup answers nothing for a resource it lacks, and
// throws for a key it refuses, such as a verb it doesn't take.
function lookupOperation(site, services, parts) {
  const service = services[parts.service]
  if (!service) fail(site, 'unknown-service', `Service '${parts.service}' not found`)
  if (!isService(service)) {
    fail(site, 'not-a-service', `Service '${parts.service}' must provide lookup(parts) and operations(). A service written as a table of operations gets both from serviceFromTable`)
  }
  let operation
  try {
    operation = service.lookup(parts)
  } catch (error) {
    fail(site, 'refused-key', error.message)
  }
  if (!operation) fail(site, 'unknown-resource', `Resource '${parts.resource}' not found on service '${parts.service}'`)
  return {service, operation}
}

// An operation's declaration, with any error in it reported at the call.
function declarationAt(site, operation, key) {
  try {
    return declarationOf(operation)
  } catch (error) {
    fail(site, 'malformed-declaration', `The declaration of ${key} is malformed: ${error.message}`)
  }
}

// Method syntax puts its target in the field the declaration tags target.
function targetField(site, declaration, key) {
  if (!declaration.target) fail(site, 'no-target', `Method syntax was used for ${key} but it declares no target field`)
  return declaration.target.path
}

// A shorthand schema as zod, with an error in it reported at its site.
function parseSchemaAt(site, designation, order, schema) {
  try {
    return parseSchema(schema)
  } catch (error) {
    fail(site, 'malformed-schema', `${designation} ${order} schema parse error:\n${error.message}`)
  }
}

// A call's Service Call Validations (from its fields) woven with its Service
// Schema Validations (the operation's declared schemas), parsed, by order.
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
  const ownSettings = omit(pick(args, RESERVE_ARGS), ['onError', 'precheck', 'postcheck'])
  const globalSettings = omit(querySettings, ['onError', 'ignoreErrors', 'cache', 'rateLimit', 'concurrency'])
  const settings = defaults(ownSettings, ...Object.values(settingsArgs), globalSettings)
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
    fail(site, 'invalid-reference', error.message)
  }
}

function checkReference(site, {sigil, name, depth}, text, scope, query) {
  if (sigil === '$' && !query.nodeNames.has(name)) fail(site, 'unknown-reference', `Unknown reference '${text}': no phase or node named '${name}'`)
  if (depth > scope.errors) {
    fail(site, 'unknown-reference', scope.errors ? `Unknown reference '${text}': it is inside only ${scope.errors} onError` : `Unknown reference '${text}': no enclosing onError`)
  }
  if (sigil === '@' && name && !depth && !scope.bindings.includes(name)) fail(site, 'unknown-reference', `Unknown reference '${text}': no enclosing iteration is named '${name}' by as:`)
  if (sigil === '@' && !name && !scope.flow) fail(site, 'invalid-reference', `Invalid reference '${text}': nothing flows into this call. The first call of a phase or chain receives nothing; name an iteration with as: to reach its item`)
}

// Declares an iteration name; names are Query-scoped, so each is used once.
function declareBinding(site, name, query) {
  if (name === 'err') fail(site, 'reserved-name', '\'err\' is reserved for the error in onError (@err); name the iteration something else')
  if (query.bindingNames.has(name)) fail(site, 'duplicate-binding', `Binding name '${name}' is used more than once. Binding names are Query-scoped.`)
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
function compilePosition(owner, field, letter, value, scope, as, query) {
  const iteration = field === 'onError' ? undefined : as

  // an object in a service position is a template of its input
  const descriptor = isPlainObject(value) ? ['[util]/template', value] : value
  const chain = isChain(descriptor)
  if (chain && field !== 'onError' && !iteration) {
    fail(owner, 'unreachable-input', `The chain in '${field}' can't reach its input. Name it with as: and reference it as @name`)
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
    steps: compileSteps(descriptor, siteOf, inner, true, query)
  }
}

// The fields of a call that hold calls, by path: those its declaration tags
// call, and onError.
function positionFields(site, args, declaration, key) {
  const fields = [...declaration.calls, {path: 'onError', segments: ['onError']}]
    .filter(({segments}) => getIn(args, segments) !== undefined)
  for (const {path, segments} of fields) {
    if (typeof getIn(args, segments) === 'function') {
      fail(site, 'raw-function', `Raw JavaScript functions are not supported in MicroQL. Use service descriptors instead of raw functions for argument '${path}' in ${key}. Example: ['[service]/resource', {arg: '@'}]`)
    }
  }
  // a reference or literal in a call field stays data
  return fields
    .filter(({path, segments}) => path === 'onError' || Array.isArray(getIn(args, segments)) || isPlainObject(getIn(args, segments)))
    .sort((a, b) => a.path.localeCompare(b.path))
}

// Compiles one service descriptor at a site, in a scope.
function compileCall(descriptor, site, scope, query) {
  if (!Array.isArray(descriptor)) fail(site, 'invalid-descriptor', `Invalid service descriptor. Expected ['[VERB] [service]/resource', {...}] format. Got: ${JSON.stringify(descriptor)}`)
  const parsed = parseDescriptor(site, descriptor)
  const {service, operation} = lookupOperation(site, query.services, parsed.parts)
  const declaration = declarationAt(site, operation, parsed.key)
  if (!isPlainObject(parsed.args)) fail(site, 'invalid-descriptor', `Arguments for ${parsed.key} must be an object`)

  const call = {
    address: site.address,
    path: site.path,
    argsPath: [...site.path, parsed.hasTarget ? 2 : 1],
    targetField: parsed.hasTarget ? targetField(site, declaration, parsed.key) : undefined,
    key: parsed.key,
    parts: parsed.parts,
    service,
    operation,
    declaration,
    ownTimeout: parsed.args.timeout !== undefined
  }

  const args = parsed.hasTarget ? setIn(parsed.args, declaration.target.segments, parsed.target) : parsed.args
  const {as} = args
  const fields = positionFields(site, args, declaration, parsed.key)
  if (as !== undefined) {
    if (!fields.some(f => f.path !== 'onError')) fail(site, 'misplaced-as', `as: names an iteration, but ${parsed.key} takes no call`)
    declareBinding(site, as, query)
  }

  const held = [...fields, ...declaration.settings]
  call.args = omit(held.reduce((rest, {segments}) => omitIn(rest, segments), args), [...RESERVE_ARGS, 'as'])
  call.settingsArgs = Object.fromEntries(declaration.settings.map(({path, segments}) => [path, getIn(args, segments) ?? {}]))
  call.settings = compileSettings(parsed.parts.service, args, call.settingsArgs, query.settings)
  call.checks = pick(args, ['precheck', 'postcheck'])
  call.validators = compileValidators(site, args, declaration)
  call.dependencies = checkReferences(site, {...call.args, ...call.settingsArgs}, scope, query)
  call.positions = Object.fromEntries(fields.map(({path, segments}, i) =>
    [path, compilePosition(call, path, LETTERS[i], getIn(args, segments), scope, as, query)]))

  for (const position of Object.values(call.positions)) {
    for (const step of position.steps) call.dependencies = call.dependencies.union(step.dependencies)
  }
  query.calls.push(call)
  return call
}

function compilePhase(name, descriptor, query) {
  if (ROOT_NODES.includes(name)) fail({address: `$${name}`}, 'reserved-name', `'${name}' is reserved and can't name a phase`)
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
    const ref = isReference(text) ? parseWithSite(site, text) : fail(site, 'invalid-select', `select takes references: '$${text}'`)
    if (ref.sigil !== '$' || !query.nodeNames.has(ref.name)) fail(site, 'unknown-reference', `Unknown reference '${text}' in select`)
    return ref
  })
  return Array.isArray(select) ? refs : refs[0]
}

/**
 * Compile a Query into its tree of phases and calls.
 * @returns {Object} {phases, calls, given, trigger, triggerSchema, select, settings, services, runtime, warnings}
 */
export function compile(config) {
  const {phases = {}, given, trigger, settings = {}} = config
  const services = defaults(config.services, {util})

  const query = {
    services,
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
      onError: settings.onError ? compileGlobalOnError(settings.onError, query) : undefined
    },
    services,
    runtime: config.runtime,
    warnings: query.warnings
  }
}

export default compile
