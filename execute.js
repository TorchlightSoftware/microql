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
 * Execute a staged execution plan
 * @param {Object} plan - Staged execution plan
 * @param {Array} plan.stages - Array of stages, each containing query plans to execute in parallel
 * @param {Object} plan.given - given data
 * @param {Object} plan.services - Service objects
 * @param {Object} plan.queries - All query AST nodes (for snapshot handling)
 * @returns {Object} Execution results
 */
export async function execute(plan) {
  const {stages, given, services, queries} = plan

  const results = {}
  const usedServices = new Set()

  // Add given data
  if (given) results.given = given

  // Add pre-completed queries (from snapshot loading)
  if (queries) {
    for (const [queryName, queryPlan] of Object.entries(queries)) {
      if (queryPlan.completed && queryPlan.value !== undefined) {
        results[queryName] = queryPlan.value
      }
    }
  }

  try {
    // Execute each stage
    for (const stage of stages) {
      await Promise.all(stage.map(async (queryPlan) => {
        results[queryPlan.queryName] = await executePlan(queryPlan, results, new ContextStack(), usedServices)
      }))
    }

    return results
  } finally {
    // Call tearDown on used services
    await callTearDown(services, usedServices)
  }
}

export default execute
