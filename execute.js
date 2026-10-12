/**
 * @fileoverview MicroQL Execution Engine
 *
 * Runs a compiled Query: phases column by column, the phases of a column in
 * parallel, each phase's chain in order. Every call's result is written to the
 * Run State by (form hash, input hash) as it goes, and a call whose result the
 * Run State already holds is not run again — that one rule is resume after an
 * interruption.
 *
 * Scope: a call sees `{flow, bindings, errors}` — the value flowing in (`@`),
 * the values its enclosing iterations named with `as:` (`@name`), and the
 * errors of its enclosing catch handlers (`@err`, `@@err`).
 *
 * A phase that fails fails the Run, unless the Query has a catch: then the
 * handler's result is the phase's, and the Run carries on.
 */

import {columnsOf, upstreamOf} from './graph.js'
import {formsOf, hashOf} from './forms.js'
import {wrap, catchWith} from './wrappers.js'
import {rootScope, enterPosition} from './reference.js'
import RateLimitedQueue from './ratelimit.js'
import {concurrencyLimit} from './concurrency.js'
import {mapValues, pick} from './common.js'
import {validate} from './zodly.js'
import {format} from './format.js'

// The runtime each service last received at init. A service is initialized
// at most once per runtime; a service shared between runtimes is initialized
// again when the runtime it is used with changes.
const initializedWith = new WeakMap()

async function initServices(services, runtime) {
  for (const service of services) {
    if (typeof service.init === 'function' && initializedWith.get(service) !== runtime) {
      await service.init(runtime)
      initializedWith.set(service, runtime)
    }
  }
}

// Call tearDown on the services a Run used
async function callTearDown(services) {
  for (const [serviceName, service] of services) {
    if (typeof service.tearDown === 'function') {
      try {
        await service.tearDown()
      } catch (error) {
        // Log tearDown errors but don't throw them
        console.error(`Error in ${serviceName}.tearDown():`, error.message)
      }
    }
  }
}

// Runs a phase or position's steps in order: each step's result flows into the next.
async function runSteps(steps, scope, run) {
  let flow = scope.flow
  for (const step of steps) {
    flow = await invoke(step, {...scope, flow}, run)
  }
  return flow
}

// Runs a position's steps for one input (and, in a catch, the failed item).
function runPosition(position, scope, input, item, run) {
  return runSteps(position.steps, enterPosition(position, scope, input, item), run)
}

// Starts a call, unless the Run has been aborted, and tracks it by address
// until it settles.
function invoke(call, scope, run) {
  if (run.signal?.aborted) return Promise.reject(run.signal.reason)
  run.usedServices.set(call.parts.service, call.service)
  const pending = run.pipelines.get(call)(call.args, {call, scope, run})
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
  runSteps(run.compiled.phases[name].steps, rootScope, run).catch(catchWith(run.compiled.settings.catch, rootScope, run))

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
  if (!name) throw new Error(`Targets are phases, named '$phase': got '${target}'`)
  if (target !== `$${name}`) throw new Error(`Targets are phases: use '$${name}'`)
  if (!compiled.phases[name]) throw new Error(`Unknown target '${target}': no phase named '${name}'`)
  return name
}

// The phases a Run executes, and the calls it reruns regardless of the Run
// State: everything for the whole Query; for a target phase, the phase and
// what it depends on, rerunning the target's own calls.
function scopeOfRun(compiled, target) {
  if (!target) return {phases: Object.keys(compiled.phases), rerun: () => false}
  const name = targetPhase(compiled, target)
  return {
    phases: [...upstreamOf(compiled.phases, name)],
    rerun: (call) => call.address.startsWith(`$${name}.`)
  }
}

// The first call whose service requires a runtime key the runtime lacks.
function checkCapabilities({calls, runtime}) {
  for (const call of calls) {
    const missing = (call.service.requires ?? []).find(key => !(key in runtime))
    if (missing) {
      const message = `[${call.address}] Service '${call.parts.service}' requires runtime.${missing}, which this runtime doesn't provide`
      throw Object.assign(new Error(message), {address: call.address, code: 'missing-capability'})
    }
  }
}

// What a Run needs from its caller, which core never supplies itself, and a
// trigger payload that fits the Query's trigger schema, if it declares one.
function checkRunInputs(compiled, {runState, trigger}) {
  if (!compiled.runtime) throw new Error('execute needs a runtime: pass config.runtime (microql/core has none of its own)')
  if (!runState) throw new Error('execute needs a runState: the entry store for this Run, such as memoryStore()')
  checkCapabilities(compiled)
  try {
    validate(compiled.triggerSchema, trigger, format, false)
  } catch (error) {
    error.message = `$trigger validation failed:\n${error.message}`
    throw error
  }
}

/**
 * Execute a compiled Query within one Run State.
 * @param {Object} compiled - from compile()
 * @param {Object} options - {runState, trigger, target, signal, onUpdate}: the
 *   Run's store, the trigger payload, the phase to run up to (default: all),
 *   an AbortSignal that stops the Run, and a callback receiving each phase's
 *   updates
 * @returns {Object} each executed phase's result, by name
 */
export async function execute(compiled, {runState, trigger, target, signal, onUpdate = () => {}} = {}) {
  checkRunInputs(compiled, {runState, trigger})
  const {runtime, settings} = compiled
  const {phases, rerun} = scopeOfRun(compiled, target)

  const run = {
    compiled,
    runtime,
    runState,
    forms: formsOf(compiled, {trigger}),
    nodes: {given: compiled.given, trigger},
    resultHashes: {},
    inflight: new Map(),
    pending: new Map(),
    signal,
    aborted: abortion(signal),
    usedServices: new Map(),
    rateLimiters: mapValues(settings.rateLimit ?? {}, interval => new RateLimitedQueue(interval)),
    limit: settings.concurrency ? concurrencyLimit(settings.concurrency) : undefined,
    rerun,
    onUpdate,
    runPosition: (position, scope, input, item) => runPosition(position, scope, input, item, run)
  }
  // each call's wrappers depend only on the call and the Run, so they're built once
  run.pipelines = new Map(compiled.calls.map(call => [call, wrap(call, run)]))

  await initServices(new Set(compiled.calls.map(call => call.service)), runtime)

  try {
    for (const column of columnsOf(pick(compiled.phases, phases))) {
      await Promise.all(column.map(async (name) => {
        run.nodes[name] = await runPhase(name, run)
      }))
    }
  } finally {
    // an abort discards work in progress: nothing waits for it
    if (!signal?.aborted) await settle(run)
    await callTearDown(run.usedServices)
  }

  return pick(run.nodes, phases)
}

export default execute
