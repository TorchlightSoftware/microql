import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import query, {defineService, nodeRuntime} from '../index.js'

// tearDown belongs to the runtime that keeps a service's instances: a Run
// never calls it.
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
  const ownRuntime = () => ({...nodeRuntime})

  // [description, phases, whether the Run fails]
  const runs = [
    ['a Run that succeeds', {a: ['[service]/run', {}]}, false],
    ['a Run that fails', {a: ['[service]/fail', {}]}, true]
  ]

  for (const [description, phases, fails] of runs) {
    it(`isn't called by ${description}`, async () => {
      const counted = tearDownCounting()
      const run = query({runtime: ownRuntime(), services: {service: counted.service}, phases})
      if (fails) await assert.rejects(run, /failed/)
      else await run
      assert.equal(counted.tearDowns, 0)
    })
  }

  it('is called by the node runtime\'s tearDown on each instance it keeps, once', async () => {
    const one = tearDownCounting()
    const other = tearDownCounting()
    const runtime = ownRuntime()
    await query({runtime, services: {one: one.service, other: other.service}, phases: {a: ['[one]/run', {}], b: ['[other]/run', {}]}})
    await runtime.tearDown()
    await runtime.tearDown()
    assert.deepEqual([one.tearDowns, other.tearDowns], [1, 1])
  })

  it('reaches only the instances of the runtime it is called on', async () => {
    const counted = tearDownCounting()
    const [used, other] = [ownRuntime(), ownRuntime()]
    await query({runtime: used, services: {service: counted.service}, phases: {a: ['[service]/run', {}]}})
    await other.tearDown()
    assert.equal(counted.tearDowns, 0)
    await used.tearDown()
    assert.equal(counted.tearDowns, 1)
  })
})
