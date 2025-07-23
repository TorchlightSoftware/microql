/**
 * @fileoverview MicroQL Query Compiler
 *
 * Compiles query configurations into queryTree
 * Handles service validation and dependency extraction.
 */

import _ from 'lodash'
import lodashDeep from 'lodash-deep'
_.mixin(lodashDeep)

import {DEP_REGEX, SERVICE_REGEX, RESERVE_ARGS} from './common.js'
import applyWrappers from './wrappers.js'

// Detects if a descriptor is a chain (nested arrays)
const isChain = (descriptor) => {
  return Array.isArray(descriptor) &&
    descriptor.length > 0 &&
    _.every(descriptor, d => Array.isArray(d))
}

// Detects if a descriptor uses method syntax: ['target', 'service:action', args]
const hasMethodSyntax = (descriptor) => {
  return Array.isArray(descriptor) &&
         descriptor.length >= 2 &&
         typeof descriptor[1] === 'string' &&
         SERVICE_REGEX.test(descriptor[1])
}

// Transforms method syntax ['target', 'service:action', args] to standard service call ['service:action', {on: target, ...args}]
const parseServiceDescriptor = (descriptor) => {
  // check for method descriptor
  if (hasMethodSyntax(descriptor)) {
    const [arg0, serviceMethod, args = {}] = descriptor
    const [__, serviceName, action] = serviceMethod.match(SERVICE_REGEX)
    return [serviceName, action, args, arg0]

  } else {
    // assume normal service descriptor
    const [serviceAction, args = {}] = descriptor
    const match = serviceAction?.match(SERVICE_REGEX)
    if (!match) {
      throw new Error(`Invalid service descriptor. Expected ['service:action', {...}] format. Got: ${JSON.stringify(descriptor)}`)
    }
    const [, serviceName, action] = match
    return [serviceName, action, args]
  }
}

// Extracts dependencies from query arguments
const getDeps = (args) => {
  const deps = new Set()
  _.deepMapValues(args, (value) => {
    let m = (typeof value === 'string') && value.match(DEP_REGEX)
    if (m) deps.add(m[1])
  })
  return deps
}

const compileValidators = (args, validators) => {
  return {
    precheck: [args.precheck, validators.precheck].filter(Boolean),
    postcheck: [validators.postcheck, args.postcheck].filter(Boolean)
  }
}

// settings are merged from query level settings and service level settings
// they are placed in their own `settings` key on the compiled service definition
const compileSettings = (queryName, args, argtypes, config) => {
  const reserveArgs = _.pick(args, RESERVE_ARGS)
  const settingsArgs = _.pickBy(args, (a, k) => argtypes[k]?.type === 'settings') // get args with their argtypes set to 'settings'

  // Only exclude global-level error handling from service settings merging
  const configSettingsForServices = config.settings ? _.omit(config.settings, ['onError', 'ignoreErrors']) : {}
  const settings = _.defaults({}, reserveArgs, ...Object.values(settingsArgs), configSettingsForServices)

  // compile onError if we have it
  if (settings.onError && Array.isArray(settings.onError) && settings.onError.length > 0) {
    settings.onError = compileServiceOrChain(queryName, settings.onError, config)
  }

  return settings
}

// any time we expect a service, it could instead be a chain
const compileServiceOrChain = (queryName, value, config) => {
  const makeFn = (descriptor) => compileServiceFunction(queryName, descriptor, config).service

  // is it a chain?
  if (isChain(value)) {
    return value.map(makeFn)

    // or a single service call?
  } else {
    return makeFn(value)
  }
}

// Compile arguments based on argtypes metadata
const compileArgs = (queryName, serviceName, args, argtypes, config, settings) => {
  const compiled = {}

  for (const [key, value] of Object.entries(args)) {

    // compile object to service template
    if (argtypes[key]?.type === 'service' && typeof value === 'object' && !Array.isArray(value)) {
      const fn = compileServiceFunction(queryName, ['util:template', value], config)
      compiled[key] = fn.service

    // compile service descriptor
    } else if (argtypes[key]?.type === 'service' && Array.isArray(value)) {
      compiled[key] = compileServiceOrChain(queryName, value, config)

    // reject raw JavaScript functions
    } else if (argtypes[key]?.type === 'service' && typeof value === 'function') {
      throw new Error(`Raw JavaScript functions are not supported in MicroQL. Use service descriptors instead of raw functions for argument '${key}' in ${serviceName}:${queryName}. Example: ['serviceName:methodName', {arg: '@'}]`)

    } else if (RESERVE_ARGS.includes(key)) {
      // exclude reserve args

    } else {
      compiled[key] = value
    }
  }

  for (const [key, type] of Object.entries(argtypes)) {
    // inject settings if requested
    if (type?.type === 'settings') {
      compiled[key] = _.defaults(args[key], settings)
    }
  }

  return compiled
}

// check to see if the service has an argOrder: 0 defined
// and merge arg0 if we have it
function mergeArgs(args, arg0, argtypes = {}, serviceName, action) {
  if (!arg0) {
    return
  }
  const [argOrder0] = Object.entries(argtypes).find(([, typeinfo]) => typeinfo.argOrder === 0) || []
  if (!argOrder0)
    throw new Error(`Method syntax was used for ${serviceName}:${action} but no {argOrder: 0} was defined.`)
  args[argOrder0] = arg0
}

// Compiles a service descriptor like ['util:print', {color: 'green'}] or ['@', 'util:print', {color: 'green'}]
// into [a compiled function, recursive dependencies]
function compileServiceFunction(queryName, descriptor, config) {
  const [serviceName, action, args, arg0] = parseServiceDescriptor(descriptor)

  const service = config.services[serviceName]
  // Validate service exists and has the required method
  if (!service) {
    throw new Error(`Service '${serviceName}' not found`)
  }

  const serviceCall = service[action]
  if (typeof service === 'object') {
    if (!serviceCall || typeof serviceCall !== 'function') {
      throw new Error(`Method '${action}' not found on service '${serviceName}'`)
    }
  } else {
    throw new Error(`Service '${serviceName}' must be an object with methods in the form: async (args) => result`)
  }
  const argtypes = serviceCall._argtypes || {}
  mergeArgs(args, arg0, argtypes, serviceName, action)

  const settings = compileSettings(queryName, args, argtypes, config)
  const compiledArgs = compileArgs(queryName, serviceName, args, argtypes, config, settings)
  const validators = compileValidators(args, serviceCall._validators || {})

  // Compile function arguments based on _argtypes
  const serviceDef = {
    type: 'service',
    queryName,
    serviceName,
    action,
    validators,
    settings,
    args: compiledArgs,
    dependencies: getDeps(args)
  }

  // prepare the service with arg resolution, debugging, error handling, timeout, retry
  serviceDef.service = applyWrappers(serviceDef, config)

  return serviceDef
}

function compileDescriptor(queryName, descriptor, config) {
  // Handle chains - arrays of service calls
  if (isChain(descriptor)) {
    let allDeps = new Set()

    // for each step in chain, collect the service definition and the dependencies
    const chainSteps = descriptor.map((d, i) => {
      const def = compileServiceFunction(`${queryName}[${i}]`, d, config)
      allDeps = allDeps.union(def.dependencies)
      def.stepIndex = i
      delete def.dependencies
      return def
    })

    return {
      type: 'chain',
      queryName,
      steps: chainSteps,
      dependencies: allDeps
    }
  } else {
    // Handle single service call
    return compileServiceFunction(queryName, descriptor, config)
  }
}


/**
 * Compile a query configuration into a queryTree
 * @param {Object} config - Query configuration
 * @param {Object} config.services - Service objects
 * @param {Object} config.queries - Query definitions
 * @param {Object} config.given - given data
 * @param {boolean} config.debug - Debug logging flag
 * @returns {Object} Compiled queryTree
 */
export function compile(config) {
  const {services, queries, given, debug, settings = {}} = config

  // Build tree for each query (use config as-is for service compilation)
  const queryTree = {}

  for (const [queryName, descriptor] of Object.entries(queries)) {
    queryTree[queryName] = compileDescriptor(queryName, descriptor, config)
  }

  // Compile global settings separately
  const globalSettings = {...settings}
  if (settings.onError) {
    globalSettings.onError = compileServiceOrChain('global', settings.onError, config)
  }

  return {
    queries: queryTree,
    given,
    services,
    debug,
    settings: globalSettings
  }
}

export default compile
