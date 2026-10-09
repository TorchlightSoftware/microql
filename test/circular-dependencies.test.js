import assert from 'node:assert'
import {describe, it} from 'node:test'
import query from '../node.js'
import util from '../services/util.js'
import {math, test, data} from './test-services.js'

describe('Circular Dependency Detection Tests', () => {
  const services = {util, math, test, data}

  describe('Simple Circular Dependencies', () => {
    it('should detect simple A -> B -> A cycle', async () => {
      await assert.rejects(
        query({
          services,
          phases: {
            a: ['GET [test]/identity', {value: '$b'}],
            b: ['GET [test]/identity', {value: '$a'}]
          }
        }),
        /Circular dependency detected at compile time: a, b/
      )
    })

    it('should detect self-reference A -> A', async () => {
      await assert.rejects(
        query({
          services,
          phases: {
            a: ['GET [test]/identity', {value: '$a'}]
          }
        }),
        /Circular dependency detected at compile time: a/
      )
    })

    it('should detect longer cycle A -> B -> C -> A', async () => {
      await assert.rejects(
        query({
          services,
          phases: {
            a: ['GET [test]/identity', {value: '$c'}],
            b: ['GET [test]/identity', {value: '$a'}],
            c: ['GET [test]/identity', {value: '$b'}]
          }
        }),
        /Circular dependency detected at compile time: a, b, c/
      )
    })

    it('should detect cycle with multiple dependency A -> [B, C], B -> C, C -> A', async () => {
      await assert.rejects(
        query({
          services,
          phases: {
            a: ['GET [test]/combine', {a: '$b', b: '$c'}],
            b: ['GET [test]/identity', {value: '$c'}],
            c: ['GET [test]/identity', {value: '$a'}]
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
          phases: {
            // Chain that depends on external query
            chainA: [
              ['$given.input', 'GET [math]/add1'],
              ['$external', 'GET [math]/add'] // Depends on external
            ],
            // External query depends on result of chain
            external: ['GET [test]/identity', {value: '$chainA'}]
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
          phases: {
            // Complex chain with map that depends on result
            deepNested: [
              ['$given.array', 'GET [util]/each', {
                as: 'n',
                service: [
                  ['@n', 'GET [math]/times10'],
                  ['$result', 'GET [math]/add'] // Circular dependency on result
                ]
              }]
            ],
            // Result depends on the nested computation
            result: ['GET [test]/identity', {value: '$deepNested'}]
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
          phases: {
            processedData: [
              ['$given.numbers', 'GET [util]/each', {
                service: ['$multiplier', 'GET [math]/multiply'] // Depends on multiplier
              }]
            ],
            multiplier: ['$processedData', 'GET [math]/sum'], // Depends on processedData
            finalResult: ['GET [test]/identity', {value: '$processedData'}]
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
          phases: {
            filtered: ['$given.items', 'GET [data]/filter', {
              service: ['$validator', 'GET [test]/identity'] // Depends on validator
            }],
            validator: ['GET [test]/identity', {value: '$filtered'}] // Depends on filtered
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
          phases: {
            // First level chain
            levelOne: [
              ['$given.input', 'GET [math]/add1'],
              ['$levelTwo', 'GET [math]/add'] // Depends on levelTwo
            ],
            // Second level chain
            levelTwo: [
              ['$levelOne', 'GET [math]/times10'], // Depends on levelOne
              ['@', 'GET [math]/add1']
            ],
            // Third query to make it more complex
            levelThree: ['GET [test]/double', {value: '$levelTwo'}]
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
          phases: {
            // Valid independent query
            validQuery: ['GET [math]/add1', {on: '$given.input'}],

            // Circular dependency pair
            circular1: ['GET [test]/identity', {value: '$circular2'}],
            circular2: ['GET [test]/identity', {value: '$circular1'}],

            // Another valid query that depends on valid query
            anotherValid: ['GET [math]/times10', {on: '$validQuery'}]
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
          phases: {
            chainWithCycle: [
              ['$given.input', 'GET [math]/add1'],
              ['@', 'GET [math]/add1'],
              ['$given.array', 'GET [util]/each', {
                as: 'n',
                service: [
                  ['$cyclicDep', 'GET [math]/times10'], // Depends on cyclicDep
                  ['@', 'GET [math]/add1'],
                  ['@', 'GET [math]/sequence'],
                  ['GET [math]/reduce', {on: '@', service: ['GET [math]/sum', {on: '@'}]}]
                ]
              }]
            ],
            // Creates the cycle
            cyclicDep: ['GET [test]/identity', {value: '$chainWithCycle'}]
          }
        }),
        /Circular dependency detected at compile time: chainWithCycle, cyclicDep/
      )
    })
  })
})
