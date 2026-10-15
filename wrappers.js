/**
 * @fileoverview Wrappers — the behaviour around every service call.
 *
 * Each wrapper takes the next step, plus the call and Run it is built for,
 * and returns a step of the same shape, `(args, invocation) => result`, where
 * an invocation is {call, scope, run}. A pipeline is built once per call per
 * Run, so what depends only on the call is worked out then, not per execution.
 * They are applied in canonical order, outermost first:
 *
 *   arguments → debug → error label → run state → cache → precheck
 *   → rate limit → concurrency → retry → postcheck → timeout → the operation
 *
 * A failure is thrown, labelled with the innermost call that raised it, until
 * a catch handles it. A call's catch wraps each invocation of the calls it
 * holds, not the call itself: the handler's result takes the failed
 * invocation's place, and the holding call carries on. Retry sits inside, so
 * a catch sees only failures that outlasted their retries.
 *
 * The Run State and the Cache record only successes, and sit outside
 * validation, so a reused result was already checked.
 * A postcheck failure is retried like any other — a model's next answer may
 * fit — while a precheck failure isn't, since no attempt changes the arguments.
 */

import {mapReferences, parseReference, resolveReference, resolveRead} from './reference.js'
import {VALIDATION_NAMES, getServiceColorName, mapValues, defaults, setPaths} from './common.js'
import {hashOf} from './forms.js'
import {validate} from 'zodly'
import {format} from './format.js'
import {toErrorData} from './errors.js'


// A call's label in errors and logs: its address and service key.
const labelOf = (call) => `[${call.address} - ${call.key}]`

// Arguments with every reference replaced by its value; a reference that
// names nothing resolves to undefined.
export const resolveArgs = (value, scope, nodes) =>
  mapReferences(value, text => resolveReference(parseReference(text), scope, nodes))

// What a catch makes of a failure: the handler's result, given the failure as
// error data, and the item whose call failed, if any. Without a handler, or
// once the Run is aborted, the failure stands.
export const catchWith = (handler, scope, run, item) => (error) => {
  if (!handler || run.signal?.aborted) throw error
  return run.runPosition(handler, scope, toErrorData(error), item)
}

// The input hash: of the call's fields, and of what the calls it holds read
// from outside it, when they read anything.
const inputHash = (inputs, reads) => Object.keys(reads).length ? hashOf({inputs, reads}) : hashOf(inputs)

// Resolves the call's data and its closure, injects settings-tagged fields,
// and hands each call field over as a function of its input, each at its field
// path. Each invocation's failure goes to the call's catch.
const withArgs = (next, call) => {
  const positions = servicePositions(call)
  return async (_args, inv) => {
    const {scope, run} = inv
    const data = resolveArgs(call.args, scope, run.nodes)
    const settingsArgs = mapValues(resolveArgs(call.settingsArgs, scope, run.nodes),
      value => defaults(value, call.settings))
    const services = Object.fromEntries(positions.map(([field, position]) =>
      [field, (input) => run.runPosition(position, scope, input).catch(catchWith(call.positions.catch, scope, run, input))]))

    inv.inputs = setPaths(data, settingsArgs)
    inv.reads = Object.fromEntries(call.closure.map(read => [read.key, resolveRead(read, scope, run.nodes)]))
    inv.input = inputHash(inv.inputs, inv.reads)
    return next(setPaths(inv.inputs, services), inv)
  }
}

const withDebug = (next) => async (args, inv) => {
  const {call, run} = inv
  const {settings} = call
  const color = getServiceColorName(call.parts.service)
  const show = (value) => format(value, settings.inspect)
  const startTime = Date.now()

  run.runtime.log(`${labelOf(call)} Called with args:\n${show(inv.inputs)}`, {color})
  const result = await next(args, inv)
  run.runtime.log(`${labelOf(call)} Completed in ${Date.now() - startTime}ms returning:\n${show(result)}`, {color})
  return result
}

// Labels an error with the call that raised it, once: the innermost call wins.
// The address means something only in its Query version (queryHash); the
// call's form hash finds its entries in the Run State and the Cache.
function labelError(error, inv) {
  if (error.address) return
  const {call, run} = inv
  error.message = `${labelOf(call)} ${error.message}`
  error.address = call.address
  error.key = call.key
  error.queryHash = run.forms.queryHash
  error.formHash = run.forms.calls.get(call.address).hash
  error.args = inv.inputs
}

// an aborted Run labels nothing: the abort passes through untouched
const withErrorLabel = (next) => (args, inv) => next(args, inv).catch(error => {
  if (!inv.run.signal?.aborted) labelError(error, inv)
  throw error
})

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
  const entry = {address: call.address, input: inv.input, inputs: inv.inputs, ...(call.closure.length && {reads: inv.reads}), startedAt: startedAt.toISOString()}
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
function check(value, order, designations, {call}) {
  const show = (shown) => format(shown, call.settings.inspect)
  for (const designation of designations) {
    const schema = call.validators[order][designation]
    if (!schema) continue
    try {
      validate(schema, value, show)
    } catch (error) {
      error.message = `${VALIDATION_NAMES[designation]} ${order} failed:\n${error.message}`
      throw error
    }
  }
}

const withPrecheck = (next) => async (args, inv) => {
  check(args, 'precheck', ['call', 'schema'], inv)
  return next(args, inv)
}

const withPostcheck = (next) => async (args, inv) => {
  const result = await next(args, inv)
  check(result, 'postcheck', ['schema', 'call'], inv)
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

// The positions a call hands its service as functions: all but catch, which
// MicroQL runs itself when one of them fails.
const servicePositions = (call) => Object.entries(call.positions).filter(([field]) => field !== 'catch')

// A call that holds other calls (an `each`) doesn't take a concurrency slot,
// or it would starve the calls it is waiting on, and has no timeout of its
// own unless it sets one: the calls it holds have theirs.
const holdsCalls = (call) => servicePositions(call).length > 0

// The wrappers a call needs, in canonical order, outermost first.
function wrappersFor(call, run) {
  const {settings, validators} = call
  return [
    withArgs,
    settings.debug && withDebug,
    withErrorLabel,
    withRunState,
    settings.cache && withCache,
    hasChecks(validators, 'precheck') && withPrecheck,
    run.rateLimiters[call.parts.service] && withRateLimit,
    run.limit && !holdsCalls(call) && withConcurrency,
    settings.retry > 0 && withRetry,
    hasChecks(validators, 'postcheck') && withPostcheck,
    settings.timeout > 0 && (!holdsCalls(call) || call.ownTimeout) && withTimeout
  ].filter(Boolean)
}

// The call's operation wrapped in its behaviour: a step `(args, invocation) => result`.
export function wrap(call, run) {
  const operation = (args) => call.operation.call(args)
  return wrappersFor(call, run).reduceRight((next, wrapper) => wrapper(next, call, run), operation)
}
