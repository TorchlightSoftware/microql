/**
 * @fileoverview MicroQL Query Engine - Main Entry Point
 *
 * Compiles a Query, executes it as a Run, and returns what `select`
 * names. Free of environment dependencies: the scope it runs in arrives as
 * `config.scope`, from its runtime.
 */

import {pick} from '../common/common.js'
import compile from './compile.js'
import execute from '../execute/execute.js'
import {resolveReference, rootContext} from './reference.js'

// What `select` names: one reference's value, or the listed phases by name.
export function applySelection(results, select) {
  if (Array.isArray(select)) return pick(results, select.map(ref => ref.name))
  if (select) return resolveReference(select, rootContext, results)
  return results
}

/**
 * Run a Query.
 * @param {Object} config - the Query: {phases, given, trigger, select, settings}, with the
 *   scope it runs in: {scope}, from runtime.scopeOf
 * @param {Object} options - the Run: {trigger, target, signal, onUpdate}; see execute()
 * @returns {*} the selected results
 */
async function query(config, options = {}) {
  const compiled = compile(config)
  const results = await execute(compiled, options)
  return applySelection(results, compiled.select)
}

export default query
