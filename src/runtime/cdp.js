/**
 * @fileoverview CDP — the Chrome DevTools Protocol, spoken over a transport.
 *
 * A transport is a connection to a browser's CDP endpoint, in the shape
 * Puppeteer calls a ConnectionTransport: `send(text)` and `close()`, and the
 * `onmessage(text)` and `onclose()` it calls. A runtime opens one however its
 * platform reaches a browser (a WebSocket, a Worker binding); closing it lets
 * go of the browser. This speaks the protocol over it, with no dependencies.
 *
 * Domain:
 *   Connection  the browser-wide connection: commands answered by id, events
 *               delivered by method, each to the session it's for. The
 *               runtime's alone: services never see it
 *   Page        a browser session, the resource of a handle of kind browser:
 *               a page of its own, in a browser context of its own (its own
 *               cookies and storage), attached flat, so its commands and
 *               events carry its session id. Plain data: its ids, and the
 *               sessions of its frames that run out of its process
 *   Frame       a document within a page, in an iframe. Chrome runs a
 *               cross-site one in a process of its own, reached through a
 *               session of its own, whose target id is its frame id; any
 *               other runs in the process of the frame holding it
 */

/**
 * The handlers of a connection's events, by the session they're for and
 * their method. A session's handlers go when it's detached, with those of
 * the sessions attached through it, since no more of their events will come.
 */
export function sessionHandlers() {
  const bySession = new Map()
  const attachedThrough = new Map()

  const drop = (sessionId) => {
    bySession.delete(sessionId)
    for (const child of attachedThrough.get(sessionId) ?? []) drop(child)
    attachedThrough.delete(sessionId)
  }

  return {
    add(sessionId, method, handler) {
      if (!bySession.has(sessionId)) bySession.set(sessionId, new Map())
      const methods = bySession.get(sessionId)
      if (!methods.has(method)) methods.set(method, new Set())
      methods.get(method).add(handler)
      return () => methods.get(method).delete(handler)
    },
    deliver({sessionId, method, params}) {
      for (const handler of bySession.get(sessionId)?.get(method) ?? []) handler(params)
      if (method === 'Target.attachedToTarget') {
        if (!attachedThrough.has(sessionId)) attachedThrough.set(sessionId, new Set())
        attachedThrough.get(sessionId).add(params.sessionId)
      }
      if (method === 'Target.detachedFromTarget') {
        attachedThrough.get(sessionId)?.delete(params.sessionId)
        drop(params.sessionId)
      }
    }
  }
}

/**
 * The CDP connection to a browser, over the transport `dial()` opens: dialled
 * on its first command, and again after one that failed or closed.
 * `send(method, params, sessionId)` answers with the command's result, or
 * fails with its error; `on(method, handler, sessionId)` hands each such
 * event's params to the handler, and returns what stops it; `close()` closes
 * the transport, if it was dialled. Commands still waiting when the transport
 * closes fail.
 */
export function cdpConnection(dial) {
  const waiting = new Map()
  const handlers = sessionHandlers()
  let lastId = 0
  let transport

  const answer = ({id, result, error}) => {
    const {method, resolve, reject} = waiting.get(id)
    waiting.delete(id)
    if (error) reject(new Error(`${method}: ${error.message}`))
    else resolve(result)
  }

  const listen = (opened) => {
    opened.onmessage = (text) => {
      const message = JSON.parse(text)
      if (message.id !== undefined) return answer(message)
      handlers.deliver(message)
    }
    opened.onclose = () => {
      transport = undefined
      for (const {method, reject} of waiting.values()) reject(new Error(`${method}: the browser connection closed`))
      waiting.clear()
    }
    return opened
  }

  const dialled = () => {
    transport ??= dial().then(listen).catch((error) => {
      transport = undefined
      throw error
    })
    return transport
  }

  return {
    async send(method, params = {}, sessionId) {
      const opened = await dialled()
      const id = ++lastId
      return new Promise((resolve, reject) => {
        waiting.set(id, {method, resolve, reject})
        opened.send(JSON.stringify({id, method, params, ...(sessionId && {sessionId})}))
      })
    },
    on(method, handler, sessionId) {
      return handlers.add(sessionId, method, handler)
    },
    async close() {
      const opened = transport
      transport = undefined
      if (opened) await (await opened).close()
    }
  }
}

/**
 * Attaches, flat, each frame Chrome runs out of a session's process as it
 * starts, and those out of each one's process in turn, keeping each one's
 * session by its frame id until it's detached.
 */
async function attachFrames(connection, sessionId, frames) {
  connection.on('Target.attachedToTarget', ({sessionId: frame, targetInfo}) => {
    frames.set(targetInfo.targetId, frame)
    // a frame detached before it's answered has no frames left to attach
    attachFrames(connection, frame, frames).catch(() => {})
  }, sessionId)
  connection.on('Target.detachedFromTarget', ({targetId}) => frames.delete(targetId), sessionId)
  await connection.send('Target.setAutoAttach', {autoAttach: true, waitForDebuggerOnStart: false, flatten: true, filter: [{type: 'iframe'}]}, sessionId)
}

/**
 * A browser session, opened on a connection: a page of its own, in a browser
 * context of its own, attached flat. Its ids: the session's, which its
 * commands carry, and the page's and context's, which close it; and its
 * frames' sessions, by frame id, for those Chrome runs out of its process.
 */
export async function openPage(connection) {
  const {browserContextId} = await connection.send('Target.createBrowserContext')
  const {targetId} = await connection.send('Target.createTarget', {url: 'about:blank', browserContextId})
  const {sessionId} = await connection.send('Target.attachToTarget', {targetId, flatten: true})
  const frames = new Map()
  await attachFrames(connection, sessionId, frames)
  return {sessionId, targetId, browserContextId, frames}
}

// Closes a browser session's page, and disposes of its context, with its
// cookies and storage.
export async function closePage(connection, {targetId, browserContextId}) {
  await connection.send('Target.closeTarget', {targetId})
  await connection.send('Target.disposeBrowserContext', {browserContextId})
}

/**
 * CDP confined to one session of a page: what a browser handle gives its
 * service. `send(method, params)` and `on(method, handler)` speak to that
 * session only; `frame(frameId)` is CDP confined to the session a frame
 * within it runs in: the frame's own, when Chrome runs it out of this
 * session's process, or else this one.
 */
export const confinedTo = (connection, {sessionId, frames}) => ({
  send: (method, params) => connection.send(method, params, sessionId),
  on: (method, handler) => connection.on(method, handler, sessionId),
  frame: (frameId) => confinedTo(connection, {sessionId: frames.get(frameId) ?? sessionId, frames})
})
