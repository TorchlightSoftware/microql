/**
 * @fileoverview The entry stores the node runtime keeps on disk: fileStore,
 * and the Cache and Run States made of them, one directory per scope (and
 * per Run). Node only, like index.js, which exports them.
 */

import path from 'node:path'
import {mkdir, readFile, readdir, rm, writeFile} from 'node:fs/promises'
import {hashOf} from '../query/forms.js'
import {scopedCache, scopedRunStates} from './runtime.js'

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

// Scoped stores on disk, whose clearing with no scope empties the whole
// directory, scopes this process hasn't used included.
const clearingDir = (dir, stores) => ({
  ...stores,
  clear: (scope, ...rest) => scope === undefined ? rm(dir, {recursive: true, force: true}) : stores.clear(scope, ...rest)
})

// A Cache on disk: a fileStore per scope, in a directory named by the
// scope's hash.
export const fileCache = (dir) => clearingDir(dir, scopedCache(scope => fileStore(path.join(dir, hashOf(scope)))))

// Run States on disk: a fileStore per Run, in a directory named by the Run's
// id, within one named by its scope's hash.
export const fileRunStates = (dir) => clearingDir(dir, scopedRunStates((scope, runId) => fileStore(path.join(dir, hashOf(scope), runId))))
