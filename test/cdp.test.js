/**
 * CDP: the handlers of a connection's events, by the session each is for.
 * Events are delivered as CDP sends them, {sessionId, method, params}; a
 * session's handlers go when it's detached, with those of the sessions
 * attached through it.
 */
import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import {sessionHandlers} from '../src/runtime/cdp.js'

// Handlers that keep what each is handed, by the session they're for.
function listening(sessions) {
  const handlers = sessionHandlers()
  const heard = Object.fromEntries(sessions.map(session => [session, []]))
  for (const session of sessions) handlers.add(session, 'Page.loadEventFired', (params) => heard[session].push(params))
  return {handlers, heard}
}

const load = (sessionId, at) => ({sessionId, method: 'Page.loadEventFired', params: {at}})
const attached = (sessionId, child) => ({sessionId, method: 'Target.attachedToTarget', params: {sessionId: child, targetInfo: {targetId: child}}})
const detached = (sessionId, child) => ({sessionId, method: 'Target.detachedFromTarget', params: {sessionId: child, targetId: child}})

describe('a connection\'s event handlers', () => {
  it('hand each event to the handlers of its session and method only', () => {
    const {handlers, heard} = listening(['page', 'other'])
    handlers.deliver(load('page', 1))
    handlers.deliver({sessionId: 'page', method: 'Page.frameNavigated', params: {}})
    assert.deepEqual(heard, {page: [{at: 1}], other: []})
  })

  it('stop a handler when told to', () => {
    const handlers = sessionHandlers()
    const heard = []
    const stop = handlers.add('page', 'Page.loadEventFired', (params) => heard.push(params))
    handlers.deliver(load('page', 1))
    stop()
    handlers.deliver(load('page', 2))
    assert.deepEqual(heard, [{at: 1}])
  })

  it('go when their session is detached, with those of the sessions attached through it', () => {
    const {handlers, heard} = listening(['page', 'frame', 'nested', 'other'])
    handlers.deliver(attached('page', 'frame'))
    handlers.deliver(attached('frame', 'nested'))
    handlers.deliver(detached(undefined, 'page'))
    for (const session of ['page', 'frame', 'nested', 'other']) handlers.deliver(load(session, 1))
    assert.deepEqual(heard, {page: [], frame: [], nested: [], other: [{at: 1}]})
  })

  it('hand a frame\'s detaching to the session it was attached through, and drop the frame\'s', () => {
    const handlers = sessionHandlers()
    const heard = []
    handlers.add('page', 'Target.detachedFromTarget', ({targetId}) => heard.push(targetId))
    handlers.add('frame', 'Page.loadEventFired', () => heard.push('frame loaded'))
    handlers.deliver(attached('page', 'frame'))
    handlers.deliver(detached('page', 'frame'))
    handlers.deliver(load('frame', 1))
    assert.deepEqual(heard, ['frame'])
  })
})
