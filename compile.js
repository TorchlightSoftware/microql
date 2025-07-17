/**
 * @fileoverview MicroQL Query Compiler
 * 
 * Compiles query configurations into execution plans.
 * Handles service validation and dependency extraction.
 */

// Setup lodash with deep extensions
import _ from 'lodash'
import lodashDeep from 'lodash-deep'
_.mixin(lodashDeep)

const DEP_REGEX = /\$\.(\w+)/
const METHOD_REGEX = /^(\w+):(\w+)$/
const AT_REGEX = /^@(\..+)?$/
const BARE_DOLLAR_REGEX = /^\$$/

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
  return [serviceName, method, { ...args, on: target }]
}

// Extracts dependencies from query arguments
const getDeps = (args) => {
  const deps = []
  _.deepMapValues(args, (value) => {
    let m = (typeof value === 'string') && value.match(DEP_REGEX)
    if (m) deps.push(m[1])
  })
  return _.uniq(deps)
}

// Compile arguments based on argtypes metadata
const compileArgs = (args, argtypes) => {
  const compiled = {}
  
  for (const [key, value] of Object.entries(args)) {
    if (argtypes[key] === 'function' && typeof value === 'object' && value !== null && !Array.isArray(value)) {
      // Compile object to function that returns the object with resolved values
      compiled[key] = { _type: 'compiled_function', template: value }
    } else {
      compiled[key] = value
    }
  }
  
  return compiled
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
  const { services, queries, given, debug } = config
  
  // Build execution plan for each query
  const executionPlan = {}
  
  for (const [queryName, descriptor] of Object.entries(queries)) {
    // Handle chains - arrays of service calls
    if (isChain(descriptor)) {
      const chainSteps = []
      let allDeps = new Set()
      
      for (let i = 0; i < descriptor.length; i++) {
        const step = descriptor[i]
        const transformedStep = transformMethodSyntax(step)
        const [serviceName, action, args] = transformedStep
        
        // Collect dependencies from this step
        const stepDeps = getDeps(args)
        stepDeps.forEach(dep => allDeps.add(dep))
        
        // Validate service exists and has the required method
        if (!services[serviceName]) {
          throw new Error(`Service '${serviceName}' not found`)
        }
        
        if (typeof services[serviceName] === 'function') {
          // Function service - no method validation needed
        } else if (typeof services[serviceName] === 'object') {
          // Object service - validate method exists
          if (!services[serviceName][action] || typeof services[serviceName][action] !== 'function') {
            throw new Error(`Method '${action}' not found on service '${serviceName}'`)
          }
        } else {
          throw new Error(`Service '${serviceName}' must be a function or object`)
        }
        
        // Compile function arguments based on _argtypes
        const argtypes = typeof services[serviceName] === 'function' ? {} : (services[serviceName][action]._argtypes || {})
        const compiledArgs = compileArgs(args, argtypes)
        
        chainSteps.push({
          serviceName,
          action,
          args: compiledArgs,
          stepIndex: i
        })
      }
      
      executionPlan[queryName] = {
        type: 'chain',
        steps: chainSteps,
        dependencies: Array.from(allDeps)
      }
    } else {
      // Handle single service call
      const transformedDescriptor = transformMethodSyntax(descriptor)
      const [serviceName, action, args] = transformedDescriptor
      const deps = getDeps(args)

      // Validate service exists and has the required method
      if (!services[serviceName]) {
        throw new Error(`Service '${serviceName}' not found`)
      }
      
      if (typeof services[serviceName] === 'function') {
        // Function service - no method validation needed
      } else if (typeof services[serviceName] === 'object') {
        // Object service - validate method exists
        if (!services[serviceName][action] || typeof services[serviceName][action] !== 'function') {
          throw new Error(`Method '${action}' not found on service '${serviceName}'`)
        }
      } else {
        throw new Error(`Service '${serviceName}' must be a function or object`)
      }

      // Compile function arguments based on _argtypes
      const argtypes = typeof services[serviceName] === 'function' ? {} : (services[serviceName][action]._argtypes || {})
      const compiledArgs = compileArgs(args, argtypes)
      
      executionPlan[queryName] = {
        type: 'service',
        serviceName,
        action,
        args: compiledArgs,
        dependencies: deps
      }
    }
  }

  return {
    queries: executionPlan,
    given,
    services,
    debug
  }
}

export { getDeps, DEP_REGEX, AT_REGEX, BARE_DOLLAR_REGEX, transformMethodSyntax, hasMethodSyntax, isChain }
