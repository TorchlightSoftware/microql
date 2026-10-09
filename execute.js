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
 * errors of its enclosing onError handlers (`@err`, `@@err`).
 */

import _ from 'lodash'
import {columnsOf, upstreamOf} from './graph.js'
import {formsOf} from './forms.js'
import {memoryStore, defaultRuntime} from './runtime.js'
import {wrap} from './wrappers.js'
import {rootScope, enterPosition} from './reference.js'
import RateLimitedQueue from './ratelimit.js'
import {concurrencyLimit} from './concurrency.js'

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

// Runs a position's steps for one input.
function runPosition(position, scope, input, run) {
  return runSteps(position.steps, enterPosition(position, scope, input), run)
}

function invoke(call, scope, run) {
  run.usedServices.set(call.parts.service, call.service)
  const pending = run.pipelines.get(call)(call.args, {call, scope, run})
  run.pending.add(pending)
  return pending.finally(() => run.pending.delete(pending))
}

// Waits for every call the Run started, including those a failure left
// running, so their results reach the Run State before the Run reports.
async function settle(run) {
  while (run.pending.size) await Promise.allSettled(run.pending)
}

// Hands an update to the host. Reporting never fails a Run: an onUpdate
// that throws is logged, and the Run carries on.
function report(run, update) {
  try {
    run.onUpdate(update)
  } catch (error) {
    console.error(`onUpdate failed on ${update.kind} ${update.name} ${update.status}:`, error.message)
  }
}

// Runs one phase, reporting it running, then done or failed. A running phase
// reports when it started, never partial output.
function runPhase(name, run) {
  const startedAt = new Date()
  const reportPhase = (status, details) =>
    report(run, {kind: 'phase', name, status, startedAt: startedAt.toISOString(), ...details})
  const duration = () => Date.now() - startedAt

  reportPhase('running')
  return runSteps(run.compiled.phases[name].steps, rootScope, run).then(
    result => {
      reportPhase('done', {duration: duration()})
      return result
    },
    error => {
      reportPhase('failed', {duration: duration(), error: error.message})
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

// The global onError handler sees the error that ended the Run.
async function handleGlobalError(error, settings, run) {
  if (settings.onError) {
    try {
      await runPosition(settings.onError, rootScope, error, run)
    } catch (handlerError) {
      handlerError.message = `Global onError handler failed: ${handlerError.message}`
      if (!settings.ignoreErrors) throw handlerError
    }
  }
  if (!settings.ignoreErrors) throw error
}

/**
 * Execute a compiled Query within one Run State.
 * @param {Object} compiled - from compile()
 * @param {Object} options - {runState, trigger, target, onUpdate}: the Run's
 *   store, the trigger payload, the phase to run up to (default: all), and a
 *   callback receiving each phase's updates
 * @returns {Object} each executed phase's result, by name
 */
export async function execute(compiled, {runState = memoryStore(), trigger, target, onUpdate = () => {}} = {}) {
  const runtime = compiled.runtime ?? defaultRuntime
  const {settings} = compiled
  const {phases, rerun} = scopeOfRun(compiled, target)

  const run = {
    compiled,
    runtime,
    runState,
    forms: await formsOf(compiled, {trigger}),
    nodes: {given: compiled.given, trigger},
    inflight: new Map(),
    pending: new Set(),
    usedServices: new Map(),
    rateLimiters: _.mapValues(settings.rateLimit ?? {}, interval => new RateLimitedQueue(interval)),
    limit: settings.concurrency ? concurrencyLimit(settings.concurrency) : undefined,
    rerun,
    onUpdate,
    runPosition: (position, scope, input) => runPosition(position, scope, input, run)
  }
  // each call's wrappers depend only on the call and the Run, so they're built once
  run.pipelines = new Map(compiled.calls.map(call => [call, wrap(call, run)]))

  await initServices(new Set(compiled.calls.map(call => call.service)), runtime)

  try {
    for (const column of columnsOf(_.pick(compiled.phases, phases))) {
      await Promise.all(column.map(async (name) => {
        run.nodes[name] = await runPhase(name, run)
      }))
    }
  } catch (error) {
    await settle(run)
    await handleGlobalError(error, settings, run)
  } finally {
    await settle(run)
    await callTearDown(run.usedServices)
  }

  return _.pick(run.nodes, phases)
}

export default execute
