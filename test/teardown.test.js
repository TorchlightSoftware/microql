import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import query, {defineService, NodeRuntime} from '../index.js'

// tearDown belongs to the runtime that keeps a service's instances, and to
// the platform: core never calls it. The node runtime's query() is a platform,
// which releases the instances of a Run it named itself once it's done.
describe('tearDown', () => {
  // A service, and how often its instances' tearDown has run.
  const tearDownCounting = () => {
    const counted = {tearDowns: 0}
    counted.service = defineService({
      async '/run'() { return 'ran' },
      async '/fail'() { throw new Error('failed') },
      async tearDown() { counted.tearDowns++ }
    })
    return counted
  }

  // A runtime of its own, keeping its own instances, as a test would use.
  const ownRuntime = () => new NodeRuntime()

  // [description, phases, whether the Run fails]
  const runs = [
    ['a Run that succeeds', {a: ['[service]/run', {}]}, false],
    ['a Run that fails', {a: ['[service]/fail', {}]}, true]
  ]

  // [description, the Run's options, tearDowns once it's done]
  const runners = [
    ['isn\'t called by', {runId: 'named'}, 0],
    ['is called once, by query() releasing a Run it named itself, after', {}, 1]
  ]

  for (const [description, options, expected] of runners) {
    for (const [run, phases, fails] of runs) {
      it(`${description} ${run}`, async () => {
        const counted = tearDownCounting()
        const ran = query({runtime: ownRuntime(), services: {service: counted.service}, phases}, options)
        if (fails) await assert.rejects(ran, /failed/)
        else await ran
        assert.equal(counted.tearDowns, expected)
      })
    }
  }

  it('is called by the node runtime\'s tearDown on each instance it keeps, once', async () => {
    const one = tearDownCounting()
    const other = tearDownCounting()
    const runtime = ownRuntime()
    await query({runtime, services: {one: one.service, other: other.service}, phases: {a: ['[one]/run', {}], b: ['[other]/run', {}]}}, {runId: 'named'})
    await runtime.tearDown()
    await runtime.tearDown()
    assert.deepEqual([one.tearDowns, other.tearDowns], [1, 1])
  })

  it('reaches only the instances of the runtime it is called on', async () => {
    const counted = tearDownCounting()
    const [used, other] = [ownRuntime(), ownRuntime()]
    await query({runtime: used, services: {service: counted.service}, phases: {a: ['[service]/run', {}]}}, {runId: 'named'})
    await other.tearDown()
    assert.equal(counted.tearDowns, 0)
    await used.tearDown()
    assert.equal(counted.tearDowns, 1)
  })
})
