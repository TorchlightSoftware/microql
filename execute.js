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

async function executePlan(plan, results, contextStack, usedServices) {
  // Execute a service
  if (plan.type === 'service') {
    // Track service usage
    usedServices.add(plan.serviceName)
    return plan.service(results, contextStack)

  // Execute each chain step, storing result in contextStack
  } else if (plan.type === 'chain') {

    // add a blank contextStack as a placeholder for the first chain step
    contextStack = contextStack.extend(null)

    for (const step of plan.steps) {
      //const {queryName, serviceName, action} = step
      //console.log(`[${queryName} - ${serviceName}:${action}] EXECUTE provide stack:\n`, contextStack.stack)

      // Track service usage for chain steps
      usedServices.add(step.serviceName)
      const result = await step.service(results, contextStack)
      contextStack.setCurrent(result)
    }

    return contextStack.getCurrent()
  }

}

// Call tearDown on used services
async function callTearDown(services, usedServices) {
  for (const serviceName of usedServices) {
    const service = services[serviceName]
    if (service && typeof service.tearDown === 'function') {
      try {
        await service.tearDown()
      } catch (error) {
        // Log tearDown errors but don't throw them
        console.error(`Error in ${serviceName}.tearDown():`, error.message)
      }
    }
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
  const {queries, given, services} = plan

  const results = {}
  const usedServices = new Set()
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

  // Handle pre-completed queries (from snapshot loading)
  for (const [queryName, queryPlan] of Object.entries(queries)) {
    if (queryPlan.completed && queryPlan.value !== undefined) {
      results[queryName] = queryPlan.value
      executedQueries.add(queryName)
    }
  }

  try {
    // Execute queries in dependency order
    while (executedQueries.size < queryCount) {
      let previouslyCompleted = executedQueries.size

      for (const [queryName, queryPlan] of Object.entries(queries)) {
        if (alreadyExecuted(queryName) || !readyToExecute(queryPlan)) continue

        results[queryName] = await executePlan(queryPlan, results, new ContextStack(), usedServices)
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
  } finally {
    // Call tearDown on used services
    await callTearDown(services, usedServices)
  }
}

export default execute
