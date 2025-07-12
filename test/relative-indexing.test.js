import { describe, it } from 'mocha'
import assert from 'assert'
import query from '../query.js'
import util from '../util.js'

describe('Relative Indexing Context Tests', () => {
  
  // Test data with nested structure
  const testData = {
    companies: [
      {
        name: 'TechCorp',
        departments: [
          {
            name: 'Engineering',
            teams: [
              { name: 'Frontend', members: ['Alice', 'Bob'] },
              { name: 'Backend', members: ['Charlie'] }
            ]
          }
        ]
      }
    ]
  }
  
  // Mock service to test context levels
  const testService = {
    checkContext: ({ level1, level2, level3 }) => {
      return {
        level1: level1?.name || level1,
        level2: level2?.name || level2,
        level3: level3?.name || level3
      }
    }
  }
  
  testService.checkContext._params = {
    level1: {},
    level2: {},
    level3: {}
  }
  
  const services = { util, test: testService }
  
  it('should use relative indexing for @ symbols', async () => {
    // Simpler test first - just one level of nesting
    const result = await query({
      given: { items: [1, 2] },
      services,
      methods: ['util'],
      query: {
        simple: ['$.given.items', 'util:map', {
          fn: ['test', 'checkContext', {
            level1: '@'  // Should be the current item (1 or 2)
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
        outer: [
          { inner: [1, 2] },
          { inner: [3, 4] }
        ]
      },
      services,
      methods: ['util'],
      query: {
        nested: ['$.given.outer', 'util:flatMap', {
          fn: ['util', 'map', {
            on: '@.inner',
            fn: ['test', 'checkContext', {
              level1: '@',      // Should be inner item (current context)
              level2: '@@'      // Should be outer item (parent context)
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
    assert.deepStrictEqual(firstResult.level2, { inner: [1, 2] })
  })
  
  it('should handle chain results in context stack', async () => {
    const chainService = {
      step1: ({ input }) => ({ step1Result: input + '-step1' }),
      step2: ({ input }) => ({ step2Result: input + '-step2' }),
      final: ({ chain1, chain2 }) => ({
        chain1,
        chain2
      })
    }
    
    chainService.step1._params = {}
    chainService.step2._params = {}
    chainService.final._params = {}
    
    const result = await query({
      given: { value: 'test' },
      services: { util, chain: chainService },
      methods: ['util'],
      query: {
        // Test chains in functions
        result: ['util', 'map', {
          on: [1, 2],
          fn: ['chain', 'final', {
            chain1: '@',    // Should be current iteration item
            chain2: '@'     // Same - we're not in a chain context here
          }]
        }]
      }
    })
    
    assert.strictEqual(result.result.length, 2)
    assert.strictEqual(result.result[0].chain1, 1)
    assert.strictEqual(result.result[0].chain2, 1)
  })
  
  it('should throw clear error for invalid context levels', async () => {
    try {
      await query({
        given: { items: [1, 2] },
        services,
        methods: ['util'],
        query: {
          invalid: ['$.given.items', 'util:map', {
            fn: ['test', 'checkContext', {
              level1: '@@@@' // Too many levels
            }]
          }]
        }
      })
      assert.fail('Should have thrown error for invalid context level')
    } catch (error) {
      assert(error.message.includes('@@@@ used but context not deep enough'))
      assert(error.message.includes('levels available'))
    }
  })
})