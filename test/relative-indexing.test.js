import assert from 'node:assert'
import {describe, it} from 'node:test'
import query from '../query.js'
import util from '../services/util.js'

describe('Relative Indexing Context Tests', () => {
  // Test data with nested structure
  const _testData = {
    companies: [
      {
        name: 'TechCorp',
        departments: [
          {
            name: 'Engineering',
            teams: [
              {name: 'Frontend', members: ['Alice', 'Bob']},
              {name: 'Backend', members: ['Charlie']}
            ]
          }
        ]
      }
    ]
  }

  // Mock service to test context levels
  const testService = {
    checkContext: ({level1, level2, level3}) => {
      return {
        level1: level1?.name || level1,
        level2: level2?.name || level2,
        level3: level3?.name || level3
      }
    }
  }

  testService.checkContext._argtypes = {
    level1: {},
    level2: {},
    level3: {}
  }

  const services = {util, test: testService}

  it('should use relative indexing for @ symbols', async () => {
    // Simpler test first - just one level of nesting
    const result = await query({
      given: {items: [1, 2]},
      services,
      methods: ['util'],
      queries: {
        simple: [
          '$.given.items',
          'util:map',
          {
            fn: [
              'test',
              'checkContext',
              {
                level1: '@' // Should be the current item (1 or 2)
              }
            ]
          }
        ]
      }
    })

    // Verify simple case works
    assert.strictEqual(result.simple.length, 2)
    assert.strictEqual(result.simple[0].level1, 1)
    assert.strictEqual(result.simple[1].level1, 2)

    // Test with two levels
    const result2 = await query({
      given: {
        outer: [{inner: [1, 2]}, {inner: [3, 4]}]
      },
      services,
      methods: ['util'],
      queries: {
        nested: [
          '$.given.outer',
          'util:flatMap',
          {
            fn: [
              'util',
              'map',
              {
                on: '@.inner',
                fn: [
                  'test',
                  'checkContext',
                  {
                    level1: '@', // Should be inner item (current context)
                    level2: '@@' // Should be outer item (parent context)
                  }
                ]
              }
            ]
          }
        ]
      }
    })

    // Verify relative indexing with nested iteration
    assert.strictEqual(result2.nested.length, 4) // 2 outer × 2 inner = 4 results

    const firstResult = result2.nested[0]
    // @ should refer to the inner item (current context)
    assert.strictEqual(firstResult.level1, 1)
    // @@ should refer to the outer item (parent context)
    assert.deepStrictEqual(firstResult.level2, {inner: [1, 2]})
  })

  it('should handle chain results in context stack', async () => {
    const chainService = {
      step1: ({input}) => ({step1Result: `${input}-step1`}),
      step2: ({input}) => ({step2Result: `${input}-step2`}),
      final: ({chain1, chain2}) => ({
        chain1,
        chain2
      })
    }

    chainService.step1._argtypes = {}
    chainService.step2._argtypes = {}
    chainService.final._argtypes = {}

    const result = await query({
      given: {value: 'test'},
      services: {util, chain: chainService},
      methods: ['util'],
      queries: {
        // Test chains in functions
        result: [
          'util',
          'map',
          {
            on: [1, 2],
            fn: [
              'chain',
              'final',
              {
                chain1: '@', // Should be current iteration item
                chain2: '@' // Same - we're not in a chain context here
              }
            ]
          }
        ]
      }
    })

    assert.strictEqual(result.result.length, 2)
    assert.strictEqual(result.result[0].chain1, 1)
    assert.strictEqual(result.result[0].chain2, 1)
  })

  it('should throw clear error for invalid context levels', async () => {
    try {
      await query({
        given: {items: [1, 2]},
        services,
        methods: ['util'],
        queries: {
          invalid: [
            '$.given.items',
            'util:map',
            {
              fn: [
                'test',
                'checkContext',
                {
                  level1: '@@@@' // Too many levels
                }
              ]
            }
          ]
        }
      })
      assert.fail('Should have thrown error for invalid context level')
    } catch (error) {
      assert(
        error.message.includes('@@@@ not available - context not deep enough')
      )
      assert(error.message.includes('levels available'))
    }
  })

  it('should handle deep nesting: chainA -> mapB -> chainC -> mapD', async () => {
    // This test captures the complex pattern that requires virtual AST nodes
    const chainService = {
      step1: async ({input}) =>
        input.map((dataset) => ({
          dataset,
          step: 'chainA',
          processed: dataset.batches
        })),
      step2: async ({input}) =>
        input.map((batch) => ({
          batch,
          step: 'chainC',
          items: batch.items
        }))
    }

    chainService.step1._argtypes = {}
    chainService.step2._argtypes = {}

    const services = {util, test: testService, chain: chainService}

    const result = await query({
      given: {
        datasets: [
          {batches: [{items: [1, 2]}]},
          {batches: [{items: [3, 4]}]}
        ]
      },
      services,
      methods: ['util'],
      queries: {
        deepNested: [
          // ChainA: Transform datasets
          ['chain', 'step1', {input: '$.given.datasets'}],
          // MapB: Iterate over each transformed dataset
          [
            'util',
            'flatMap',
            {
              on: '@',
              fn: ['chain', 'step2', {input: '@.processed'}]
            }
          ],
          // MapC: Iterate over the flattened batches
          [
            'util',
            'flatMap',
            {
              on: '@',
              fn: [
                'test',
                'checkContext',
                {
                  level1: '@.items', // Current batch items
                  level2: '@@', // Current batch (from previous map)
                  level3: '@@@' // Current dataset (from mapB)
                }
              ]
            }
          ]
        ]
      }
    })

    // Verify the deep nesting works correctly
    assert(Array.isArray(result.deepNested))
    assert(result.deepNested.length > 0)

    // Check first result from the nested iteration
    const firstResult = result.deepNested[0]

    // Verify the context resolution worked correctly
    assert(Array.isArray(firstResult.level1)) // @ resolves to current batch items
    assert(Array.isArray(firstResult.level2)) // @@ resolves to parent context (array of batches)
    assert(Array.isArray(firstResult.level3)) // @@@ resolves to grandparent context

    // CRITICAL: @@ and @@@ should resolve to different values
    assert.notStrictEqual(
      firstResult.level2,
      firstResult.level3,
      '@@ and @@@ should resolve to different contexts, but they are the same'
    )

    // Verify the actual data structure
    assert.strictEqual(firstResult.level1.length, 2) // [1, 2] or [3, 4]
    assert(firstResult.level2.length > 0) // Array of batch objects
    assert(firstResult.level2[0].step === 'chainC') // Batches from chainC step
  })
})
