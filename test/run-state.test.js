import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import query, {memoryCache, NodeRuntime, plan, defineService} from '../index.js'
import {ownRun} from './test-services.js'

// A service that counts its calls by input, and fails the inputs it's told to.
const counting = (failing = new Set()) => {
  const calls = {}
  const service = defineService({
    async '/fetch'({id}) {
      calls[id] = (calls[id] ?? 0) + 1
      if (failing.has(id)) throw new Error(`interrupted at ${id}`)
      return {id}
    }
  })
  return {...service, calls}
}

const listingsQuery = (service) => ({
  given: {ids: [1, 2, 3]},
  services: {source: service},
  phases: {
    fetched: ['$given.ids', '[util]/each', {service: ['[source]/fetch', {id: '@'}]}],
    summary: ['[util]/length', {value: '$fetched'}]
  },
  select: '$fetched'
})

describe('Run State', () => {
  it('resumes an interrupted Run without running any call twice', async () => {
    const run = ownRun()
    const interrupted = new Set([3])
    const service = counting(interrupted)

    await assert.rejects(query(listingsQuery(service), {runId: run.id}), /interrupted at 3/)
    assert.deepEqual(service.calls, {1: 1, 2: 1, 3: 1})

    interrupted.clear()
    const result = await query(listingsQuery(service), {runId: run.id})
    assert.deepEqual(result, [{id: 1}, {id: 2}, {id: 3}])
    assert.deepEqual(service.calls, {1: 1, 2: 1, 3: 2}, 'only the failed call runs again')
  })

  it('reuses every result on a completed Run State', async () => {
    const run = ownRun()
    const service = counting()
    await query(listingsQuery(service), {runId: run.id})
    await query(listingsQuery(service), {runId: run.id})
    assert.deepEqual(service.calls, {1: 1, 2: 1, 3: 1})
  })

  it('starts fresh with a fresh Run State', async () => {
    const service = counting()
    await query(listingsQuery(service))
    await query(listingsQuery(service))
    assert.deepEqual(service.calls, {1: 2, 2: 2, 3: 2})
  })

  it('stores each result by form hash, per item by input', async () => {
    const run = ownRun()
    const query1 = listingsQuery(counting(new Set([2])))
    await assert.rejects(query(query1, {runId: run.id}))

    const {calls} = plan(query1)
    const inner = calls.find(call => call.address === '$fetched.@1a1')
    const entries = await run.list(inner.formHash)

    const byId = Object.fromEntries(entries.map(entry => [entry.inputs.id, entry]))
    assert.equal(entries.length, 3, 'one entry per item')
    assert.equal(byId[1].status, 'done')
    assert.deepEqual(byId[1].output, {id: 1})
    assert.equal(byId[1].address, '$fetched.@1a1')
    assert.equal(typeof byId[1].duration, 'number')
    assert.equal(byId[2].status, 'failed')
    assert.match(byId[2].error.message, /interrupted at 2/)
    assert.equal(byId[2].error.attempts, 1)
  })

  it('settles the calls a failure left running before the Run reports', async () => {
    const events = []
    const service = defineService({
      async '/fast'() { throw new Error('fast failure') },
      async '/slow'() {
        await new Promise(resolve => setTimeout(resolve, 20))
        events.push('slow finished')
        return 'slow'
      }
    })
    const run = ownRun()
    const config = {services: {service}, phases: {a: ['[service]/fast', {}], b: ['[service]/slow', {}]}}

    await assert.rejects(query(config, {runId: run.id}), /fast failure/)
    events.push('reported')
    assert.deepEqual(events, ['slow finished', 'reported'])

    const {calls} = plan(config)
    const [entry] = await run.list(calls.find(c => c.address === '$b.@1').formHash)
    assert.equal(entry.status, 'done')
  })

  it('runs identical calls once', async () => {
    const service = counting()
    const result = await query({
      services: {source: service},
      phases: {
        a: ['[source]/fetch', {id: 7}],
        b: ['[source]/fetch', {id: 7}]
      }
    })
    assert.deepEqual(result, {a: {id: 7}, b: {id: 7}})
    assert.deepEqual(service.calls, {7: 1})
  })
})

describe('Cache', () => {
  const cachedQuery = (service, id, cache = true) => ({
    services: {source: service},
    phases: {a: ['[source]/fetch', {id, cache}]},
    select: '$a'
  })

  it('reuses a result across Runs only when the inputs match', async () => {
    const runtime = new NodeRuntime({cache: memoryCache()})
    const service = counting()
    await query({...cachedQuery(service, 1), runtime})
    await query({...cachedQuery(service, 1), runtime})
    await query({...cachedQuery(service, 2), runtime})
    assert.deepEqual(service.calls, {1: 1, 2: 1})
  })

  // Ages a call's only cache entry by some days.
  const age = async (cache, config, days) => {
    const {calls: [call]} = plan(config)
    const [entry] = await cache.list({}, call.formHash)
    await cache.set({}, call.formHash, entry.input, {...entry, created: new Date(Date.now() - days * 86400000).toISOString()})
    return entry
  }

  // [cache setting, Query-wide settings, days old, reused]
  const ttls = [
    [true, {}, 6, true],
    [true, {}, 8, false],
    [true, {cache: {ttl: '30D'}}, 20, true],
    [{ttl: '1D'}, {cache: {ttl: '30D'}}, 2, false]
  ]

  for (const [cache, settings, days, reused] of ttls) {
    it(`${reused ? 'reuses' : 'misses'} a ${days}-day-old entry for cache: ${JSON.stringify(cache)} with settings ${JSON.stringify(settings)}`, async () => {
      const store = memoryCache()
      const service = counting()
      const config = {...cachedQuery(service, 1, cache), settings, runtime: new NodeRuntime({cache: store})}

      await query(config)
      await age(store, config, days)
      await query(config)
      assert.deepEqual(service.calls, {1: reused ? 1 : 2})
    })
  }

  it('records when each entry expires', async () => {
    const store = memoryCache()
    const config = {...cachedQuery(counting(), 1, {ttl: '2h'}), runtime: new NodeRuntime({cache: store})}
    await query(config)

    const {calls: [call]} = plan(config)
    const [entry] = await store.list({}, call.formHash)
    assert.equal(Date.parse(entry.expires) - Date.parse(entry.created), 2 * 3600000)
  })

  it('misses an entry older than its ttl', async () => {
    const cache = memoryCache()
    const runtime = new NodeRuntime({cache})
    const service = counting()
    const config = {...cachedQuery(service, 1, {ttl: '1h'}), runtime}

    await query(config)
    const {calls: [call]} = plan(config)
    const [entry] = await cache.list({}, call.formHash)
    await cache.set({}, call.formHash, entry.input, {...entry, created: new Date(Date.now() - 2 * 3600000).toISOString()})

    await query(config)
    assert.deepEqual(service.calls, {1: 2})
  })
})

// A call that holds calls is keyed by its own fields and by what the calls it
// holds read from outside it: the item of an enclosing iteration, an enclosing
// catch's error, a phase.
describe('the input of a call that holds calls', () => {
  const pair = defineService({async '/of'({x, y}) { return `${x}${y}` }})
  const failing = defineService({async '/on'({item}) { throw new Error(`no ${item}`) }})
  const services = {pair, failing}

  // [description, phases, the selected result]
  const cases = [
    ['a nested each reading the outer item',
      {grid: ['$given.xs', '[util]/each', {as: 'x', service: ['[util]/each', {on: '$given.ys', service: ['[pair]/of', {x: '@x', y: '@'}]}]}]},
      [['a1', 'a2'], ['b1', 'b2']]],
    ['a try inside an iteration reading the item',
      {grid: ['$given.xs', '[util]/each', {as: 'x', service: ['[util]/try', {service: ['[pair]/of', {x: '@x', y: 0}]}]}]},
      ['a0', 'b0']],
    ['an each in a catch reading that catch\'s error',
      {
        grid: ['$given.xs', '[util]/each', {
          service: ['[failing]/on', {item: '@'}],
          catch: ['[util]/each', {on: '$given.ys', service: ['[pair]/of', {x: '@err.args.item', y: '@'}]}]
        }]
      },
      [['a1', 'a2'], ['b1', 'b2']]]
  ]

  for (const [description, phases, expected] of cases) {
    it(`tells items apart: ${description}`, async () => {
      const result = await query({given: {xs: ['a', 'b'], ys: [1, 2]}, services, phases, select: '$grid'})
      assert.deepEqual(result, expected)
    })
  }

  it('misses its Cache entry when a phase the calls it holds read has changed', async () => {
    const cache = memoryCache()
    const config = (label) => ({
      given: {label},
      services,
      runtime: new NodeRuntime({cache}),
      phases: {
        label: ['[util]/template', {text: '$given.label'}],
        grid: ['[util]/each', {on: [1], cache: true, service: ['[pair]/of', {x: '$label.text', y: '@'}]}]
      },
      select: '$grid'
    })
    assert.deepEqual(await query(config('a')), ['a1'])
    assert.deepEqual(await query(config('b')), ['b1'])
  })

  it('records what it read in its Run State entry; a call reading nothing outside keeps its fields\' hash', async () => {
    const run = ownRun()
    const config = {given: {xs: ['a']}, services, phases: {grid: ['$given.xs', '[util]/each', {as: 'x', service: ['[util]/try', {service: ['[pair]/of', {x: '@x', y: 0}]}]}]}}
    await query(config, {runId: run.id})
    const {calls} = plan(config)
    const entryAt = async (address) => (await run.list(calls.find(c => c.address === address).formHash))[0]

    assert.deepEqual((await entryAt('$grid.@1a1')).reads, {'@x': 'a'})
    assert.equal((await entryAt('$grid.@1')).reads, undefined)
  })
})
