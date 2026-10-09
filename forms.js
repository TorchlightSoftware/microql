/**
 * @fileoverview Forms — the canonical structure of a call.
 *
 * A call's form is its definition with each reference replaced by the form
 * hash of what it points to, so forms make a Merkle structure: a form holds
 * only its own call plus the hashes of its upstream forms, and its hash
 * changes exactly when it or anything upstream changes. A moved call whose
 * inputs didn't change keeps its form; an edited call gets a new one, as does
 * everything downstream of it.
 *
 * What feeds a form: the call's key and arguments (but not its operational
 * settings), its positions' forms, each `$phase` as that phase's form hash,
 * and `$given` / `$trigger` by their values.
 */

import _ from 'lodash'
import {isReference, parseReference, rootScope, enterPosition, scopedRoot} from './reference.js'
import {columnsOf} from './graph.js'

// Settings that change how a call runs, never what it returns.
const OPERATIONAL_SETTINGS = ['timeout', 'retry', 'debug', 'cache']

const isPlainObject = (value) => _.isPlainObject(value)

// The value as canonical JSON: sorted keys (RFC 8785 ordering), functions and
// undefined dropped, errors by name, message and their own fields.
export function canonical(value) {
  return JSON.stringify(canonicalValue(value))
}

function canonicalValue(value) {
  if (value instanceof Error) return canonicalValue({...value, name: value.name, message: value.message})
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map(v => v === undefined || typeof v === 'function' ? null : canonicalValue(v))
  if (isPlainObject(value)) {
    return Object.fromEntries(Object.keys(value).sort()
      .filter(k => value[k] !== undefined && typeof value[k] !== 'function')
      .map(k => [k, canonicalValue(value[k])]))
  }
  // other instances (a zod schema, a Map) are named by their class
  if (typeof value === 'object' && value !== null) return {instance: value.constructor?.name}
  return value
}

// SHA-256 of the value's canonical JSON, as hex. Web Crypto exists on every runtime.
export async function hashOf(value) {
  const bytes = new TextEncoder().encode(canonical(value))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('')
}

// A reference's form: what it points to, as a hash or (for root nodes) a value.
function referenceForm(text, scope, env) {
  const ref = parseReference(text)
  const {sigil, name, path} = ref
  if (sigil === '$' && name in env.nodes) return {value: _.get(env.nodes[name], path) ?? null}
  if (sigil === '$') return {phase: env.phases[name], path}
  return {scoped: scopedRoot(ref, scope), path}
}

// Arguments with every reference replaced by its form.
const argumentsForm = (value, scope, env) => {
  if (isReference(value)) return referenceForm(value, scope, env)
  if (Array.isArray(value)) return value.map(v => argumentsForm(v, scope, env))
  if (isPlainObject(value)) return _.mapValues(value, v => argumentsForm(v, scope, env))
  return value
}

// Forms the steps of a phase or position in order; returns each step's hash.
async function stepsForm(steps, scope, env) {
  const hashes = []
  let flow = scope.flow
  for (const step of steps) {
    flow = await callForm(step, {...scope, flow}, env)
    hashes.push(flow)
  }
  return hashes
}

// A call's form and hash, recorded by address. The data part (key and
// arguments) is hashed first: a position's input is "the input of this call",
// which the inner forms name by that hash, so a form never contains itself.
async function callForm(call, scope, env) {
  const data = {
    key: call.key,
    args: argumentsForm({...call.args, ...call.settingsArgs}, scope, env),
    settings: _.omit(call.settings, [...OPERATIONAL_SETTINGS, 'rateLimit', 'inspect']),
    checks: call.checks
  }
  // only a call with positions needs its data hashed apart from its form
  const input = Object.keys(call.positions).length ? await hashOf(data) : undefined

  const positions = {}
  for (const [field, position] of Object.entries(call.positions)) {
    const item = field === 'onError' ? {errorOf: input} : {itemOf: input}
    positions[field] = await stepsForm(position.steps, enterPosition(position, scope, item), env)
  }

  const form = {...data, positions}
  const hash = await hashOf(form)
  env.calls.set(call.address, {form, hash})
  return hash
}

/**
 * The forms of every call in a compiled Query, against one trigger payload.
 * @returns {Object} {calls: Map(address → {form, hash}), phases: {name → hash}, query: hash}
 */
export async function formsOf(compiled, {trigger} = {}) {
  const env = {nodes: {given: compiled.given, trigger}, phases: {}, calls: new Map()}

  // a column's phases depend only on earlier columns, so they are formed together
  for (const column of columnsOf(compiled.phases)) {
    await Promise.all(column.map(async (name) => {
      const hashes = await stepsForm(compiled.phases[name].steps, rootScope, env)
      env.phases[name] = hashes.at(-1)
    }))
  }

  const onError = compiled.settings.onError
  if (onError) {
    await stepsForm(onError.steps, enterPosition(onError, rootScope, {errorOf: 'run'}), env)
  }

  return {calls: env.calls, phases: env.phases, query: await hashOf(env.phases)}
}
