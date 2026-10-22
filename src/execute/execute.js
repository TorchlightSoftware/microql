/**
 * @fileoverview MicroQL Execution Engine
 *
 * Runs a compiled Query: phases column by column, the phases of a column in
 * parallel, each phase's chain in order. Every call's result is written to the
 * Run State by (form hash, input hash) as it goes, and a call whose result the
 * Run State already holds is not run again — that one rule is resume after an
 * interruption.
 *
 * Context: a call sees `{flow, bindings, errors}` — the value flowing in (`@`),
 * the values its enclosing iterations named with `as:` (`@name`), and the
 * errors of its enclosing catch handlers (`@err`, `@@err`).
 * Every service call is made through the scope the Query was compiled in,
 * and every result is kept in its Run State: the runtime decides how both
 * are keyed, and core never knows.
 *
 * A phase that fails fails the Run, unless the Query has a catch: then the
 * handler's result is the phase's, and the Run carries on.
 */

import {columnsOf, upstreamOf} from '../query/graph.js'
import {formsOf, hashOf} from '../query/forms.js'
import {wrap, catchWith} from './wrappers.js'
import {rootContext, enterPosition} from '../query/reference.js'
import RateLimitedQueue from './ratelimit.js'
import {concurrencyLimit} from './concurrency.js'
import {mapValues, pick} from '../common/common.js'
import {validate} from '@tlsft/zodly'
import {format} from '../common/format.js'
import {errorOf} from '../common/error-catalog.js'

// Runs a phase or position's steps in order: each step's result flows into the next.
async function runSteps(steps, context, run) {
  let flow = context.flow
  for (const step of steps) {
    flow = await invoke(step, {...context, flow}, run)
  }
  return flow
}

// Runs a position's steps for one input (and, in a catch, the failed item).
function runPosition(position, context, input, item, run) {
  return runSteps(position.steps, enterPosition(position, context, input, item), run)
}

// Starts a call, unless the Run has been aborted, and tracks it by address
// until it settles.
function invoke(call, context, run) {
  if (run.signal?.aborted) return Promise.reject(run.signal.reason)
  const pending = run.pipelines.get(call)(call.args, {call, context, run})
  run.pending.set(pending, call.address)
  return pending.finally(() => run.pending.delete(pending))
}

// Waits for every call the Run started, including those a failure left
// running, so their results reach the Run State before the Run reports.
async function settle(run) {
  while (run.pending.size) await Promise.allSettled(run.pending.keys())
}

// A promise that rejects with the signal's reason when it aborts, and never
// settles otherwise. Its rejection counts as handled, so an abort with no
// phase left to race it is not an unhandled rejection.
function abortion(signal) {
  const aborted = new Promise((_resolve, reject) => {
    if (signal?.aborted) reject(signal.reason)
    signal?.addEventListener('abort', () => reject(signal.reason), {once: true})
  })
  aborted.catch(() => {})
  return aborted
}

const isAbort = (error, run) => run.signal?.aborted && error === run.signal.reason

// The addresses of a phase's calls still in flight.
const inFlightIn = (name, run) => [...run.pending.values()].filter(address => address.startsWith(`$${name}.`))

// Hands an update to the host. Reporting never fails a Run: an onUpdate
// that throws is logged, and the Run carries on.
function report(run, update) {
  try {
    run.onUpdate(update)
  } catch (error) {
    console.error(`onUpdate failed on ${update.kind} ${update.name} ${update.status}:`, error.message)
  }
}

// Records a done phase's result hash, and returns it with the hashes of the
// upstream results the phase read: what a platform needs to tell, after an
// upstream phase reruns, whether a later phase's results are stale.
function resultHashes(name, result, run) {
  run.resultHashes[name] = hashOf(result)
  const upstream = [...run.compiled.phases[name].dependencies].map(phase => [phase, run.resultHashes[phase]])
  return {resultHash: run.resultHashes[name], upstream: Object.fromEntries(upstream)}
}

// A phase's result: its steps', or the Query's catch's when they fail.
const phaseResult = (name, run) =>
  runSteps(run.compiled.phases[name].steps, rootContext, run).catch(catchWith(run.compiled.settings.catch, rootContext, run))

// Runs one phase, reporting it running, then done, failed or cancelled. A
// running phase reports when it started, never partial output; an abort ends
// it at once, reporting the calls it leaves in flight.
function runPhase(name, run) {
  const startedAt = new Date()
  const reportPhase = (status, details) =>
    report(run, {kind: 'phase', name, status, startedAt: startedAt.toISOString(), ...details})
  const duration = () => Date.now() - startedAt

  reportPhase('running')
  return Promise.race([phaseResult(name, run), run.aborted]).then(
    result => {
      reportPhase('done', {duration: duration(), ...resultHashes(name, result, run)})
      return result
    },
    error => {
      if (isAbort(error, run)) reportPhase('cancelled', {duration: duration(), inFlight: inFlightIn(name, run)})
      else reportPhase('failed', {duration: duration(), error: error.message})
      throw error
    }
  )
}

// The phase a target names: `$name`, which must be a phase of the Query.
function targetPhase(compiled, target) {
  const name = target.match(/^\$?([A-Za-z_]\w*)/)?.[1]
  if (target !== `$${name}`) throw errorOf('invalid-target', {target, phase: name}, {where: 'execute:'})
  if (!compiled.phases[name]) throw errorOf('unknown-target', {target}, {where: 'execute:'})
  return name
}

// The phases a Run executes, and the calls it reruns regardless of the Run
// State: everything for the whole Query; for a target phase, the phase and
// what it depends on, rerunning the target's own calls.
function extentOfRun(compiled, target) {
  if (!target) return {phases: Object.keys(compiled.phases), rerun: () => false}
  const name = targetPhase(compiled, target)
  return {
    phases: [...upstreamOf(compiled.phases, name)],
    rerun: (call) => call.address.startsWith(`$${name}.`)
  }
}

// What a Run needs from its caller, which core never supplies itself: a
// scope with a Run State, scope.run, to run in, and a trigger payload
// that fits the Query's trigger schema, if it declares one.
function checkRunInputs(compiled, {trigger}) {
  if (!compiled.scope.run) throw errorOf('missing-run-state', {}, {where: 'execute:'})
  try {
    validate(compiled.triggerSchema, trigger, format)
  } catch (error) {
    throw errorOf('invalid-trigger', {details: error.message}, {where: 'execute:'})
  }
}

/**
 * Execute a compiled Query as one Run, in the Run State of the scope it was compiled in.
 * @param {Object} compiled - from compile()
 * @param {Object} options - {trigger, target, signal, onUpdate}: the trigger
 *   payload, the phase to run up to (default: all), an AbortSignal that stops
 *   the Run, and a callback receiving each phase's updates
 * @returns {Object} each executed phase's result, by name
 */
export async function execute(compiled, {trigger, target, signal, onUpdate = () => {}} = {}) {
  checkRunInputs(compiled, {trigger})
  const {scope, settings} = compiled
  const {phases, rerun} = extentOfRun(compiled, target)

  const run = {
    compiled,
    scope,
    runState: scope.run,
    formGraph: formsOf(compiled, {trigger}),
    nodes: {given: compiled.given, trigger},
    resultHashes: {},
    inflight: new Map(),
    pending: new Map(),
    signal,
    aborted: abortion(signal),
    rateLimiters: mapValues(settings.rateLimit ?? {}, interval => new RateLimitedQueue(interval)),
    limit: settings.concurrency ? concurrencyLimit(settings.concurrency) : undefined,
    rerun,
    onUpdate,
    runPosition: (position, context, input, item) => runPosition(position, context, input, item, run)
  }
  // each call's wrappers depend only on the call and the Run, so they're built once
  run.pipelines = new Map(compiled.calls.map(call => [call, wrap(call, run)]))

  try {
    for (const column of columnsOf(pick(compiled.phases, phases))) {
      await Promise.all(column.map(async (name) => {
        run.nodes[name] = await runPhase(name, run)
      }))
    }
  } finally {
    // an abort discards work in progress: nothing waits for it
    if (!signal?.aborted) await settle(run)
  }

  return pick(run.nodes, phases)
}

export default execute
