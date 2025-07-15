import assert from 'node:assert'
import { describe, it } from 'mocha'
import query from '../query.js'
import util from '../util.js'

describe('Bare $ Resolution Tests', () => {
  it('should resolve $ to all completed queries at execution time', async () => {
    const result = await query({
      given: { value: 'test' },
      services: { util },
      query: {
        step1: ['util', 'pick', { on: '$.given', fields: ['value'] }],
        step2: [
          'util',
          'when',
          { test: true, then: 'completed', or: 'failed' }
        ],
        // Create dependency on step1 and step2, then capture state
        captureState: [
          ['util', 'template', { step1: '$.step1', step2: '$.step2' }],
          ['util', 'template', { allQueries: '$', context: '@' }]
        ]
      },
      select: 'captureState'
    })

    // Should capture all completed queries at execution time
    assert(result.allQueries, 'allQueries should contain captured state')
    assert(result.allQueries.given, 'given should be captured')
    assert.strictEqual(result.allQueries.given.value, 'test')
    assert(result.allQueries.step1, 'step1 should be captured')
    assert.strictEqual(result.allQueries.step1.value, 'test')
    assert(result.allQueries.step2, 'step2 should be captured')
    assert.strictEqual(result.allQueries.step2, 'completed')
  })

  it('should capture current state without creating dependencies', async () => {
    // Test that $ doesn't wait for anything - it captures "what we have now"
    const result = await query({
      services: { util },
      query: {
        immediate: ['util', 'template', '$'], // Should execute immediately, capture empty state
        delayed: ['util', 'when', { test: true, then: 'done', or: 'failed' }]
      },
      select: ['immediate', 'delayed']
    })

    // immediate should have captured state before delayed completed
    // (though both should be in final result since we select both)
    assert(result.immediate)
    assert(result.delayed)
    assert.strictEqual(result.delayed, 'done')
  })

  it('should work with method syntax', async () => {
    const result = await query({
      given: { data: [1, 2, 3] },
      services: { util },
      methods: ['util'],
      query: {
        processed: ['$.given.data', 'util:map', { fn: { doubled: '@' } }],
        // Use method syntax to capture current state after processed completes
        result: ['$.processed', 'util:template', { allState: '$' }]
      },
      select: 'result'
    })

    // Should capture both given and processed
    assert(result.allState.given)
    assert.deepStrictEqual(result.allState.given.data, [1, 2, 3])
    assert(result.allState.processed)
    assert(Array.isArray(result.allState.processed))
    assert.strictEqual(result.allState.processed[0].doubled, 1)
  })
})
