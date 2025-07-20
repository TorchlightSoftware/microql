/**
 * @fileoverview MicroQL Query Compiler
 *
 * Compiles query configurations into queryTree
 * Handles service validation and dependency extraction.
 */

import _ from 'lodash'
import lodashDeep from 'lodash-deep'
_.mixin(lodashDeep)

import {DEP_REGEX, METHOD_REGEX, RESERVE_ARGS} from './common.js'
import applyWrappers from './wrappers.js'

// Detects if a descriptor is a chain (nested arrays)
const isChain = (descriptor) => {
  return Array.isArray(descriptor) &&
         descriptor.length > 0 &&
         Array.isArray(descriptor[0])
}

// Detects if a descriptor uses method syntax
const hasMethodSyntax = (descriptor) => {
  return Array.isArray(descriptor) &&
         descriptor.length >= 2 &&
         typeof descriptor[1] === 'string' &&
         METHOD_REGEX.test(descriptor[1])
}

// Transforms method syntax to standard form
const transformMethodSyntax = (descriptor) => {
  if (!hasMethodSyntax(descriptor)) {
    return descriptor
  }

  const [target, serviceMethod, args = {}] = descriptor
  const match = serviceMethod.match(METHOD_REGEX)
  const [, serviceName, method] = match

  // Transform to standard form: [service, method, { ...args, on: target }]
  const serviceCall = [serviceName, method, {...args, on: target}]

  //console.log('transformMethodSyntax transformed:', descriptor, 'to:', serviceCall)
  return serviceCall
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

// settings are merged from query level settings and service level settings
// they are placed in their own `settings` key on the compiled service definition
const compileSettings = (queryName, args, argtypes, config) => {
  const reserveArgs = _.pick(args, RESERVE_ARGS)
  const settingsArgs = _.pickBy(args, (a, k) => argtypes[k] === 'settings') // get args with their argtypes set to 'settings'
  const settings = _.defaults({}, reserveArgs, ...Object.values(settingsArgs), config.settings)

  // compile onError if we have it
  if (settings.onError) {
    settings.onError = compileFunctionOrChain(queryName, settings.onError, config)
  }

  return settings
}

// any time we expect a function, it could instead be a chain
const compileFunctionOrChain = (queryName, value, config) => {
  const makeFn = (descriptor) => compileServiceFunction(queryName, descriptor, config).service

  // is it a chain?
  if (_.every(value, v => Array.isArray(v))) {
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

    // compile object to function template
    if (argtypes[key] === 'function' && typeof value === 'object' && !Array.isArray(value)) {
      const fn = compileServiceFunction(queryName, ['util', 'template', value], config)
      compiled[key] = fn.service

    // compile service to function
    } else if (argtypes[key] === 'function' && Array.isArray(value)) {
      compiled[key] = compileFunctionOrChain(queryName, value, config)

    } else if (RESERVE_ARGS.includes(key)) {
      // exclude reserve args

    } else {
      compiled[key] = value
    }
  }

  for (const [key, type] of Object.entries(argtypes)) {
    // inject settings if requested
    if (type === 'settings') {
      compiled[key] = _.defaults(args[key], settings)
    }
  }

  return compiled
}

// turn a descriptor like ['@', 'util:print', {color: 'green'}] into [a compiled function, recursive dependencies]
function compileServiceFunction(queryName, descriptor, config) {
  const [serviceName, action, args] = transformMethodSyntax(descriptor)

  // Validate service exists and has the required method
  if (!config.services[serviceName]) {
    throw new Error(`Service '${serviceName}' not found`)
  }

  if (typeof config.services[serviceName] === 'object') {
    if (!config.services[serviceName][action] || typeof config.services[serviceName][action] !== 'function') {
      throw new Error(`Method '${action}' not found on service '${serviceName}'`)
    }
  } else {
    throw new Error(`Service '${serviceName}' must be an object with methods in the form: async (args) => result`)
  }
  const argtypes = config.services[serviceName][action]._argtypes || {}
  const settings = compileSettings(queryName, args, argtypes, config)
  const compiledArgs = compileArgs(queryName, serviceName, args, argtypes, config, settings)

  // Compile function arguments based on _argtypes
  const serviceDef = {
    type: 'service',
    queryName,
    serviceName,
    action,
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
  const {services, queries, given, debug} = config

  // Build tree for each query
  const queryTree = {}

  for (const [queryName, descriptor] of Object.entries(queries)) {
    queryTree[queryName] = compileDescriptor(queryName, descriptor, config)
  }

  return {
    queries: queryTree,
    given,
    services,
    debug
  }
}

export default compile
