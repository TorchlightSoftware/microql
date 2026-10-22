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

// A line to stdout, in colour; or appended to the file `to` names, relative
// to the working directory.
async function log(text, {color, to} = {}) {
  if (to) {
    await mkdir(path.dirname(to), {recursive: true})
    await appendFile(to, `${text}\n`)
    return
  }
  const colorCode = ANSI_COLORS[color] || ''
  const resetCode = colorCode ? ANSI_COLORS.reset : ''
  process.stdout.write(`${colorCode}${text}${resetCode}\n`)
}

// The node runtime: scopes that are Runs, {runId}, logging to stdout or
// files, a Cache on disk and Run States in memory, unless it's given others.
// Services and their config are filed in the empty scope, {}, which every Run
// shares. tearDown() releases the service instances it keeps: for a server
// shutting down, or a test's after(). A script that's done may simply exit
// instead.
export class NodeRuntime extends Runtime {
  constructor({cache = fileStores('.cache'), runStates} = {}) {
    super({scopeSchema: {runId: ['string']}, runKeys: ['runId']})
    this.env = {log}
    this.cache = cache
    if (runStates) this.runStates = runStates
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
// it's done.
export default async function query(config, {runId, ...options} = {}) {
  const runtime = config.runtime ?? nodeRuntime
  const run = {runId: runId ?? randomUUID()}
  const inRun = inScope(config, run)
  await fileConfig(runtime, config.services, config.config)
  try {
    return await coreQuery(inRun, options)
  } finally {
    if (runId === undefined) await release(runtime, run)
  }
}
