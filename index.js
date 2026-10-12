/**
 * @fileoverview MicroQL for node — core plus the node runtime, wired by default.
 *
 * The node runtime prints in colour to stdout, inspects with util.inspect,
 * writes each failure to a JSON file, and keeps the Cache in a `.cache`
 * directory. `fileStore` is the same entry store on disk, for a Run State
 * that should survive the process.
 */

import {inspect} from 'node:util'
import path from 'node:path'
import {mkdir, readFile, readdir, rm, writeFile} from 'node:fs/promises'
import coreQuery from './query.js'
import {memoryStore} from './runtime.js'

export * from './core.js'

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

const readJson = async (file) => {
  try {
    return JSON.parse(await readFile(file, 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') return undefined
    throw error
  }
}

// The files in a directory; none when it doesn't exist yet.
const filesIn = async (dir) => {
  try {
    return await readdir(dir)
  } catch (error) {
    if (error.code === 'ENOENT') return []
    throw error
  }
}

const isExpired = (entry) => entry?.expires !== undefined && Date.parse(entry.expires) <= Date.now()

// Deletes the entries past their `expires` time. Run State entries have none.
async function sweep(dir) {
  for (const form of await filesIn(dir)) {
    for (const file of await filesIn(path.join(dir, form))) {
      const entryFile = path.join(dir, form, file)
      if (isExpired(await readJson(entryFile))) await rm(entryFile, {force: true})
    }
  }
}

// An entry store on disk: one directory per form, one file per input. Expired
// entries are swept once, before the store's first use.
export function fileStore(dir) {
  const fileOf = (form, input) => path.join(dir, form, `${input}.json`)
  let swept
  const ready = () => (swept ??= sweep(dir))

  return {
    sweep: ready,
    async get(form, input) {
      await ready()
      return readJson(fileOf(form, input))
    },
    async set(form, input, entry) {
      await ready()
      await mkdir(path.join(dir, form), {recursive: true})
      await writeFile(fileOf(form, input), JSON.stringify(entry, null, 2))
    },
    async list(form) {
      await ready()
      const files = await filesIn(path.join(dir, form))
      return Promise.all(files.map(file => readJson(path.join(dir, form, file))))
    },
    // not part of what core calls: the owner's way to empty one form, or all
    async clear(form) {
      await rm(form === undefined ? dir : path.join(dir, form), {recursive: true, force: true})
    }
  }
}

function print(text, {color} = {}) {
  const colorCode = ANSI_COLORS[color] || ''
  const resetCode = colorCode ? ANSI_COLORS.reset : ''
  process.stdout.write(`${colorCode}${text}${resetCode}\n`)
}

async function recordFailure(location, record) {
  await mkdir(location, {recursive: true})
  const filePath = path.join(location, `failure-${Date.now()}.json`)
  await writeFile(filePath, JSON.stringify(record, null, 2))
  console.error(`❌ Failure recorded: ${path.relative(process.cwd(), filePath)}`)
}

export const nodeRuntime = {
  print,
  inspect,
  recordFailure,
  cache: fileStore('.cache')
}

// A Query run with the node runtime, and a fresh Run State in memory, unless
// the caller passes its own.
export default function query(config, options) {
  return coreQuery({runtime: nodeRuntime, ...config}, {runState: memoryStore(), ...options})
}
