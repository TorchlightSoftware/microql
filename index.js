/**
 * @fileoverview MicroQL for node — core plus the node runtime, wired by default.
 *
 * The node runtime logs in colour to stdout, or appends to the file a log
 * names with `to:`, keeps the Cache in a `.cache` directory (fileStores), and
 * Run States in memory; `fileStores` keeps them on disk instead, for Runs that
 * should survive the process. Its scopes are Runs, {runId}, and nothing else:
 * a Query brings its services, and their config, and query() files them for
 * every Run before it runs. Each Run has its own instances: query() releases
 * those of a Run it named itself once it's done, and `nodeRuntime.tearDown()`
 * releases those of the Runs a caller named.
 *
 * The node runtime has a browser, for handles of kind browser: the one at the
 * CDP endpoint it's given, `new NodeRuntime({browser: 'ws://…'})`; or, given
 * none, a headless Chrome that Puppeteer (an optional peer dependency)
 * launches on first use, when it's installed, and tearDown() closes. query()
 * closes a Run's browser sessions once it's done, whether the caller named
 * the Run or not.
 */

import path from 'node:path'
import {randomUUID} from 'node:crypto'
import {appendFile, mkdir} from 'node:fs/promises'
import coreQuery from './src/query/query.js'
import coreCompile from './src/query/compile.js'
import {plan as corePlan} from './src/types/plan.js'
import {Runtime} from './src/runtime/runtime.js'
import {fileStores} from './src/runtime/file-stores.js'

export * from './core.js'
export {fileStore, fileStores} from './src/runtime/file-stores.js'

export const ANSI_COLORS = {
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  reset: '\x1b[0m'
}

// Where a line of each OpenTelemetry severity goes, and its colour unless the
// log names one: warnings and worse to stderr, the rest (trace, debug, info,
// or none) to stdout.
const SEVERITIES = {
  warn: {stream: 'stderr', color: 'yellow'},
  error: {stream: 'stderr', color: 'red'},
  fatal: {stream: 'stderr', color: 'red'}
}

// A line to stdout or stderr by its level, in colour; or appended to the
// file `to` names, relative to the working directory.
async function log(text, {color, to, level} = {}) {
  if (to) {
    await mkdir(path.dirname(to), {recursive: true})
    await appendFile(to, `${text}\n`)
    return
  }
  const severity = SEVERITIES[level] ?? {stream: 'stdout'}
  const colorCode = ANSI_COLORS[color ?? severity.color] || ''
  const resetCode = colorCode ? ANSI_COLORS.reset : ''
  process[severity.stream].write(`${colorCode}${text}${resetCode}\n`)
}

// Whether Puppeteer is installed, where this module can import it from.
function canImport(specifier) {
  try {
    import.meta.resolve(specifier)
    return true
  } catch {
    return false
  }
}

// A CDP transport over a WebSocket to a browser's endpoint, once it's open;
// closing it closes the socket, or does what close does instead.
function socketTransport(url, close) {
  const socket = new WebSocket(url)
  const transport = {send: (text) => socket.send(text), close: close ?? (() => socket.close())}
  socket.addEventListener('message', (event) => transport.onmessage?.(event.data))
  socket.addEventListener('close', () => transport.onclose?.())
  return new Promise((resolve, reject) => {
    socket.addEventListener('open', () => resolve(transport), {once: true})
    socket.addEventListener('error', reject, {once: true})
  })
}

// A headless Chrome that Puppeteer launches for each connection to it, and
// closes with the connection.
async function launchedChrome() {
  const {default: puppeteer} = await import('puppeteer')
  const chrome = await puppeteer.launch({headless: true})
  return socketTransport(chrome.wsEndpoint(), () => chrome.close())
}

// The node runtime's browser, as a way to connect to it: the one at the
// endpoint it's given, or one Puppeteer launches, when it's installed.
function browserAt(endpoint) {
  if (endpoint) return () => socketTransport(endpoint)
  if (canImport('puppeteer')) return launchedChrome
}

// The node runtime: scopes that are Runs, {runId}, logging to stdout or
// files, a Cache on disk and Run States in memory, unless it's given others.
// Services and their config are filed in the empty scope, {}, which every Run
// shares. Its browser is at the CDP endpoint it's given, or else one
// Puppeteer launches. tearDown() releases the service instances it keeps and
// lets go of its browser: for a server shutting down, or a test's after(). A
// script that's done may simply exit instead.
export class NodeRuntime extends Runtime {
  constructor({cache = fileStores('.cache'), runStates, browser} = {}) {
    super({scopeSchema: {runId: ['string']}, runKeys: ['runId']})
    this.env = {log}
    this.cache = cache
    if (runStates) this.runStates = runStates
    this.browser = browserAt(browser)
  }
}

// The runtime query(), plan() and compile() use when a Query brings none.
export const nodeRuntime = new NodeRuntime()

// What the node runtime files services and config by: every Run's.
const EVERY_RUN = {}

// Files the services a Query brings as the runtime's only ones.
function fileServices(runtime, services = {}) {
  for (const name of Object.keys(runtime.services.list(EVERY_RUN))) {
    if (!Object.hasOwn(services, name)) runtime.services.unregister(EVERY_RUN, name)
  }
  for (const [name, service] of Object.entries(services)) runtime.services.register(EVERY_RUN, name, service)
}

// Files the config a Query brings, by service name, as each service's only
// config: a service the Query brings no config for has none.
async function fileConfig(runtime, services = {}, config = {}) {
  for (const [name, value] of Object.entries(config)) await runtime.config.set(EVERY_RUN, name, value)
  for (const name of Object.keys(services)) {
    if (!Object.hasOwn(config, name)) await runtime.config.delete(EVERY_RUN, name)
  }
}

// The Query in a scope of its runtime (the node runtime unless it brings its
// own), with the services it brings filed there: a Run's scope, or one to plan in.
function inScope({services, config: _config, runtime = nodeRuntime, ...query}, scope = EVERY_RUN) {
  fileServices(runtime, services)
  return {...query, scope: runtime.scopeOf(scope)}
}

export const compile = (config) => coreCompile(inScope(config))

export const plan = (query, options) => corePlan(inScope(query), options)

// Forgets a Run: its Run State, and the instances it made.
async function release(runtime, run) {
  await runtime.runStates.clear(run)
  await runtime.tearDown(run)
}

// A Query run with its services and config, on the node runtime unless it
// brings its own. The caller names the Run with runId, to resume it or read
// its Run State afterwards; given none, it's a Run of its own, released once
// it's done. Either way, the Run's handles are closed once it's done: a Run
// resumed starts on fresh ones.
export default async function query(config, {runId, ...options} = {}) {
  const runtime = config.runtime ?? nodeRuntime
  const run = {runId: runId ?? randomUUID()}
  const inRun = inScope(config, run)
  await fileConfig(runtime, config.services, config.config)
  try {
    return await coreQuery(inRun, options)
  } finally {
    await runtime.closeHandles(run)
    if (runId === undefined) await release(runtime, run)
  }
}
