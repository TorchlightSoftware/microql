/**
 * @fileoverview MicroQL Classic Execution Engine
 * 
 * Pure execution engine that takes a compiled execution plan and executes it.
 * Handles dependency resolution and service method invocation.
 */

import torch from 'torch'
import retrieve from './retrieve.js'
import { DEP_REGEX, _ } from './compile.js'

// Resolves arguments by interpolating dependencies into the arguments
const mergeArgs = (args, source) => {
  return _.deepMapValues(args, (value, path) => {
    let m = (typeof value === 'string') && value.match(DEP_REGEX)
    return m ? retrieve(value, source) : value
  })
}

/**
 * Execute a compiled execution plan
 * @param {Object} plan - Compiled execution plan
 * @param {Object} plan.queries - Query execution plans
 * @param {Object} plan.inputData - Input/given data
 * @param {Object} plan.services - Service objects
 * @param {boolean} plan.debug - Debug logging flag
 * @returns {Object} Execution results
 */
export async function execute(plan) {
  const { queries, inputData, services, debug } = plan
  
  const debugLog = (...args) => debug ? torch.gray(...args) : null
  const debugAlt = (...args) => debug ? torch.white(...args) : null
  
  const results = {}
  
  // Add input data as pre-resolved results
  if (inputData) {
    results.input = inputData
    results.given = inputData
  }

  // Execute queries in dependency order
  const executedQueries = new Set()
  
  while (executedQueries.size < Object.keys(queries).length) {
    let progress = false
    
    for (const [queryName, queryPlan] of Object.entries(queries)) {
      if (executedQueries.has(queryName)) continue
      
      // Check if all dependencies are satisfied
      const depsReady = queryPlan.dependencies.every(dep => 
        dep === 'input' || dep === 'given' ? true : executedQueries.has(dep)
      )
      
      if (depsReady) {
        // Execute this query
        try {
          const finalArgs = mergeArgs(queryPlan.args, results)
          debugLog('calling:', {serviceName: queryPlan.serviceName, action: queryPlan.action, finalArgs})
          
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
      const remaining = Object.keys(queries).filter(q => !executedQueries.has(q))
      throw new Error(`Circular dependency or missing dependencies for queries: ${remaining.join(', ')}`)
    }
  }

  return results
}

export { mergeArgs }