/**
 * @fileoverview Wrappers — the behaviour around every service call.
 *
 * Each wrapper takes the next step, plus the call and Run it is built for,
 * and returns a step of the same shape, `(args, invocation) => result`, where
 * an invocation is {call, scope, run}. A pipeline is built once per call per
 * Run, so what depends only on the call is worked out then, not per execution.
 * They are applied in canonical order, outermost first:
 *
 *   arguments → debug → error handling → run state → cache → precheck
 *   → rate limit → concurrency → retry → postcheck → timeout → the action
 *
 * The Run State and the Cache sit inside error handling, so only successes
 * are reused, and outside validation, so a reused result was already checked.
 * A postcheck failure is retried like any other — a model's next answer may
 * fit — while a precheck failure isn't, since no attempt changes the arguments.
 */

import {mapReferences, parseReference, resolveReference} from './reference.js'
import {getServiceColorName, mapValues, defaults} from './common.js'
import {hashOf} from './forms.js'
import {validate} from './validation.js'


// A call's label in errors and logs: its address and service key.
const labelOf = (call) => `[${call.address} - ${call.key}]`

// Arguments with every reference replaced by its value; a reference that
// names nothing resolves to undefined.
export const resolveArgs = (value, scope, nodes) =>
  mapReferences(value, text => resolveReference(parseReference(text), scope, nodes))

// Resolves the call's data, injects settings-typed arguments, and hands each
// service-typed argument over as a function of its input.
const withArgs = (next, call) => {
  const positions = servicePositions(call)
  return async (_args, inv) => {
    const {scope, run} = inv
    const data = resolveArgs(call.args, scope, run.nodes)
    const settingsArgs = mapValues(resolveArgs(call.settingsArgs, scope, run.nodes),
      value => defaults(value, call.settings))
    const services = Object.fromEntries(positions.map(([field, position]) =>
      [field, (input) => run.runPosition(position, scope, input)]))

    inv.inputs = {...data, ...settingsArgs}
    inv.input = hashOf(inv.inputs)
    return next({...inv.inputs, ...services}, inv)
  }
}

const withDebug = (next) => async (args, inv) => {
  const {call, run} = inv
  const {settings} = call
  const color = getServiceColorName(call.parts.service)
  const show = (value) => run.runtime.inspect(value, settings.inspect)
  const startTime = Date.now()

  run.runtime.print(`${labelOf(call)} Called with args:\n${show(inv.inputs)}`, {color})
  const result = await next(args, inv)
  run.runtime.print(`${labelOf(call)} Completed in ${Date.now() - startTime}ms returning:\n${show(result)}`, {color})
  return result
}

// Labels an error with the call that raised it, once: the innermost call wins.
function labelError(error, inv) {
  if (error.address) return
  error.message = `${labelOf(inv.call)} ${error.message}`
  error.address = inv.call.address
  error.key = inv.call.key
  error.query = inv.run.forms.query
  error.args = inv.inputs
}

// What a failed call returns instead: onError's result with ignoreErrors,
// null with ignoreErrors alone; otherwise the error stands.
async function recover(error, {call, scope, run}) {
  const {onError} = call.positions
  const {ignoreErrors} = call.settings
  if (!onError) {
    if (ignoreErrors) return null
    throw error
  }

  const handled = await run.runPosition(onError, scope, error).then(
    result => ({result}),
    handlerError => ({handlerError})
  )
  if (handled.handlerError) {
    const message = `${labelOf(call)} onError handler failed: ${handled.handlerError.message}`
    console.warn(message)
    if (!ignoreErrors) throw new Error(message)
    return null
  }
  if (ignoreErrors) return handled.result
  throw error
}

const withErrorHandling = (next) => async (args, inv) => {
  try {
    return await next(args, inv)
  } catch (error) {
    labelError(error, inv)
    return recover(error, inv)
  }
}

// Reuses a result the Run State already holds for this form and input —
// unless the Run reruns this call — and runs identical calls in flight once.
const withRunState = (next, call, run) => {
  const form = run.forms.calls.get(call.address).hash
  const rerun = run.rerun(call)
  return async (args, inv) => {
    const stored = rerun ? undefined : await run.runState.get(form, inv.input)
    if (stored?.status === 'done') return stored.output

    const key = `${form}/${inv.input}`
    if (!run.inflight.has(key)) {
      run.inflight.set(key, recordResult(next, args, inv, form).finally(() => run.inflight.delete(key)))
    }
    return run.inflight.get(key)
  }
}

async function recordResult(next, args, inv, form) {
  const {call, run} = inv
  const startedAt = new Date()
  const entry = {address: call.address, input: inv.input, inputs: inv.inputs, startedAt: startedAt.toISOString()}
  try {
    const output = await next(args, inv)
    await run.runState.set(form, inv.input, {...entry, status: 'done', output, duration: Date.now() - startedAt})
    return output
  } catch (error) {
    const failure = {message: error.message, attempts: error.attempts ?? 1, at: call.address}
    await run.runState.set(form, inv.input, {...entry, status: 'failed', error: failure, duration: Date.now() - startedAt})
    throw error
  }
}

const parseTimeUnit = (timeStr) => {
  const match = timeStr.match(/^(\d+)([smhDM])$/)
  if (!match) throw new Error(`Invalid time format: ${timeStr}`)
  const [, amount, unit] = match
  const multipliers = {s: 1000, m: 60000, h: 3600000, D: 86400000, M: 2592000000}
  return parseInt(amount) * multipliers[unit]
}

// How long a cached result lasts unless the call or the Query says otherwise.
const DEFAULT_TTL = '7D'

// Reuses a result across Runs while it is younger than the call's ttl. Each
// entry records when it expires, so a store can prune without knowing ttls.
const withCache = (next, call, run) => {
  const form = run.forms.calls.get(call.address).hash
  return async (args, inv) => {
    const store = run.runtime.cache
    const ttl = parseTimeUnit(call.settings.cache.ttl ?? run.compiled.settings.cache?.ttl ?? DEFAULT_TTL)
    const cached = await store.get(form, inv.input)
    if (cached && Date.now() - Date.parse(cached.created) < ttl) return cached.output

    const output = await next(args, inv)
    const created = new Date()
    const expires = new Date(created.getTime() + ttl)
    await store.set(form, inv.input, {input: inv.input, created: created.toISOString(), expires: expires.toISOString(), output})
    return output
  }
}

// Validates a value against the call's schemas for one order (precheck or
// postcheck), in the given designations' order.
function check(value, order, designations, {call, run}) {
  const show = (shown) => run.runtime.inspect(shown, call.settings.inspect)
  for (const designation of designations) {
    const schema = call.validators[order][designation]
    if (!schema) continue
    try {
      validate(schema, value, show)
    } catch (error) {
      error.message = `${designation} ${order} validation failed:\n${error.message}`
      throw error
    }
  }
}

const withPrecheck = (next) => async (args, inv) => {
  check(args, 'precheck', ['query', 'service'], inv)
  return next(args, inv)
}

const withPostcheck = (next) => async (args, inv) => {
  const result = await next(args, inv)
  check(result, 'postcheck', ['service', 'query'], inv)
  return result
}

const hasChecks = (validators, order) => Object.values(validators?.[order] ?? {}).some(Boolean)

const withRateLimit = (next) => async (args, inv) =>
  inv.run.rateLimiters[inv.call.parts.service].push(() => next(args, inv))

const withConcurrency = (next) => async (args, inv) =>
  inv.run.limit(() => next(args, inv))

const withRetry = (next) => async (args, inv) => {
  const {call} = inv
  const retry = call.settings.retry
  for (let attempt = 1; ; attempt++) {
    try {
      return await next(args, inv)
    } catch (error) {
      error.attempts = attempt
      if (attempt > retry) throw error
      console.error(`${labelOf(call)} Failed (attempt ${attempt}/${retry + 1}), retrying...`)
    }
  }
}

const withTimeout = (next) => async (args, inv) => {
  const {timeout} = inv.call.settings
  let timeoutId
  const timedOut = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`Timed out after ${timeout}ms`)), timeout)
  })
  try {
    return await Promise.race([next(args, inv), timedOut])
  } finally {
    clearTimeout(timeoutId)
  }
}

// The positions a call hands its service as functions: all but onError, which
// MicroQL runs itself when the call fails.
const servicePositions = (call) => Object.entries(call.positions).filter(([field]) => field !== 'onError')

// A call that holds other calls (an `each`) doesn't take a concurrency slot,
// or it would starve the calls it is waiting on.
const holdsCalls = (call) => servicePositions(call).length > 0

// The wrappers a call needs, in canonical order, outermost first.
function wrappersFor(call, run) {
  const {settings, validators, noTimeout} = call
  return [
    withArgs,
    settings.debug && withDebug,
    withErrorHandling,
    withRunState,
    settings.cache && withCache,
    hasChecks(validators, 'precheck') && withPrecheck,
    run.rateLimiters[call.parts.service] && withRateLimit,
    run.limit && !holdsCalls(call) && withConcurrency,
    settings.retry > 0 && withRetry,
    hasChecks(validators, 'postcheck') && withPostcheck,
    settings.timeout > 0 && (!noTimeout || call.ownTimeout) && withTimeout
  ].filter(Boolean)
}

// The call's action wrapped in its behaviour: a step `(args, invocation) => result`.
export function wrap(call, run) {
  const action = (args) => call.action.call(call.service, args)
  return wrappersFor(call, run).reduceRight((next, wrapper) => wrapper(next, call, run), action)
}
