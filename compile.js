/**
 * @fileoverview MicroQL Query Compiler
 *
 * Compiles query configurations into execution plans.
 * Handles service validation and dependency extraction.
 */

import _ from 'lodash'
import lodashDeep from 'lodash-deep'
_.mixin(lodashDeep)

import {DEP_REGEX, METHOD_REGEX} from './common.js'
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

const mergeSettingsAndReserveArgs = (config, serviceName, args, argtypes) => {
  const timeout = config.settings?.timeout?.[serviceName] || config.settings?.timeout?.default
  const defaults = _.omit(config.settings, 'timeout')
  args.timeout ??= timeout

  for (const [key, type] of Object.entries(argtypes)) {
    // inject settings
    if (type === 'settings') {
      args[key] = _.defaults(args[key], defaults)
    }
  }
}

// Compile arguments based on argtypes metadata
const compileArgs = (queryName, serviceName, args, argtypes, config) => {
  const compiled = {}

  for (const [key, value] of Object.entries(args)) {

    // compile object to function template
    if (argtypes[key] === 'function' && typeof value === 'object' && !Array.isArray(value)) {
      const fn = compileServiceFunction(queryName, ['util', 'template', value], config)
      compiled[key] = fn.service

    // compile service to function
    } else if (argtypes[key] === 'function' && Array.isArray(value)) {
      const fn = compileServiceFunction(queryName, value, config)
      compiled[key] = fn.service

    // compile onError to function
    } else if (key === 'onError' && Array.isArray(value)) {
      const fn = compileServiceFunction(queryName, value, config)
      compiled[key] = fn.service

    } else {
      compiled[key] = value
    }
  }
  mergeSettingsAndReserveArgs(config, serviceName, args, argtypes)

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

  // Compile function arguments based on _argtypes
  const argtypes = config.services[serviceName][action]._argtypes || {}
  const serviceDef = {
    type: 'service',
    queryName,
    serviceName,
    action,
    args: compileArgs(queryName, serviceName, args, argtypes, config),
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
      steps: chainSteps,
      dependencies: allDeps
    }
  } else {
    // Handle single service call
    return compileServiceFunction(queryName, descriptor, config)
  }
}


/**
 * Compile a query configuration into an execution plan
 * @param {Object} config - Query configuration
 * @param {Object} config.services - Service objects
 * @param {Object} config.queries - Query definitions
 * @param {Object} config.given - given data
 * @param {boolean} config.debug - Debug logging flag
 * @returns {Object} Compiled execution plan
 */
export function compile(config) {
  const {services, queries, given, debug} = config

  // Build execution plan for each query
  const executionPlan = {}

  for (const [queryName, descriptor] of Object.entries(queries)) {
    executionPlan[queryName] = compileDescriptor(queryName, descriptor, config)
  }

  return {
    queries: executionPlan,
    given,
    services,
    debug
  }
}

export default compile
