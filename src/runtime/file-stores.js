/**
 * @fileoverview The entry stores the node runtime keeps on disk: fileStore,
 * and fileStores, one per scope, which the Cache and Run States are made of.
 * Node only, like index.js, which exports them.
 */

import path from 'node:path'
import {mkdir, readFile, readdir, rm, writeFile} from 'node:fs/promises'
import {hashOf} from '../query/forms.js'
import {scopedStores} from './runtime.js'

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

// Entry stores on disk, one fileStore per scope, in a directory named by the
// scope's hash: the Cache by tenant, or Run States by Run, as the runtime
// keys them. Clearing with no scope empties the whole directory, scopes this
// process hasn't used included.
export function fileStores(dir) {
  const stores = scopedStores(scope => fileStore(path.join(dir, hashOf(scope))))
  return {
    ...stores,
    clear: (scope, form) => scope === undefined ? rm(dir, {recursive: true, force: true}) : stores.clear(scope, form)
  }
}
