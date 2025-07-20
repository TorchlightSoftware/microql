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
function createExecutionPlan(queryTree) {
  const {queries, given} = queryTree
  const planStages = []
  const executedQueries = new Set()

  // Add given data as pre-resolved
  if (given) executedQueries.add('given')

  // Handle pre-completed queries (from snapshot loading)
  for (const [queryName, queryTree] of Object.entries(queries)) {
    if (queryTree.completed) {
      executedQueries.add(queryName)
    }
  }

  // Create stages by finding queries ready to execute
  while (executedQueries.size < Object.keys(queries).length + (given ? 1 : 0)) {
    const readyQueries = Object.entries(queries).filter(([queryName, queryTree]) =>
      !executedQueries.has(queryName) &&
      queryTree.dependencies.difference(executedQueries).size === 0)

    if (readyQueries.length === 0) {
      const remaining = Object.keys(queries).filter(q => !executedQueries.has(q))
      throw new Error(`Circular dependency detected at compile time: ${remaining.join(', ')}`)
    }

    const stage = readyQueries.map(([queryName, queryTree]) => {
      executedQueries.add(queryName)
      return queryTree
    })

    planStages.push(stage)
  }

  return planStages
}

/**
 * Load snapshot data and inject it into execution plan
 */
async function loadSnapshot(snapshotPath, queryTree) {
  if (!snapshotPath || !(await fs.pathExists(snapshotPath))) {
    return
  }

  try {
    const snapshotData = JSON.parse(await fs.readFile(snapshotPath, 'utf8'))

    if (!snapshotData.results) {
      return
    }

    // Add snapshotRestoreTimestamp query to the execution plan
    queryTree.queries.snapshotRestoreTimestamp = {
      type: 'literal',
      value: snapshotData.timestamp,
      dependencies: new Set(),
      completed: true
    }

    // Pre-load snapshot results for matching queries
    for (const [queryName, result] of Object.entries(snapshotData.results)) {
      if (queryTree.queries[queryName]) {
        // Preserve the original query structure but mark as completed with value
        queryTree.queries[queryName].value = result
        queryTree.queries[queryName].completed = true
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
  // Phase 1: Compile queries into queryTree
  const queryTree = compile(config)

  // Phase 2: Load snapshot if specified
  if (config.snapshot) {
    await loadSnapshot(config.snapshot, queryTree)
  }

  // Phase 3: Create execution plan and detect circular dependencies
  const plan = createExecutionPlan(queryTree)

  // Phase 4: Execute the plan
  const results = await execute(plan, queryTree)

  // Phase 5: Apply result selection
  return applySelection(results, config.select)
}

export default query
