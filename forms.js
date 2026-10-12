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

import {sha256} from '@noble/hashes/sha2.js'
import {bytesToHex, utf8ToBytes} from '@noble/hashes/utils.js'
import {mapReferences, parseReference, rootScope, enterPosition, scopedRoot} from './reference.js'
import {columnsOf} from './graph.js'
import {isPlainObject, getIn, omit, setPaths} from './common.js'

// Settings that change how a call runs, never what it returns.
const OPERATIONAL_SETTINGS = ['timeout', 'retry', 'debug', 'cache']


// The value as canonical JSON: sorted keys (RFC 8785 ordering), errors by name,
// message and their own fields. Functions and undefined are dropped from
// objects, and read as null anywhere else.
export function canonical(value) {
  return JSON.stringify(canonicalValue(value))
}

function canonicalValue(value) {
  if (value === undefined || typeof value === 'function') return null
  if (value instanceof Error) return canonicalValue({...value, name: value.name, message: value.message})
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map(canonicalValue)
  if (isPlainObject(value)) {
    return Object.fromEntries(Object.keys(value).sort()
      .filter(k => value[k] !== undefined && typeof value[k] !== 'function')
      .map(k => [k, canonicalValue(value[k])]))
  }
  // other instances (a zod schema, a Map) are named by their class
  if (typeof value === 'object' && value !== null) return {instance: value.constructor?.name}
  return value
}

// SHA-256 of the value's canonical JSON, as hex. Synchronous and pure JS, so it
// runs on every platform without Web Crypto's per-digest promise and thread hop.
export const hashOf = (value) => bytesToHex(sha256(utf8ToBytes(canonical(value))))

// A reference's form: what it points to, as a hash or (for root nodes) a value.
function referenceForm(text, scope, env) {
  const ref = parseReference(text)
  const {sigil, name, path} = ref
  if (sigil === '$' && name in env.nodes) return {value: getIn(env.nodes[name], path) ?? null}
  if (sigil === '$') return {phase: env.phases[name], path}
  return {scoped: scopedRoot(ref, scope), path}
}

// Arguments with every reference replaced by its form.
const argumentsForm = (value, scope, env) => mapReferences(value, text => referenceForm(text, scope, env))

// Forms the steps of a phase or position in order; returns each step's hash.
function stepsForm(steps, scope, env) {
  const hashes = []
  let flow = scope.flow
  for (const step of steps) {
    flow = callForm(step, {...scope, flow}, env)
    hashes.push(flow)
  }
  return hashes
}

// A call's form and hash, recorded by address. The data part (key and
// arguments) is hashed first: a position's input is "the input of this call",
// which the inner forms name by that hash, so a form never contains itself.
function callForm(call, scope, env) {
  const data = {
    key: call.key,
    args: argumentsForm(setPaths(call.args, call.settingsArgs), scope, env),
    settings: omit(call.settings, [...OPERATIONAL_SETTINGS, 'rateLimit', 'inspect']),
    checks: call.checks
  }
  // only a call with positions needs its data hashed apart from its form
  const input = Object.keys(call.positions).length ? hashOf(data) : undefined

  const positions = {}
  for (const [field, position] of Object.entries(call.positions)) {
    const item = {itemOf: input}
    const entered = field === 'catch' ? enterPosition(position, scope, {errorOf: input}, item) : enterPosition(position, scope, item)
    positions[field] = stepsForm(position.steps, entered, env)
  }

  const form = {...data, positions}
  const hash = hashOf(form)
  env.calls.set(call.address, {form, hash})
  return hash
}

/**
 * The forms of every call in a compiled Query, against one trigger payload.
 * @returns {Object} {calls: Map(address → {form, hash}), phases: {name → hash}, queryHash: hash}
 */
export function formsOf(compiled, {trigger} = {}) {
  const env = {nodes: {given: compiled.given, trigger}, phases: {}, calls: new Map()}

  // in column order, so a phase's upstream form hashes are known before it
  for (const name of columnsOf(compiled.phases).flat()) {
    env.phases[name] = stepsForm(compiled.phases[name].steps, rootScope, env).at(-1)
  }

  const handler = compiled.settings.catch
  if (handler) {
    stepsForm(handler.steps, enterPosition(handler, rootScope, {errorOf: 'phase'}), env)
  }

  return {calls: env.calls, phases: env.phases, queryHash: hashOf(env.phases)}
}
