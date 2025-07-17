/**
 * @fileoverview MicroQL Classic Query Compiler
 * 
 * Compiles query configurations into execution plans.
 * Handles service validation and dependency extraction.
 */

// Setup lodash with deep extensions
import _ from 'lodash'
import lodashDeep from 'lodash-deep'
_.mixin(lodashDeep)

const DEP_REGEX = /\$\.(\w+)/

// Extracts dependencies from query arguments
const getDeps = (args) => {
  const deps = []
  _.deepMapValues(args, (value) => {
    let m = (typeof value === 'string') && value.match(DEP_REGEX)
    if (m) deps.push(m[1])
  })
  return _.uniq(deps)
}

/**
 * Compile a query configuration into an execution plan
 * @param {Object} config - Query configuration
 * @param {Object} config.services - Service objects
 * @param {Object} config.queries - Query definitions
 * @param {Object} config.inputData - Input/given data
 * @param {boolean} config.debug - Debug logging flag
 * @returns {Object} Compiled execution plan
 */
export function compile(config) {
  const { services, queries, inputData, debug } = config
  
  // Build execution plan for each query
  const executionPlan = {}
  
  for (const [queryName, descriptor] of Object.entries(queries)) {
    const [serviceName, action, args] = descriptor
    const deps = getDeps(args)

    // Validate service exists and has the required method
    if (!services[serviceName] || typeof services[serviceName] !== 'object') {
      throw new Error(`Service '${serviceName}' not found or not an object`)
    }
    
    if (!services[serviceName][action] || typeof services[serviceName][action] !== 'function') {
      throw new Error(`Method '${action}' not found on service '${serviceName}'`)
    }

    executionPlan[queryName] = {
      serviceName,
      action,
      args,
      dependencies: deps
    }
  }

  return {
    queries: executionPlan,
    inputData,
    services,
    debug
  }
}

export { getDeps, DEP_REGEX, _ }