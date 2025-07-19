/**
 * @fileoverview MicroQL Execution Engine
 *
 * Pure execution engine that takes a compiled execution plan and executes it.
 * Handles dependency resolution and service method invocation.
 */
import _ from 'lodash'
import lodashDeep from 'lodash-deep'
_.mixin(lodashDeep)

import ContextStack from './context.js'

async function executePlan(plan, results, contextStack) {
  // Execute a service
  if (plan.type === 'service') {
    return plan.service(results, contextStack)

  // Execute each chain step, storing result in contextStack
  } else if (plan.type === 'chain') {

    // add a blank contextStack as a placeholder for the first chain step
    contextStack = contextStack.extend(null)

    for (const step of plan.steps) {
      //const {queryName, serviceName, action} = step
      //console.log(`[${queryName} - ${serviceName}:${action}] EXECUTE provide stack:\n`, contextStack.stack)

      const result = await step.service(results, contextStack)
      contextStack.setCurrent(result)
    }

    return contextStack.getCurrent()
  }

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
  const {queries, given} = plan

  const results = {}

  // Execute queries in dependency order
  const executedQueries = new Set()
  const alreadyExecuted = (queryName) => executedQueries.has(queryName)
  const readyToExecute = (plan) => plan.dependencies.difference(executedQueries).size === 0

  let queryCount = Object.keys(queries).length

  // Add given data as a pre-resolved query
  if (given) {
    results.given = given
    executedQueries.add('given')
    queryCount++
  }

  while (executedQueries.size < queryCount) {
    let previouslyCompleted = executedQueries.size

    for (const [queryName, queryPlan] of Object.entries(queries)) {
      if (alreadyExecuted(queryName) || !readyToExecute(queryPlan)) continue

      results[queryName] = await executePlan(queryPlan, results, new ContextStack())
      executedQueries.add(queryName)
    }

    // if we didn't count up at least one query each time, that's an error
    // TODO: check and see if we can detect circular references at compile time
    if (executedQueries.size <= previouslyCompleted) {
      const remaining = Object.keys(queries).filter(q => !executedQueries.has(q))
      throw new Error(`Circular dependency or missing dependencies for queries: ${remaining.join(', ')}`)
    }
  }

  return results
}

export default execute
