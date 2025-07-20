/**
 * @fileoverview MicroQL Query Engine - Main Entry Point
 *
 * High-level orchestration of query compilation and execution with clean
 * separation of concerns.
 */

import _ from 'lodash'
import fs from 'fs-extra'
import compile from './compile.js'
import execute from './execute.js'

/**
 * Create execution plan with stages for parallel execution
 * Detects circular dependencies at compile time
 */
function createExecutionPlan(queryAST) {
  const { queries, given } = queryAST
  const stages = []
  const executedQueries = new Set()
  
  // Add given data as pre-resolved
  if (given) executedQueries.add('given')
  
  // Handle pre-completed queries (from snapshot loading)
  for (const [queryName, queryPlan] of Object.entries(queries)) {
    if (queryPlan.completed) {
      executedQueries.add(queryName)
    }
  }
  
  // Create stages by finding queries ready to execute
  while (executedQueries.size < Object.keys(queries).length + (given ? 1 : 0)) {
    const readyQueries = Object.entries(queries).filter(([queryName, queryPlan]) =>
      !executedQueries.has(queryName) && 
      queryPlan.dependencies.difference(executedQueries).size === 0)
    
    if (readyQueries.length === 0) {
      const remaining = Object.keys(queries).filter(q => !executedQueries.has(q))
      throw new Error(`Circular dependency detected at compile time: ${remaining.join(', ')}`)
    }
    
    const stage = readyQueries.map(([queryName, queryPlan]) => {
      executedQueries.add(queryName)
      return queryPlan
    })
    
    stages.push(stage)
  }
  
  return stages
}

/**
 * Load snapshot data and inject it into execution plan
 */
async function loadSnapshot(snapshotPath, queryAST) {
  if (!snapshotPath || !(await fs.pathExists(snapshotPath))) {
    return
  }

  try {
    const snapshotData = JSON.parse(await fs.readFile(snapshotPath, 'utf8'))

    if (!snapshotData.results) {
      return
    }

    // Add snapshotRestoreTimestamp query to the execution plan
    queryAST.queries.snapshotRestoreTimestamp = {
      type: 'literal',
      value: snapshotData.timestamp,
      dependencies: new Set(),
      completed: true
    }

    // Pre-load snapshot results for matching queries
    for (const [queryName, result] of Object.entries(snapshotData.results)) {
      if (queryAST.queries[queryName]) {
        // Preserve the original query structure but mark as completed with value
        queryAST.queries[queryName].value = result
        queryAST.queries[queryName].completed = true
      }
    }
  } catch (error) {
    // Ignore snapshot loading errors - proceed with normal execution
    console.warn(`Failed to load snapshot from ${snapshotPath}:`, error.message)
  }
}

/**
 * Apply result selection to execution results
 */
function applySelection(results, select) {
  if (Array.isArray(select)) {
    return _.pick(results, select)
  } else if (typeof select === 'string') {
    return results[select]
  }
  return results
}

/**
 * Main query execution function
 * @param {Object} config - Query configuration
 * @param {Object} config.services - Service objects
 * @param {Object} config.query - Query definitions
 * @param {Object} config.given - Starting data
 * @param {string|Array} config.select - Result selection
 * @param {boolean} config.debug - Debug logging
 * @returns {*} Query results
 */
async function query(config) {
  // Phase 1: Compile queries into queryAST
  const queryAST = compile(config)

  // Phase 2: Load snapshot if specified
  if (config.snapshot) {
    await loadSnapshot(config.snapshot, queryAST)
  }

  // Phase 3: Create execution plan and detect circular dependencies
  const stages = createExecutionPlan(queryAST)

  // Phase 4: Execute the plan  
  const results = await execute({ stages, given: queryAST.given, services: queryAST.services, queries: queryAST.queries })

  // Phase 5: Apply result selection
  return applySelection(results, config.select)
}

export default query
