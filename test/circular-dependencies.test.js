import assert from 'node:assert'
import {describe, it} from 'node:test'
import query from '../query.js'
import util from '../services/util.js'
import {math, test, data} from './test-services.js'

describe('Circular Dependency Detection Tests', () => {
  const services = {util, math, test, data}

  describe('Simple Circular Dependencies', () => {
    it('should detect simple A -> B -> A cycle', async () => {
      await assert.rejects(
        query({
          services,
          queries: {
            a: ['test', 'identity', {value: '$.b'}],
            b: ['test', 'identity', {value: '$.a'}]
          }
        }),
        /Circular dependency detected at compile time: a, b/
      )
    })

    it('should detect self-reference A -> A', async () => {
      await assert.rejects(
        query({
          services,
          queries: {
            a: ['test', 'identity', {value: '$.a'}]
          }
        }),
        /Circular dependency detected at compile time: a/
      )
    })

    it('should detect longer cycle A -> B -> C -> A', async () => {
      await assert.rejects(
        query({
          services,
          queries: {
            a: ['test', 'identity', {value: '$.c'}],
            b: ['test', 'identity', {value: '$.a'}],
            c: ['test', 'identity', {value: '$.b'}]
          }
        }),
        /Circular dependency detected at compile time: a, b, c/
      )
    })

    it('should detect cycle with multiple dependency A -> [B, C], B -> C, C -> A', async () => {
      await assert.rejects(
        query({
          services,
          queries: {
            a: ['test', 'combine', {a: '$.b', b: '$.c'}],
            b: ['test', 'identity', {value: '$.c'}],
            c: ['test', 'identity', {value: '$.a'}]
          }
        }),
        /Circular dependency detected at compile time: a, b, c/
      )
    })
  })

  describe('Complex Chain Circular Dependencies', () => {
    it('should detect cycle in chain with external dependency', async () => {
      await assert.rejects(
        query({
          given: {input: 1},
          services,
          queries: {
            // Chain that depends on external query
            chainA: [
              ['$.given.input', 'math:add1'],
              ['$.external', 'math:add'] // Depends on external
            ],
            // External query depends on result of chain
            external: ['test', 'identity', {value: '$.chainA'}]
          }
        }),
        /Circular dependency detected at compile time: chainA, external/
      )
    })

    it('should detect cycle across nested chains and maps', async () => {
      await assert.rejects(
        query({
          given: {array: [1, 2, 3]},
          services,
          queries: {
            // Complex chain with map that depends on result
            deepNested: [
              ['$.given.array', 'util:map', {
                fn: [
                  ['@', 'math:times10'],
                  ['$.result', 'math:add'] // Circular dependency on result
                ]
              }]
            ],
            // Result depends on the nested computation
            result: ['test', 'identity', {value: '$.deepNested'}]
          }
        }),
        /Circular dependency detected at compile time: deepNested, result/
      )
    })

    it('should detect cycle with method syntax in chains', async () => {
      await assert.rejects(
        query({
          given: {numbers: [1, 2, 3]},
          services,
          queries: {
            processedData: [
              ['$.given.numbers', 'util:map', {
                fn: ['$.multiplier', 'math:multiply'] // Depends on multiplier
              }]
            ],
            multiplier: ['$.processedData', 'math:sum'], // Depends on processedData
            finalResult: ['test', 'identity', {value: '$.processedData'}]
          }
        }),
        /Circular dependency detected at compile time: processedData, multiplier, finalResult/
      )
    })

    it('should detect cycle in deeply nested function arguments', async () => {
      await assert.rejects(
        query({
          given: {items: ['a', 'b', 'c']},
          services,
          queries: {
            filtered: ['$.given.items', 'data:filter', {
              predicate: ['$.validator', 'test:identity'] // Depends on validator
            }],
            validator: ['test', 'identity', {value: '$.filtered'}] // Depends on filtered
          }
        }),
        /Circular dependency detected at compile time: filtered, validator/
      )
    })

    it('should detect cycle across multiple chain levels', async () => {
      await assert.rejects(
        query({
          given: {input: 5},
          services,
          queries: {
            // First level chain
            levelOne: [
              ['$.given.input', 'math:add1'],
              ['$.levelTwo', 'math:add'] // Depends on levelTwo
            ],
            // Second level chain
            levelTwo: [
              ['$.levelOne', 'math:times10'], // Depends on levelOne
              ['@', 'math:add1']
            ],
            // Third query to make it more complex
            levelThree: ['test', 'double', {value: '$.levelTwo'}]
          }
        }),
        /Circular dependency detected at compile time: levelOne, levelTwo/
      )
    })
  })

  describe('Mixed Valid and Invalid Dependencies', () => {
    it('should detect cycle while preserving valid independent queries', async () => {
      await assert.rejects(
        query({
          given: {input: 10},
          services,
          queries: {
            // Valid independent query
            validQuery: ['math', 'add1', {on: '$.given.input'}],

            // Circular dependency pair
            circular1: ['test', 'identity', {value: '$.circular2'}],
            circular2: ['test', 'identity', {value: '$.circular1'}],

            // Another valid query that depends on valid query
            anotherValid: ['math', 'times10', {on: '$.validQuery'}]
          }
        }),
        /Circular dependency detected at compile time: circular1, circular2/
      )
    })

    it('should detect cycle in complex scenario similar to deep nesting test', async () => {
      // This is based on the "deep nesting" test but introduces circular dependencies
      await assert.rejects(
        query({
          given: {input: 1, array: [1, 2, 3]},
          services,
          queries: {
            chainWithCycle: [
              ['$.given.input', 'math:add1'],
              ['@', 'math:add1'],
              ['$.given.array', 'util:map', {
                fn: [
                  ['$.cyclicDep', 'math:times10'], // Depends on cyclicDep
                  ['@', 'math:add1'],
                  ['@', 'math:sequence'],
                  ['@', 'math:reduce', {fn: ['@', 'math:sum']}]
                ]
              }]
            ],
            // Creates the cycle
            cyclicDep: ['test', 'identity', {value: '$.chainWithCycle'}]
          }
        }),
        /Circular dependency detected at compile time: chainWithCycle, cyclicDep/
      )
    })
  })
})
