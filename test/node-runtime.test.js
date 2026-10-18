import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import query, {plan, defineService, NodeRuntime, nodeRuntime, memoryRunStates} from '../index.js'

// microql's query() and plan() run on the node runtime, which has one scope:
// a Query brings its services, and query() files them with their config.
describe('the node runtime', () => {
  const shop = defineService({async '/total'() { return 1 }})
  const vault = defineService({config: {vault: ['string', {min: 1}]}, init(env) { this.vault = env.config.vault }, async '/where'() { return this.vault }})
  const where = {services: {vault}, phases: {a: ['[vault]/where', {}]}, select: '$a'}

  // A service, and how many of its instances have been made.
  const counted = () => {
    const counts = {inits: 0}
    counts.service = defineService({init() { counts.inits++ }, async '/run'() { return 'ran' }})
    return counts
  }

  it('is what query() runs on, unless the Query brings a runtime of its own', async () => {
    await query({services: {shop}, phases: {a: ['[shop]/total', {}]}})
    assert.equal(nodeRuntime.services.get({}, 'shop'), shop)
  })

  it('files the config a Query brings for its services', async () => {
    assert.equal(await query({...where, runtime: new NodeRuntime(), config: {vault: {vault: 'notes'}}}), 'notes')
  })

  it('refuses config a service doesn\'t accept, before any call', async () => {
    await assert.rejects(query({...where, runtime: new NodeRuntime(), config: {vault: {vault: ''}}}), {code: 'invalid-config', message: /Service 'vault' can't use this config/})
  })

  it('runs a Query with only the services it brings', async () => {
    const runtime = new NodeRuntime()
    await query({runtime, services: {shop}, phases: {a: ['[shop]/total', {}]}})
    await assert.rejects(query({runtime, phases: {a: ['[shop]/total', {}]}}), {code: 'unknown-service'})
  })

  it('runs a Query with only the config it brings', async () => {
    const runtime = new NodeRuntime()
    await query({...where, runtime, config: {vault: {vault: 'notes'}}})
    await assert.rejects(query({...where, runtime}), {code: 'invalid-config', message: /No config is filed for 'vault'/})
  })

  it('keeps a service\'s instance for later Queries that bring the same service and config', async () => {
    const kept = counted()
    const runtime = new NodeRuntime()
    const run = {runtime, services: {service: kept.service}, phases: {a: ['[service]/run', {}]}}
    await query(run)
    await query(run)
    assert.equal(kept.inits, 1)
  })

  it('makes a fresh instance for a Query that brings another service under the same name', async () => {
    const [before, after] = [counted(), counted()]
    const runtime = new NodeRuntime()
    await query({runtime, services: {service: before.service}, phases: {a: ['[service]/run', {}]}})
    await query({runtime, services: {service: after.service}, phases: {a: ['[service]/run', {}]}})
    assert.deepEqual([before.inits, after.inits], [1, 1])
  })

  it('resumes a Run the caller names, from the Run State the runtime keeps for it', async () => {
    let calls = 0
    const counting = defineService({async '/run'() { return ++calls }})
    const runtime = new NodeRuntime()
    const run = {runtime, services: {counting}, phases: {a: ['[counting]/run', {}]}, select: '$a'}
    await query(run, {runId: 'named'})
    assert.equal(await query(run, {runId: 'named'}), 1)
    const [{formHash}] = plan(run).calls
    assert.equal((await runtime.runStates.list({}, 'named', formHash)).length, 1)
  })

  it('releases the Run State of a Run it named itself, once it\'s done', async () => {
    const released = []
    const runStates = memoryRunStates()
    const runtime = new NodeRuntime({runStates: {...runStates, clear: (scope, runId) => { released.push(runId); return runStates.clear(scope, runId) }}})
    await query({runtime, services: {shop}, phases: {a: ['[shop]/total', {}]}})
    assert.equal(released.length, 1)
  })

  it('keeps nothing of an aborted Run it named itself, once the calls it left in flight finish', async () => {
    let started, finish
    const isStarted = new Promise(resolve => { started = resolve })
    const finished = new Promise(resolve => { finish = resolve })
    const slow = defineService({async '/wait'() { started(); await finished; return 'late' }})

    // Run States that note what's written after the Run is released
    const runStates = memoryRunStates()
    let released = false
    const lateWrites = []
    const noting = {
      ...runStates,
      set: (...entry) => { if (released) lateWrites.push(entry); return runStates.set(...entry) },
      clear: (...run) => { released = true; return runStates.clear(...run) }
    }
    const runtime = new NodeRuntime({runStates: noting})

    const controller = new AbortController()
    const run = query({runtime, services: {slow}, phases: {a: ['[slow]/wait', {}]}}, {signal: controller.signal})
    await isStarted
    controller.abort()
    await assert.rejects(run, {name: 'AbortError'})
    finish()
    await new Promise(resolve => setTimeout(resolve, 10))
    assert.deepEqual(lateWrites, [])
  })

  it('plans a Query with the services it brings', () => {
    const planned = plan({runtime: new NodeRuntime(), services: {shop}, phases: {a: ['[shop]/total', {}]}})
    assert.deepEqual(planned.calls.map(call => call.key), ['[shop]/total'])
  })
})
