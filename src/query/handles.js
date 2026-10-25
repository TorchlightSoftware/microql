/**
 * @fileoverview Handles — resources outside the Query that a call works on.
 *
 * A handle field, `['handle', kind]`, names a resource of a kind the runtime
 * offers, such as a browser session. Its value is a name the Query gives it,
 * and the handle is the service's own, by kind and name, whatever field holds
 * it: two services never share one. A handle belongs to the phase that names
 * it first, since a phase replays as a whole and a later phase can't count on
 * state an earlier one left; compile refuses a literal name two phases use,
 * and a Run refuses a name built from data when a second phase reaches it.
 * Within its phase, calls on one handle run one at a time, in the order they
 * came, and a call that has to wait its turn says so once.
 *
 * What a handle is, MicroQL leaves to the runtime: in its turn, a call asks
 * the scope for its handle, `scope.handles[kind](request)`, and is given
 * what the runtime answers in place of the name. The runtime opens, keeps
 * and closes the resource as it sees fit.
 *
 * Domain:
 *   Request  which handle a call asks for: {service, kind, name, phase}
 *   Handle   what the runtime answers: {service, kind, name}, and what its
 *            kind gives the service to work on the resource with
 */

import {canonical} from './forms.js'
import {getIn, setIn} from '../common/common.js'
import {errorOf} from '../common/error-catalog.js'
import {isReference} from './reference.js'

// The phase a call belongs to, by the address its calls start with: `$name`
// for a phase of the Query, `settings.catch` for its catch.
const phaseOf = (call) => call.path[0] === 'phases' ? `$${call.path[1]}` : call.path.slice(0, 2).join('.')

// Which handle a name in one of a call's handle fields asks for.
const requestOf = (call, field, name) => ({service: call.parts.service, kind: field.handle.kind, name, phase: phaseOf(call)})

// A handle as compile or a Run keeps it: the request that claimed it, and, in
// a Run, the turn its calls wait on and the addresses that have waited.
const handleIn = (request) => ({request, turn: Promise.resolve(), busy: 0, waited: new Set()})

// The handle a name is, claimed for the call's phase: refused when it
// belongs to another phase.
function claim(handles, call, field, name) {
  const request = requestOf(call, field, name)
  const key = canonical([request.service, request.kind, name])
  if (!handles.has(key)) handles.set(key, handleIn(request))
  const handle = handles.get(key)
  if (handle.request.phase !== request.phase) {
    throw errorOf('shared-handle', {key: call.key, field: field.path, value: name, phases: [handle.request.phase, request.phase]})
  }
  return handle
}

// The name a call's handle field holds as written: its literal, or its
// declared default; nothing when it's a reference, known only as it runs.
function writtenName(call, field) {
  const value = getIn(call.args, field.segments)
  if (value === undefined) return field.declaredType.safeParse(undefined).data
  return typeof value === 'string' && isReference(value) ? undefined : value
}

/**
 * Claims, for its phase, every handle a call names as written, and fails on
 * one another phase already claimed, placed at the call by `atSite`.
 * Compile's check, over the calls of a Query in the order they were compiled:
 * the requests for the handles it knows before a Run.
 */
export function claimWritten(calls, atSite) {
  const handles = new Map()
  for (const call of calls) {
    for (const field of call.declaration.handles) {
      const name = writtenName(call, field)
      if (name === undefined) continue
      try {
        claim(handles, call, field, name)
      } catch (error) {
        throw atSite(call, error)
      }
    }
  }
  return [...handles.values()].map(handle => handle.request)
}

// Runs start once the calls before it on the handle are done, whether they
// succeeded or not; a call that has to wait says so, once for its address.
function inTurn(handle, call, log, start) {
  if (handle.busy && !handle.waited.has(call.address)) {
    handle.waited.add(call.address)
    log(`[${call.address}] waits its turn on ${call.key}'s '${handle.request.name}': calls on one handle run one at a time.`, {level: 'warn'})
  }
  handle.busy++
  const done = handle.turn.then(start)
  handle.turn = done.then(() => {}, () => {}).finally(() => handle.busy--)
  return done
}

// A call's arguments with each handle field's name replaced by the handle
// the scope answers for it.
async function withHandlesGiven(args, named, scope) {
  let given = args
  for (const {field, handle: {request}} of named) {
    given = setIn(given, field.segments, await scope.handles[request.kind](request))
  }
  return given
}

/**
 * Runs a call on its handles (the names its handle fields hold, as parsed),
 * once its turn on each comes, with each handle given in place of its name:
 * the handles a Run keeps, claimed for the call's phase as it goes, asked of
 * the scope it runs in.
 */
export function onHandles(handles, call, args, scope, start) {
  const named = call.declaration.handles.map(field => ({field, handle: claim(handles, call, field, getIn(args, field.segments))}))
  const run = named.reduceRight(
    (next, {handle}) => () => inTurn(handle, call, scope.env.log, next),
    async () => start(await withHandlesGiven(args, named, scope))
  )
  return run()
}
