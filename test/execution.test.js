import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import query, {memoryStore} from '../index.js'

// A service that counts its calls by id, and fails the ids it's told to.
const counting = (failing = new Set()) => ({
  calls: {},
  async '/fetch'({id}) {
    this.calls[id] = (this.calls[id] ?? 0) + 1
    if (failing.has(id)) throw new Error(`failed ${id}`)
    return {id}
  }
})

// categories → listings → records; summary depends only on categories
const pipeline = (source) => ({
  services: {source},
  phases: {
    categories: ['GET [source]/fetch', {id: 'categories'}],
    listings: ['GET [source]/fetch', {id: 'listings', after: '$categories'}],
    records: ['GET [source]/fetch', {id: 'records', after: '$listings'}],
    summary: ['GET [source]/fetch', {id: 'summary', after: '$categories'}]
  }
})

// The updates a Run reports, without their timing.
const statuses = (updates) => updates.map(({kind, name, status}) => `${kind} ${name} ${status}`)

describe('onUpdate', () => {
  it('reports each phase running, then done, after the phases it depends on are done', async () => {
    const updates = []
    await query(pipeline(counting()), {onUpdate: update => updates.push(update)})

    const at = (name, status) => statuses(updates).indexOf(`phase ${name} ${status}`)
    for (const name of ['categories', 'listings', 'records', 'summary']) {
      assert.ok(at(name, 'running') < at(name, 'done'), `${name} runs before it is done`)
    }
    assert.ok(at('categories', 'done') < at('listings', 'running'))
    assert.ok(at('categories', 'done') < at('summary', 'running'))
    assert.ok(at('listings', 'done') < at('records', 'running'))
    assert.equal(updates.length, 8)
  })

  it('reports a failed phase with its error, and never starts the phases after it', async () => {
    const updates = []
    await assert.rejects(query(pipeline(counting(new Set(['listings']))), {onUpdate: update => updates.push(update)}))

    const listings = updates.filter(u => u.name === 'listings')
    assert.deepEqual(statuses(listings), ['phase listings running', 'phase listings failed'])
    assert.match(listings[1].error, /failed listings/)
    assert.equal(updates.some(u => u.name === 'records'), false)
  })

  it('keeps running when onUpdate throws', async () => {
    const source = counting()
    const results = await query(pipeline(source), {onUpdate: () => { throw new Error('socket closed') }})
    assert.deepEqual(Object.keys(results).sort(), ['categories', 'listings', 'records', 'summary'])
    assert.deepEqual(source.calls, {categories: 1, listings: 1, records: 1, summary: 1})
  })

  it('reports when a phase started and how long it took, never its output', async () => {
    const updates = []
    await query(pipeline(counting()), {onUpdate: update => updates.push(update)})

    const [running, done] = updates.filter(u => u.name === 'categories')
    assert.deepEqual(Object.keys(running).sort(), ['kind', 'name', 'startedAt', 'status'])
    assert.deepEqual(Object.keys(done).sort(), ['duration', 'kind', 'name', 'startedAt', 'status'])
    assert.equal(done.startedAt, running.startedAt)
    assert.equal(typeof done.duration, 'number')
  })
})

describe('target', () => {
  it('runs a phase and what it depends on, and nothing after it', async () => {
    const source = counting()
    const results = await query(pipeline(source), {target: '$listings'})

    assert.deepEqual(Object.keys(results).sort(), ['categories', 'listings'])
    assert.deepEqual(source.calls, {categories: 1, listings: 1})
  })

  it('reuses stored upstream results, and always reruns the target phase', async () => {
    const source = counting()
    const runState = memoryStore()
    await query(pipeline(source), {runState})
    await query(pipeline(source), {runState, target: '$listings'})

    assert.deepEqual(source.calls, {categories: 1, listings: 2, records: 1, summary: 1})
  })

  it('reruns every call of the target phase, inside its iterations too', async () => {
    const source = counting()
    const runState = memoryStore()
    const config = {
      given: {ids: [1, 2]},
      services: {source},
      phases: {fetched: ['$given.ids', 'GET [util]/each', {service: ['GET [source]/fetch', {id: '@'}]}]}
    }
    await query(config, {runState})
    await query(config, {runState, target: '$fetched'})
    assert.deepEqual(source.calls, {1: 2, 2: 2})
  })

  // [target, error pattern]
  const invalid = [
    ['$nope', /Unknown target '\$nope': no phase named 'nope'/],
    ['$listings.@1', /Targets are phases: use '\$listings'/],
    ['$listings.result', /Targets are phases: use '\$listings'/],
    ['listings', /Targets are phases: use '\$listings'/],
    ['@item', /Targets are phases, named '\$phase': got '@item'/]
  ]

  for (const [target, pattern] of invalid) {
    it(`refuses the target ${target}`, async () => {
      await assert.rejects(query(pipeline(counting()), {target}), pattern)
    })
  }
})
