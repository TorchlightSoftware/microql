/**
 * @fileoverview MicroQL for node — core plus the node runtime, wired by default.
 *
 * The node runtime logs in colour to stdout, or appends to the file a log
 * names with `to:`, keeps the Cache in a `.cache` directory (fileCache), and
 * Run States in memory; `fileRunStates` keeps them on disk instead, for Runs
 * that should survive the process. The node runtime has one scope, the empty one: a Query brings its
 * services, and their config, and query() files them there before it runs.
 * It keeps each service's instance across Queries, and `nodeRuntime.tearDown()`
 * releases them when their owner is done with them.
 */

import path from 'node:path'
import {randomUUID} from 'node:crypto'
import {appendFile, mkdir} from 'node:fs/promises'
import coreQuery from './src/query/query.js'
import coreCompile from './src/query/compile.js'
import {plan as corePlan} from './src/types/plan.js'
import {Runtime} from './src/runtime/runtime.js'
import {fileCache} from './src/runtime/file-stores.js'

export * from './core.js'
export {fileStore, fileCache, fileRunStates} from './src/runtime/file-stores.js'

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

// The node runtime: one scope, the empty one, logging to stdout or files, a
// Cache on disk and Run States in memory, unless it's given others. tearDown() releases the service
// instances it keeps: for a server shutting down, or a test's after(). A
// script that's done may simply exit instead.
export class NodeRuntime extends Runtime {
  constructor({cache = fileCache('.cache'), runStates} = {}) {
    super()
    this.env = {log}
    this.cache = cache
    if (runStates) this.runStates = runStates
  }
}

// The runtime query(), plan() and compile() use when a Query brings none.
export const nodeRuntime = new NodeRuntime()

// The Query on its runtime (the node runtime unless it brings its own), with
// the services it brings filed in its scope as the scope's only services.
function withServices({services = {}, config: _config, ...query}) {
  const runtime = query.runtime ?? nodeRuntime
  const scope = query.scope ?? {}
  for (const name of Object.keys(runtime.services.list(scope))) {
    if (!Object.hasOwn(services, name)) runtime.services.unregister(scope, name)
  }
  for (const [name, service] of Object.entries(services)) runtime.services.register(scope, name, service)
  return {...query, runtime, scope}
}

// Files the config a Query brings, by service name, as each service's only
// config: a service the Query brings no config for has none.
async function fileConfig({runtime, scope}, services = {}, config = {}) {
  for (const [name, value] of Object.entries(config)) await runtime.config.set(scope, name, value)
  for (const name of Object.keys(services)) {
    if (!Object.hasOwn(config, name)) await runtime.config.delete(scope, name)
  }
}

export const compile = (config) => coreCompile(withServices(config))

export const plan = (query, options) => corePlan(withServices(query), options)

// A Query run with its services and config, on the node runtime unless it
// brings its own. The caller names the Run with runId, to resume it or read
// its Run State afterwards; given none, it's a Run of its own, whose Run
// State is released once it's done.
export default async function query(config, {runId, ...options} = {}) {
  const onRuntime = withServices(config)
  await fileConfig(onRuntime, config.services, config.config)
  if (runId !== undefined) return coreQuery(onRuntime, {runId, ...options})
  const ownRun = randomUUID()
  try {
    return await coreQuery(onRuntime, {runId: ownRun, ...options})
  } finally {
    await onRuntime.runtime.runStates.clear(onRuntime.scope, ownRun)
  }
}
