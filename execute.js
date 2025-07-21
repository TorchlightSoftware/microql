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

async function executeNode(node, results, contextStack, usedServices) {
  // Execute a service
  if (node.type === 'service') {
    // Track service usage
    usedServices.add(node.serviceName)
    return node.service(results, contextStack)

  // Execute each chain step, storing result in contextStack
  } else if (node.type === 'chain') {

    // add a blank contextStack as a placeholder for the first chain step
    contextStack = contextStack.extend(null)

    for (const step of node.steps) {
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
 * Execute a prepared execution plan on the provided queryTree
 * @param {Object} plan - Staged execution plan
 * @param {Array} plan.stages - Array of stages, each containing query plans to execute in parallel
 * @param {Object} queryTree.given - given data
 * @param {Object} queryTree.services - Service objects
 * @param {Object} queryTree.queries - All query AST nodes (for snapshot handling)
 * @returns {Object} Execution results
 */
export async function execute(plan, queryTree) {
  const {given, services, queries, settings = {}} = queryTree

  const results = {}
  const usedServices = new Set()

  // Add given data
  if (given) results.given = given

  // Add pre-completed queries (from snapshot loading)
  for (const [queryName, queryNode] of Object.entries(queries)) {
    if (queryNode.completed && queryNode.value !== undefined) {
      results[queryName] = queryNode.value
    }
  }

  // Execute each stage of our execution plan
  try {
    for (const stage of plan) {
      await Promise.all(stage.map(async (queryNode) => {
        results[queryNode.queryName] = await executeNode(queryNode, results, new ContextStack(), usedServices)
      }))
    }
  } catch (error) {

    // Handle global error settings
    if (settings.onError) {
      try {
        const errorContext = new ContextStack().extend(error)
        await settings.onError(results, errorContext)
      } catch (handlerError) {
        handlerError.message = `Global onError handler failed: ${handlerError.message}`
        if (!settings.ignoreErrors) {
          throw handlerError
        }
      }
    }

    if (!settings.ignoreErrors) {
      throw error
    }

  } finally {
    // Call tearDown on used services
    await callTearDown(services, usedServices)
  }

  return results
}

export default execute
