/**
 * @fileoverview MicroQL Query Engine - Main Entry Point
 *
 * High-level orchestration of query compilation and execution with clean
 * separation of concerns.
 */

import _ from 'lodash'
import { compile } from './compile.js'
import { execute } from './execute.js'

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
  const { services, given, query: queries, select, debug } = config

  // Phase 1: Compile queries into execution plan
  const compilationConfig = {
    services,
    queries,
    given,
    debug
  }
  const executionPlan = compile(compilationConfig)

  // Phase 2: Execute the plan
  const results = await execute(executionPlan)

  // Phase 3: Apply result selection
  return applySelection(results, select)
}

export default query
