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
 * Load snapshot data and inject it into execution plan
 */
async function loadSnapshot(snapshotPath, executionPlan) {
  if (!snapshotPath || !(await fs.pathExists(snapshotPath))) {
    return
  }

  try {
    const snapshotData = JSON.parse(await fs.readFile(snapshotPath, 'utf8'))

    if (!snapshotData.results) {
      return
    }

    // Add snapshotRestoreTimestamp query to the execution plan
    executionPlan.queries.snapshotRestoreTimestamp = {
      type: 'literal',
      value: snapshotData.timestamp,
      dependencies: new Set(),
      completed: true
    }

    // Pre-load snapshot results for matching queries
    for (const [queryName, result] of Object.entries(snapshotData.results)) {
      if (executionPlan.queries[queryName]) {
        // Preserve the original query structure but mark as completed with value
        executionPlan.queries[queryName].value = result
        executionPlan.queries[queryName].completed = true
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
  // Phase 1: Compile queries into execution plan
  const executionPlan = compile(config)

  // Phase 2: Load snapshot if specified
  if (config.snapshot) {
    await loadSnapshot(config.snapshot, executionPlan)
  }

  // Phase 3: Execute the plan
  const results = await execute(executionPlan)

  // Phase 4: Apply result selection
  return applySelection(results, config.select)
}

export default query
