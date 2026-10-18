import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import {concurrencyLimit} from '../src/execute/concurrency.js'

describe('concurrencyLimit', () => {
  // [cap, number of calls]
  const cases = [[1, 5], [2, 7], [6, 20], [10, 3]]

  for (const [max, count] of cases) {
    it(`never runs more than ${max} of ${count} calls at once`, async () => {
      const limit = concurrencyLimit(max)
      let active = 0
      let peak = 0
      const task = (i) => limit(async () => {
        active++
        peak = Math.max(peak, active)
        await new Promise(resolve => setTimeout(resolve, 2))
        active--
        return i
      })

      const results = await Promise.all(Array.from({length: count}, (_, i) => task(i)))
      assert.deepEqual(results, Array.from({length: count}, (_, i) => i))
      assert.equal(peak, Math.min(max, count))
    })
  }

  it('frees the slot when a call fails', async () => {
    const limit = concurrencyLimit(1)
    await assert.rejects(limit(async () => { throw new Error('boom') }), /boom/)
    assert.equal(await limit(async () => 'next'), 'next')
  })
})
