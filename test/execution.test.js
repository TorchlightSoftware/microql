import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import query, {plan, defineService} from '../index.js'
import {ownRun} from './test-services.js'

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
  services: {source: defineService(source)},
  phases: {
    categories: ['[source]/fetch', {id: 'categories'}],
    listings: ['[source]/fetch', {id: 'listings', after: '$categories'}],
    records: ['[source]/fetch', {id: 'records', after: '$listings'}],
    summary: ['[source]/fetch', {id: 'summary', after: '$categories'}]
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

  // The done update of each phase, by name.
  const doneUpdates = async (config, options) => {
    const updates = []
    await query(config, {...options, onUpdate: update => updates.push(update)})
    return Object.fromEntries(updates.filter(u => u.status === 'done').map(u => [u.name, u]))
  }

  it('reports the hash of each phase\'s result, and of each upstream result it read', async () => {
    const done = await doneUpdates(pipeline(counting()))
    assert.match(done.categories.resultHash, /^[0-9a-f]{64}$/)
    assert.deepEqual(done.categories.upstream, {})
    assert.deepEqual(done.listings.upstream, {categories: done.categories.resultHash})
    assert.deepEqual(done.records.upstream, {listings: done.listings.resultHash})
  })

  // A source whose categories result is whatever `version` holds now.
  const versioned = () => {
    const source = counting()
    source.version = 1
    const fetch = source['/fetch']
    source['/fetch'] = async function ({id}) {
      const result = await fetch.call(this, {id})
      return id === 'categories' ? {...result, version: this.version} : result
    }
    return source
  }

  // [description, change before rerunning categories, listings goes stale]
  const reruns = [
    ['an unchanged result', () => {}, false],
    ['a changed result', source => { source.version = 2 }, true]
  ]

  for (const [description, change, stale] of reruns) {
    it(`lets a platform tell that a later phase is ${stale ? '' : 'not '}stale after rerunning upstream with ${description}`, async () => {
      const source = versioned()
      const run = ownRun()
      const first = await doneUpdates(pipeline(source), {runId: run.id})
      change(source)
      const rerun = await doneUpdates(pipeline(source), {runId: run.id, target: '$categories'})
      assert.equal(first.listings.upstream.categories !== rerun.categories.resultHash, stale)
    })
  }

  it('reports when a phase started and how long it took, never its output', async () => {
    const updates = []
    await query(pipeline(counting()), {onUpdate: update => updates.push(update)})

    const [running, done] = updates.filter(u => u.name === 'categories')
    assert.deepEqual(Object.keys(running).sort(), ['kind', 'name', 'startedAt', 'status'])
    assert.deepEqual(Object.keys(done).sort(), ['duration', 'kind', 'name', 'resultHash', 'startedAt', 'status', 'upstream'])
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
    const run = ownRun()
    await query(pipeline(source), {runId: run.id})
    await query(pipeline(source), {runId: run.id, target: '$listings'})

    assert.deepEqual(source.calls, {categories: 1, listings: 2, records: 1, summary: 1})
  })

  it('reruns every call of the target phase, inside its iterations too', async () => {
    const source = counting()
    const run = ownRun()
    const config = {
      given: {ids: [1, 2]},
      services: {source: defineService(source)},
      phases: {fetched: ['$given.ids', '[util]/each', {service: ['[source]/fetch', {id: '@'}]}]}
    }
    await query(config, {runId: run.id})
    await query(config, {runId: run.id, target: '$fetched'})
    assert.deepEqual(source.calls, {1: 2, 2: 2})
  })

  // [target, error pattern]
  const invalid = [
    ['$nope', {code: 'unknown-target', message: /^execute: Target '\$nope' names no phase\.$/}],
    ['$listings.@1', {code: 'invalid-target', message: /Use '\$listings'/}],
    ['$listings.result', {code: 'invalid-target', message: /Use '\$listings'/}],
    ['listings', {code: 'invalid-target', message: /Use '\$listings'/}],
    ['@item', {code: 'invalid-target', message: /^execute: Target '@item' is not a phase reference\.\n\nName a phase as '\$phase'\.$/}]
  ]

  for (const [target, pattern] of invalid) {
    it(`refuses the target ${target}`, async () => {
      await assert.rejects(query(pipeline(counting()), {target}), pattern)
    })
  }
})

describe('abort', () => {
  // A service whose /wait never answers, and says when it has been called.
  const gated = () => {
    const service = {calls: [], started: null}
    service.started = new Promise(resolve => {
      service['/wait'] = async () => { service.calls.push('wait'); resolve(); return new Promise(() => {}) }
    })
    service['/quick'] = async () => { service.calls.push('quick'); return 'quick' }
    service['/after'] = async () => { service.calls.push('after'); return 'after' }
    return service
  }

  const gatedQuery = (gate, handler) => ({
    services: {gate: defineService(gate)},
    settings: handler ? {catch: handler} : {},
    phases: {
      quick: ['[gate]/quick', {}],
      waiting: [['[gate]/wait', {after: '$quick'}], ['[gate]/after', {}]]
    }
  })

  it('stops at once, reports the running phase cancelled with its calls in flight, and keeps finished results', {timeout: 2000}, async () => {
    const gate = gated()
    const controller = new AbortController()
    const named = ownRun()
    const updates = []
    const run = query(gatedQuery(gate), {runId: named.id, signal: controller.signal, onUpdate: update => updates.push(update)})

    await gate.started
    controller.abort()
    await assert.rejects(run, {name: 'AbortError'})

    const cancelled = updates.find(u => u.name === 'waiting' && u.status === 'cancelled')
    assert.deepEqual(cancelled.inFlight, ['$waiting.@1'])
    assert.deepEqual(gate.calls, ['quick', 'wait'])
    const {calls} = plan(gatedQuery(gate))
    const [quick] = await named.list(calls.find(c => c.address === '$quick.@1').formHash)
    assert.equal(quick.status, 'done')
  })

  it('runs nothing when the signal has already aborted', async () => {
    const gate = gated()
    await assert.rejects(query(gatedQuery(gate), {signal: AbortSignal.abort()}), {name: 'AbortError'})
    assert.deepEqual(gate.calls, [])
  })

  it('does not run the Query\'s catch', {timeout: 2000}, async () => {
    const gate = gated()
    const handled = []
    gate['/handle'] = async () => { handled.push('handled') }
    const controller = new AbortController()
    const run = query(gatedQuery(gate, ['[gate]/handle', {}]), {signal: controller.signal})

    await gate.started
    controller.abort()
    await assert.rejects(run, {name: 'AbortError'})
    assert.deepEqual(handled, [])
  })

  it('does not run a call\'s catch', {timeout: 2000}, async () => {
    const gate = gated()
    const handled = []
    gate['/handle'] = async () => { handled.push('handled') }
    const controller = new AbortController()
    const run = query({
      services: {gate: defineService(gate)},
      phases: {waiting: ['[util]/each', {on: [1], service: ['[gate]/wait', {}], catch: ['[gate]/handle', {}]}]}
    }, {signal: controller.signal})

    await gate.started
    controller.abort()
    await assert.rejects(run, {name: 'AbortError'})
    assert.deepEqual(handled, [])
  })
})
