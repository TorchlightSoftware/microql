/**
 * @fileoverview plan() — everything a view needs to know about a Query
 * without running it. Pure, and cheap enough to recompute on every edit.
 *
 * Returns the phases, their dependencies and the columns that run together;
 * `$given` and `$trigger` as root nodes ahead of the first column; and every
 * call's address, JSON path, form and form hash, and inferred types, as zod
 * schemas. A view
 * finds a call's results by looking up its form hash in the Run State. Two
 * addresses sharing one form hash are identical calls that run once.
 */

import {z} from 'zod'
import compile from '../query/compile.js'
import {columnsOf} from '../query/graph.js'
import {formsOf} from '../query/forms.js'
import {isReference, parseReference, rootContext, enterPosition, contextRoot} from '../query/reference.js'
import {any, isAny, unwrap, widenedTypeOf, schemaAtPath, sharedSchema, compare, describeSchema, union, receivedBy, returnedBy} from './types.js'
import {isPlainObject, mapValues, getIn, setPaths, parseFieldPath} from '../common/common.js'
import {READINGS} from './declaration.js'
import {errorSchema, parseSchema} from '@tlsft/zodly'

// The type of an argument: a literal's own type, or what its reference names.
function typeOfArgument(value, context, env) {
  if (isReference(value)) {
    const ref = parseReference(value)
    const root = ref.sigil === '$' ? (env.nodes[ref.name] ?? env.phases[ref.name]) : contextRoot(ref, context)
    return schemaAtPath(root ?? any, ref.path)
  }
  if (Array.isArray(value)) return z.array(sharedSchema(value.map(v => typeOfArgument(v, context, env))))
  if (isPlainObject(value)) return z.object(mapValues(value, v => typeOfArgument(v, context, env)))
  return widenedTypeOf(value)
}

// A declaration's document as plan() reads it, by one of its READINGS; any
// when there is none.
const plannedDocument = (document, preprocess) => document === undefined ? any : parseSchema(document, {preprocess})

const expectedData = (call, fields) => plannedDocument(call.declaration.input, READINGS.plannedData(fields))
const expectedInput = (call, fields) => plannedDocument(call.declaration.input, READINGS.planned(fields))
const expectedOutput = (call, fields) => plannedDocument(call.declaration.output, READINGS.planned(fields))

// What each kind of issue says, in a plan error's message.
const MESSAGES = {
  'type-mismatch': (expected, actual) => `expects ${describeSchema(expected)} but receives ${describeSchema(actual)}`,
  'maybe-missing': (expected, actual) => `expects ${describeSchema(expected)} but may receive nothing: ${describeSchema(actual)}`,
  'type-narrowing': (expected, actual) => `expects ${describeSchema(expected)} but receives ${describeSchema(actual)}, which is only checked when it runs`
}

// Each issue in how a field's actual type fits its expected one is an error in
// the plan, at the field's address and the path inside it; run-time validation
// still decides whether the call runs.
function checkType(expected, actual, where, env) {
  for (const {code, path, expected: wanted, actual: given} of compare(expected, actual)) {
    const address = [where, ...path].join('.')
    env.errors.push({address, code, message: `${address} ${MESSAGES[code](wanted, given)}`, expected: wanted, actual: given})
  }
}

function stepsTypes(steps, context, env) {
  let flow = context.flow
  for (const step of steps) flow = callTypes(step, {...context, flow}, env)
  return flow
}

// The type of a call's arguments: what flows into them, except the fields the
// call's own precheck names, which take its types, since the call checks them
// before it runs.
function argumentsType(call, args, context, env) {
  const flowing = typeOfArgument(args, context, env)
  const precheck = call.validators?.precheck?.call
  return precheck?.def.type === 'object' ? z.object({...flowing.shape, ...precheck.shape}) : flowing
}

// A call's fields, for resolving its declaration's sources: its bindings. A
// field's type is what flows into it, or what its precheck says (for a call
// field, what its nested call returns, or its catch does, once typed), or its
// declared type when nothing known flows in.
function fieldsOf(call, context, env) {
  const args = setPaths(call.args, call.settingsArgs)
  const argsType = argumentsType(call, args, context, env)
  const declared = (path) => call.declaration.fields.find(field => field.path === path)?.declaredType
  const returns = {}
  const typeOf = (path) => {
    if (returns[path]) return returns[path]
    const actual = schemaAtPath(argsType, parseFieldPath(path))
    return isAny(actual) && declared(path) ? declared(path) : actual
  }
  const valueAt = (path) => getIn(args, parseFieldPath(path))
  return {args, argsType, returns, typeOf, valueAt}
}

// Each argument's expected and actual type; every declared data field is
// checked at its path, and one the call doesn't supply is absent.
function argumentTypes(call, fields, env) {
  const expected = expectedData(call, fields)
  checkType(expected, fields.argsType, call.address, env)
  return mapValues(fields.argsType.shape, (actual, field) => ({expected: schemaAtPath(expected, [field]), actual}))
}

// The type of the item a call's catch sees: what its call fields receive, one
// type when they share it.
const itemOf = (received) => {
  const shared = sharedSchema(received)
  return isAny(shared) && received.length > 1 ? received.reduce(union) : shared
}

// What a catch returns, given the error and the item whose call failed; none
// when there is no catch.
const catchType = (handler, context, item, env) =>
  handler && stepsTypes(handler.steps, enterPosition(handler, context, errorSchema, item), env)

// Each call field's expected and actual return. `@` inside it is what the
// declaration says it receives. A failed invocation returns what the call's
// catch does, so a field returns its nested call's type or the catch's. A call
// field's return, once typed, is its type for the fields typed after it.
function positionTypes(call, context, fields, env) {
  const {catch: handler, ...held} = call.positions
  // the call field's function type, with what's typed so far
  const signatureOf = (path) => unwrap(schemaAtPath(expectedInput(call, fields), parseFieldPath(path)))
  const caught = catchType(handler, context, itemOf(Object.keys(held).map(path => receivedBy(signatureOf(path)))), env)
  const types = mapValues(held, (position, path) => {
    const signature = signatureOf(path)
    const returned = stepsTypes(position.steps, enterPosition(position, context, receivedBy(signature)), env)
    const actual = caught ? union(returned, caught) : returned
    const expected = returnedBy(signature)
    checkType(expected, actual, `${call.address}.${path}`, env)
    fields.returns[path] = actual
    return {expected, actual}
  })
  return caught ? {...types, catch: {expected: any, actual: caught}} : types
}

// The call's own postcheck, else its declared output, resolved against its fields.
const returnType = (call, fields) =>
  call.validators?.postcheck?.call ?? expectedOutput(call, fields)

// A call's types: its arguments', its call fields', and its return type.
function callTypes(call, context, env) {
  const fields = fieldsOf(call, context, env)
  const args = argumentTypes(call, fields, env)
  const positions = positionTypes(call, context, fields, env)
  const returns = returnType(call, fields)
  env.calls.set(call.address, {args, positions, returns})
  return returns
}

// Expected and actual types for every call, by address, plus mismatch errors.
// $trigger's type: the payload's own when there is one, else the Query's
// trigger schema, else any.
const triggerType = (payload, schema) =>
  payload !== undefined ? widenedTypeOf(payload) : schema ?? any

// Each phase returns its steps' type, or what the Query's catch does.
function inferTypes(compiled, columns, trigger) {
  const env = {
    nodes: {given: widenedTypeOf(compiled.given), trigger: triggerType(trigger, compiled.triggerSchema)},
    phases: {},
    calls: new Map(),
    errors: []
  }
  const caught = catchType(compiled.settings.catch, rootContext, any, env)
  for (const name of columns.flat()) {
    const returned = stepsTypes(compiled.phases[name].steps, {...rootContext, flow: any}, env)
    env.phases[name] = caught ? union(returned, caught) : returned
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
    {name: 'trigger', type: types.nodes.trigger}
  ].filter(Boolean)

  return {
    queryHash: forms.queryHash,
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
    warnings: compiled.warnings,
    errors: types.errors
  }
}
