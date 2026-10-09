/**
 * @fileoverview plan() — everything a view needs to know about a Query
 * without running it. Pure, and cheap enough to recompute on every edit.
 *
 * Returns the phases, their dependencies and the columns that run together;
 * `$given` and `$trigger` as root nodes ahead of the first column; and every
 * call's address, JSON path, form and form hash, and inferred types. A view
 * finds a call's results by looking up its form hash in the Run State. Two
 * addresses sharing one form hash are identical calls that run once.
 */

import compile from './compile.js'
import {columnsOf} from './graph.js'
import {formsOf} from './forms.js'
import {isReference, parseReference, rootScope, enterPosition, scopedRoot} from './reference.js'
import {mixed, typeOfSchema, typeOfValue, typeAtPath, listOf, satisfies} from './types.js'
import {isPlainObject, mapValues} from './common.js'

const ERROR_TYPE = {type: 'object', fields: {message: {type: 'text'}, address: {type: 'text'}, key: {type: 'text'}}}

// The type of an argument: a literal's own type, or what its reference names.
function typeOfArgument(value, scope, env) {
  if (isReference(value)) {
    const ref = parseReference(value)
    const root = ref.sigil === '$' ? (env.nodes[ref.name] ?? env.phases[ref.name]) : scopedRoot(ref, scope)
    return typeAtPath(root ?? mixed, ref.path)
  }
  if (Array.isArray(value)) return listOf(value.map(v => typeOfArgument(v, scope, env)))
  if (isPlainObject(value)) return {type: 'object', fields: mapValues(value, v => typeOfArgument(v, scope, env))}
  return typeOfValue(value)
}

const describeType = (t) => t.type === 'list' ? `list of ${describeType(t.element)}` : t.type

function warnUnless(expected, actual, where, env) {
  if (!satisfies(expected, actual)) {
    env.warnings.push({address: where, message: `${where} expects ${describeType(expected)} but receives ${describeType(actual)}`})
  }
}

function stepsTypes(steps, scope, env) {
  let flow = scope.flow
  for (const step of steps) flow = callTypes(step, {...scope, flow}, env)
  return flow
}

// A call's types: each argument's expected and actual type, each position's
// expected and actual return, and the call's own return type.
function callTypes(call, scope, env) {
  const expectedFields = typeOfSchema(call.validators?.precheck?.service).fields ?? {}
  const args = mapValues({...call.args, ...call.settingsArgs}, (value, field) => ({
    expected: expectedFields[field] ?? mixed,
    actual: typeOfArgument(value, scope, env)
  }))
  for (const [field, {expected, actual}] of Object.entries(args)) warnUnless(expected, actual, `${call.address}.${field}`, env)

  const iterated = args[call.iterates]?.actual
  const item = iterated?.type === 'list' ? iterated.element : mixed

  const positions = mapValues(call.positions, (position, field) => {
    const input = field === 'onError' ? ERROR_TYPE : item
    const actual = stepsTypes(position.steps, enterPosition(position, scope, input), env)
    const expected = typeOfSchema(position.returns)
    warnUnless(expected, actual, `${call.address}.${field}`, env)
    return {expected, actual}
  })

  const returns = typeOfSchema(call.validators?.postcheck?.query ?? call.validators?.postcheck?.service)
  env.calls.set(call.address, {args, positions, returns})
  return returns
}

// Expected and actual types for every call, by address, plus mismatch warnings.
function inferTypes(compiled, columns, trigger) {
  const env = {
    nodes: {given: typeOfValue(compiled.given), trigger: trigger === undefined ? mixed : typeOfValue(trigger)},
    phases: {},
    calls: new Map(),
    warnings: []
  }
  for (const name of columns.flat()) {
    env.phases[name] = stepsTypes(compiled.phases[name].steps, {...rootScope, flow: mixed}, env)
  }
  return env
}

/**
 * Plan a Query without running it.
 * @param {Object} query - the Query, as given to query()
 * @param {Object} options - {trigger}: the trigger payload, when known
 */
export function plan(query, {trigger} = {}) {
  const compiled = compile(query)
  const columns = columnsOf(compiled.phases)
  const forms = formsOf(compiled, {trigger})
  const types = inferTypes(compiled, columns, trigger)

  const roots = [
    compiled.given !== undefined && {name: 'given', type: types.nodes.given},
    compiled.trigger && {name: 'trigger', kind: compiled.trigger.kind, type: types.nodes.trigger}
  ].filter(Boolean)

  return {
    query: forms.query,
    roots,
    columns,
    phases: Object.values(compiled.phases).map(phase => ({
      name: phase.name,
      dependencies: [...phase.dependencies],
      formHash: forms.phases[phase.name],
      returns: types.phases[phase.name]
    })),
    calls: compiled.calls.map(call => ({
      address: call.address,
      path: call.path,
      argsPath: call.argsPath,
      targetField: call.targetField,
      key: call.key,
      formHash: forms.calls.get(call.address).hash,
      form: forms.calls.get(call.address).form,
      types: types.calls.get(call.address)
    })),
    warnings: [...compiled.warnings, ...types.warnings]
  }
}
