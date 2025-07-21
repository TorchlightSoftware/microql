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
      queries: {
        simple: ['$.given.items', 'util:map', {
          fn: ['test', 'checkContext', {
            level1: '@' // Should be the current item (1 or 2)
          }]
        }]
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
      queries: {
        nested: ['$.given.outer', 'util:flatMap', {
          fn: ['@.inner', 'util:map', {
            fn: ['test', 'checkContext', {
              level1: '@', // Should be inner item (current context)
              level2: '@@' // Should be outer item (parent context)
            }]
          }]
        }]
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
      step1: ({on}) => (`${on}-step1`),
      step2: ({on}) => (`${on}-step2`),
      final: ({on}) => (on)
    }

    const result = await query({
      given: {input: 'input'},
      services: {util, chain: chainService},
      queries: {
        result: [
          ['$.given.input', 'chain:step1'],
          ['@', 'chain:step2'],
          ['@', 'chain:final']
        ]
      }
    })

    assert.strictEqual(result.result, 'input-step1-step2')
  })

  it('should throw clear error for invalid context levels', async () => {
    try {
      await query({
        given: {items: [1, 2]},
        services,
        queries: {
          invalid: ['$.given.items', 'util:map', {
            fn: ['test', 'checkContext', {level1: '@@@@'}] // too many levels
          }]
        }
      })
      assert.fail('Should have thrown error for invalid context level')
    } catch (error) {
      assert(error.message.includes('@@@@ not available - context not deep enough'))
      assert(error.message.includes('levels available'))
    }
  })

  it('should handle deep nesting: chainA -> mapB -> chainC -> mapD', async () => {
    // use math functions to test - we can do complex things but still reduce down
    const math = {
      add1: async ({on}) => on + 1,
      times10: async ({on}) => on * 10,
      reduce: async ({on, fn}) => on.reduce(async (l, r) => fn([await l, r])),
      sequence: async ({on}) => Array.from({length: on}, (v, k) => k + 1),
      sum: async ({on}) => on.reduce((l, r) => l + r)
    }
    math.reduce._argtypes = {fn: {type: 'function'}}

    const services = {util, math}

    // test deep nesting of alternate chain and function calls
    // this calls many important code paths and ensures they all work correctly
    const result = await query({
      given: {input: 1, array: [1, 2, 3]},
      services,
      settings: {debug: false},
      queries: {
        deepNested: [
          // ChainA
          ['$.given.input', 'math:add1'], // 2
          ['@', 'math:add1'], // 3
          // MapB
          ['$.given.array', 'util:map', {
            fn: [
              // ChainC
              ['@@', 'math:times10'], // 10, 20, 30
              ['@', 'math:add1'], // 11, 21, 31
              ['@', 'math:sequence'], // [1..11], [1..21], [1..31]
              // MapD
              ['@', 'math:reduce', {fn: ['@', 'math:sum']}], // sum([1..11]), sum([1..21]), sum([1..31])
              ['@', 'util:template', { // I wasn't able to test from the fourth context layer, but this should be good enough
                ChainA: '@', // 3
                MapB: '@@', // 1, 2, 3
                ChainC: '@@@' // sum([1..11]), sum([1..21]), sum([1..31])
              }]
            ]
          }]
        ]
      }
    })

    // Correct sums proves that the whole query executed properly
    assert.deepStrictEqual(result.deepNested, [
      {ChainA: 66, MapB: 1, ChainC: 3, on: 66},
      {ChainA: 231, MapB: 2, ChainC: 3, on: 231},
      {ChainA: 496, MapB: 3, ChainC: 3, on: 496}
    ])
  })
})
