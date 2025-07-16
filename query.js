import _ from 'lodash'
import lodashDeep from 'lodash-deep'
_.mixin(lodashDeep)

import torch from 'torch'
import retrieve from './retrieve.js'

const DEP_REGEX = /\$\.(\w+)/

// this runs at 'compile time' and determines dependencies for async.auto
const getDeps = (args) => {
  const deps = []
  _.deepMapValues(args, (value) => {
    let m = (typeof value === 'string') && value.match(DEP_REGEX)
    if (m) deps.push(m[1])
  })
  return _.uniq(deps)
}

// this runs at 'run time' for each query and interpolates dependencies into the query arguments
const mergeArgs = (args, source) => {
  return _.deepMapValues(args, (value, path) => {
    let m = (typeof value === 'string') && value.match(DEP_REGEX)
    return m ? retrieve(value, source) : value
  })
}

async function query(config) {
  const {services, input, given, query: queries, select} = config
  
  // Handle both 'input' and 'given' for input data
  const inputData = input || given
  const debug = (...args) => config.debug ? torch.gray(...args) : null
  const debugAlt = (...args) => config.debug ? torch.white(...args) : null

  // Build execution plan
  const executionPlan = {}
  const results = {}
  
  // Add input as pre-resolved result
  if (inputData) {
    results.input = inputData
    // Also add as 'given' for compatibility
    results.given = inputData
  }

  // Process each query
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
      dependencies: deps,
      executed: false
    }
  }

  // Execute queries in dependency order
  const executedQueries = new Set()
  
  while (executedQueries.size < Object.keys(executionPlan).length) {
    let progress = false
    
    for (const [queryName, queryPlan] of Object.entries(executionPlan)) {
      if (executedQueries.has(queryName)) continue
      
      // Check if all dependencies are satisfied
      const depsReady = queryPlan.dependencies.every(dep => 
        dep === 'input' || dep === 'given' ? true : executedQueries.has(dep)
      )
      
      if (depsReady) {
        // Execute this query
        try {
          const finalArgs = mergeArgs(queryPlan.args, results)
          debug('calling:', {serviceName: queryPlan.serviceName, action: queryPlan.action, finalArgs})
          
          const service = services[queryPlan.serviceName]
          const method = service[queryPlan.action]
          
          // Call service method (supports both sync and async)
          const result = await method(finalArgs)
          
          results[queryName] = result
          executedQueries.add(queryName)
          progress = true
          
          debugAlt('returned:', {serviceName: queryPlan.serviceName, action: queryPlan.action, result})
        } catch (error) {
          throw new Error(`Query '${queryName}' failed: ${error.message}`)
        }
      }
    }
    
    if (!progress) {
      const remaining = Object.keys(executionPlan).filter(q => !executedQueries.has(q))
      throw new Error(`Circular dependency or missing dependencies for queries: ${remaining.join(', ')}`)
    }
  }

  // Apply result selection
  if (Array.isArray(select)) {
    return _.pick(results, select)
  } else if (typeof select === 'string') {
    return results[select]
  }

  return results
}

export default query
export { mergeArgs }
