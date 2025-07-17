/**
 * @fileoverview MicroQL Execution Engine
 *
 * Pure execution engine that takes a compiled execution plan and executes it.
 * Handles dependency resolution and service method invocation.
 */
import _ from 'lodash'
import lodashDeep from 'lodash-deep'
_.mixin(lodashDeep)

import torch from 'torch'
import retrieve from './retrieve.js'
import { DEP_REGEX, AT_REGEX, BARE_DOLLAR_REGEX } from './compile.js'

// Resolves arguments by interpolating dependencies and @ context
const mergeArgs = (args, source, chainContext = null) => {
  const resolveValue = (value) => {
    if (typeof value !== 'string') return value

    // Handle bare $ - returns all completed queries
    if (value.match(BARE_DOLLAR_REGEX)) {
      // Return a copy of all results excluding internal keys
      const allQueries = {}
      for (const [key, val] of Object.entries(source)) {
        if (!key.startsWith('_')) {
          allQueries[key] = val
        }
      }
      return allQueries
    }

    // Handle $.path references
    let m = value.match(DEP_REGEX)
    if (m) return retrieve(value, source)

    // Handle @ references
    m = value.match(AT_REGEX)
    if (m && chainContext !== null) {
      const atPath = m[1] // e.g., '.field' from '@.field'
      if (atPath) {
        // Access nested field in chain context
        return retrieve('@' + atPath, { '@': chainContext })
      } else {
        // Return the whole chain context
        return chainContext
      }
    }

    return value
  }

  const resolved = {}

  for (const [key, value] of Object.entries(args)) {
    // Handle compiled functions
    if (value && typeof value === 'object' && value._type === 'compiled_function') {
      // Return a function that resolves the template
      resolved[key] = (item) => {
        // Create a context that includes the current item as @
        const fnContext = { ...source, '@': item }
        return _.deepMapValues(value.template, (v) => {
          if (typeof v === 'string' && v.match(AT_REGEX)) {
            const atPath = v.match(AT_REGEX)[1]
            return atPath ? retrieve('@' + atPath, fnContext) : item
          }
          return resolveValue(v)
        })
      }
    } else {
      resolved[key] = _.deepMapValues(value, resolveValue)
    }
  }

  return resolved
}

/**
 * Execute a compiled execution plan
 * @param {Object} plan - Compiled execution plan
 * @param {Object} plan.queries - Query execution plans
 * @param {Object} plan.given - given data
 * @param {Object} plan.services - Service objects
 * @param {boolean} plan.debug - Debug logging flag
 * @returns {Object} Execution results
 */
export async function execute(plan) {
  const { queries, given, services, debug } = plan

  const debugLog = (...args) => debug ? torch.gray(...args) : null
  const debugAlt = (...args) => debug ? torch.white(...args) : null

  const results = {}

  // Add given data as pre-resolved results
  if (given) {
    results.given = given
  }

  // Execute queries in dependency order
  const executedQueries = new Set()

  while (executedQueries.size < Object.keys(queries).length) {
    let progress = false

    for (const [queryName, queryPlan] of Object.entries(queries)) {
      if (executedQueries.has(queryName)) continue

      // Check if all dependencies are satisfied
      const depsReady = queryPlan.dependencies.every(dep =>
        dep === 'given' ? true : executedQueries.has(dep))

      if (depsReady) {
        // Execute this query
        try {
          let result

          if (queryPlan.type === 'chain') {
            // Execute chain steps sequentially
            let chainResult = null

            for (const step of queryPlan.steps) {
              const finalArgs = mergeArgs(step.args, results, chainResult)
              debugLog('chain step:', { serviceName: step.serviceName, action: step.action, finalArgs })

              const service = services[step.serviceName]

              if (typeof service === 'function') {
                // Function service - call with action and args
                chainResult = await service(step.action, finalArgs)
              } else {
                // Object service - call method with args
                const method = service[step.action]
                chainResult = await method(finalArgs)
              }

              debugAlt('step returned:', { serviceName: step.serviceName, action: step.action, result: chainResult })
            }

            result = chainResult
          } else {
            // Execute single service call
            const finalArgs = mergeArgs(queryPlan.args, results)
            debugLog('calling:', { serviceName: queryPlan.serviceName, action: queryPlan.action, finalArgs })

            const service = services[queryPlan.serviceName]

            if (typeof service === 'function') {
              // Function service - call with action and args
              result = await service(queryPlan.action, finalArgs)
            } else {
              // Object service - call method with args
              const method = service[queryPlan.action]
              result = await method(finalArgs)
            }

            debugAlt('returned:', { serviceName: queryPlan.serviceName, action: queryPlan.action, result })
          }

          results[queryName] = result
          executedQueries.add(queryName)
          progress = true
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
