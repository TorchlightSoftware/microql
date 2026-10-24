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
 *               events carry its session id. Plain data: its ids
 */

// Where an event's handlers are kept: by the session it's for, and its method.
const eventKey = (sessionId, method) => `${sessionId ?? ''} ${method}`

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
  const handlers = new Map()
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
      for (const handler of handlers.get(eventKey(message.sessionId, message.method)) ?? []) handler(message.params)
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
      const key = eventKey(sessionId, method)
      if (!handlers.has(key)) handlers.set(key, new Set())
      handlers.get(key).add(handler)
      return () => handlers.get(key).delete(handler)
    },
    async close() {
      const opened = transport
      transport = undefined
      if (opened) await (await opened).close()
    }
  }
}

/**
 * A browser session, opened on a connection: a page of its own, in a browser
 * context of its own, attached flat. Its ids: the session's, which its
 * commands carry, and the page's and context's, which close it.
 */
export async function openPage(connection) {
  const {browserContextId} = await connection.send('Target.createBrowserContext')
  const {targetId} = await connection.send('Target.createTarget', {url: 'about:blank', browserContextId})
  const {sessionId} = await connection.send('Target.attachToTarget', {targetId, flatten: true})
  return {sessionId, targetId, browserContextId}
}

// Closes a browser session's page, and disposes of its context, with its
// cookies and storage.
export async function closePage(connection, {targetId, browserContextId}) {
  await connection.send('Target.closeTarget', {targetId})
  await connection.send('Target.disposeBrowserContext', {browserContextId})
}

// CDP confined to one session: what a browser handle gives its service.
// `send(method, params)` and `on(method, handler)` speak to that session only.
export const confinedTo = (connection, sessionId) => ({
  send: (method, params) => connection.send(method, params, sessionId),
  on: (method, handler) => connection.on(method, handler, sessionId)
})
