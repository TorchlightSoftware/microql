import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import {rangesOf, renderResults} from '../scripts/lib/bench-report.js'

describe('benchmark report', () => {
  // three runs of `npm run bench`, as it prints them
  const runs = [
    {version: 'new', each: {ms: 15, usPerCall: 15, calls: 1000}, chain: {ms: 4, usPerCall: 40, calls: 100}},
    {version: 'new', each: {ms: 19, usPerCall: 19, calls: 1000}, chain: {ms: 3.8, usPerCall: 38, calls: 100}},
    {version: 'new', each: {ms: 16, usPerCall: 16, calls: 1000}, chain: {ms: 5, usPerCall: 51, calls: 100}}
  ]

  it('reduces runs to each workload\'s calls and range of µs per call', () => {
    assert.deepEqual(rangesOf(runs), {
      each: {calls: 1000, min: 15, max: 19},
      chain: {calls: 100, min: 38, max: 51}
    })
  })

  // [ranges, rendered cell]
  const cells = [
    [{each: {calls: 1000, min: 3, max: 3}}, '| each | 1000 | 3 | 3 |'],
    [{each: {calls: 1000, min: 15, max: 19}}, '| each | 1000 | 3 | 15–19 |']
  ]

  for (const [current, row] of cells) {
    it(`renders ${row}`, () => {
      const baseline = {each: {calls: 1000, min: 3, max: 3}}
      assert.ok(renderResults({current, baseline, runs: 3, environment: 'node v22'}).includes(row))
    })
  }

  it('states how and where it was measured, above the table', () => {
    const text = renderResults({current: rangesOf(runs), baseline: rangesOf(runs), runs: 3, environment: 'node v22, 8 cores'})
    assert.match(text, /^Measured .* node v22, 8 cores\. Range of 3 runs/)
    assert.match(text, /\| Workload \| Calls \| 0\.6\.6 \| this checkout \|/)
  })
})
