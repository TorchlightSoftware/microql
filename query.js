/**
 * @fileoverview MicroQL Query Engine - Main Entry Point
 *
 * Compiles a Query, executes it within a Run State, and returns what `select`
 * names. Platform-free: the runtime arrives as `config.runtime`.
 */

import _ from 'lodash'
import compile from './compile.js'
import execute from './execute.js'
import {resolveReference, rootScope} from './reference.js'

// What `select` names: one reference's value, or the listed phases by name.
export function applySelection(results, select) {
  if (Array.isArray(select)) return _.pick(results, select.map(ref => ref.name))
  if (select) return resolveReference(select, rootScope, results)
  return results
}

/**
 * Run a Query.
 * @param {Object} config - the Query: {phases, given, trigger, select, settings, services, runtime}
 * @param {Object} options - the Run: {runState, trigger} (the trigger payload)
 * @returns {*} the selected results
 */
async function query(config, options = {}) {
  const compiled = compile(config)
  const results = await execute(compiled, options)
  return applySelection(results, compiled.select)
}

export default query
