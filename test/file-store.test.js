import assert from 'node:assert/strict'
import {describe, it, beforeEach} from 'node:test'
import {rm, readdir} from 'node:fs/promises'
import {fileStore, memoryStore} from '../node.js'

const DIR = '.cache-test-file-store'
const hour = 3600000
const entry = (input, expiresIn) => ({input, output: input, expires: new Date(Date.now() + expiresIn).toISOString()})

describe('fileStore', () => {
  beforeEach(() => rm(DIR, {recursive: true, force: true}))

  it('keeps one directory per form and one file per input', async () => {
    const store = fileStore(DIR)
    await store.set('form-a', 'one', entry('one', hour))
    await store.set('form-a', 'two', entry('two', hour))

    assert.deepEqual(await readdir(DIR), ['form-a'])
    assert.deepEqual((await readdir(`${DIR}/form-a`)).sort(), ['one.json', 'two.json'])
    assert.equal((await store.get('form-a', 'one')).output, 'one')
    assert.equal(await store.get('form-a', 'missing'), undefined)
    assert.deepEqual((await store.list('form-a')).map(e => e.output).sort(), ['one', 'two'])
  })

  it('sweeps expired entries, keeping the rest and entries with no expiry', async () => {
    const writer = fileStore(DIR)
    await writer.set('form-a', 'stale', entry('stale', -hour))
    await writer.set('form-a', 'fresh', entry('fresh', hour))
    await writer.set('form-b', 'run-state', {input: 'run-state', status: 'done'})

    await fileStore(DIR).sweep()

    assert.deepEqual((await readdir(`${DIR}/form-a`)).sort(), ['fresh.json'])
    assert.deepEqual(await readdir(`${DIR}/form-b`), ['run-state.json'])
  })

  it('sweeps once, on first use', async () => {
    const writer = fileStore(DIR)
    await writer.set('form-a', 'stale', entry('stale', -hour))

    const store = fileStore(DIR)
    assert.equal(await store.get('form-a', 'stale'), undefined, 'the sweep runs before the first read')
    await store.set('form-a', 'stale', entry('stale', -hour))
    assert.notEqual(await store.get('form-a', 'stale'), undefined, 'and only once')
  })

  it('sweeps a directory that does not exist yet', async () => {
    await fileStore(DIR).sweep()
  })
})

// The stores MicroQL ships, each emptied before a test.
const stores = [
  ['memoryStore', async () => memoryStore()],
  ['fileStore', async () => { await rm(DIR, {recursive: true, force: true}); return fileStore(DIR) }]
]

for (const [name, fresh] of stores) {
  describe(`${name} clear`, () => {
    // Two forms with an entry each.
    const filled = async () => {
      const store = await fresh()
      await store.set('form-a', 'one', entry('one', hour))
      await store.set('form-b', 'two', entry('two', hour))
      return store
    }

    it('clears one form, leaving the others', async () => {
      const store = await filled()
      await store.clear('form-a')
      assert.deepEqual(await store.list('form-a'), [])
      assert.equal((await store.get('form-b', 'two')).output, 'two')
    })

    it('clears every form when given none', async () => {
      const store = await filled()
      await store.clear()
      assert.deepEqual([...await store.list('form-a'), ...await store.list('form-b')], [])
    })

    it('clears a form it never held', async () => {
      await (await fresh()).clear('missing')
    })
  })
}
