import assert from 'node:assert'
import {describe, it} from 'node:test'
import query from '../query.js'
import util from '../services/util.js'

describe('Function Arguments Tests', () => {
  describe('Raw Function Arguments Should Be Rejected', () => {
    it('should reject raw functions with helpful error message in util.filter', async () => {
      await assert.rejects(
        query({
          given: {items: ['apple', 'banana', 'cherry']},
          services: {util},
          queries: {
            filtered: ['util:filter', {
              on: '$.given.items',
              service: item => item.includes('a') // Raw function - should fail
            }]
          }
        }),
        (error) => {
          // Check that the error message tells user not to use raw functions
          return error.message.includes('Raw JavaScript functions are not supported') ||
                 error.message.includes('Use service descriptors instead') ||
                 error.message.includes('Functions must be service calls')
        }
      )
    })

    it('should reject raw functions with helpful error message in util.map', async () => {
      await assert.rejects(
        query({
          given: {items: [1, 2, 3]},
          services: {util},
          queries: {
            mapped: ['util:map', {
              on: '$.given.items',
              service: x => x * 2 // Raw function - should fail
            }]
          }
        }),
        (error) => {
          // Check that the error message tells user not to use raw functions
          return error.message.includes('Raw JavaScript functions are not supported') ||
                 error.message.includes('Use service descriptors instead') ||
                 error.message.includes('Functions must be service calls')
        }
      )
    })

    it('should reject raw functions in method syntax', async () => {
      await assert.rejects(
        query({
          given: {items: ['apple', 'banana', 'cherry']},
          services: {util},
          queries: {
            filtered: ['$.given.items', 'util:filter', {
              service: item => item.includes('a') // Raw function - should fail
            }]
          }
        }),
        (error) => {
          return error.message.includes('Raw JavaScript functions are not supported') ||
                 error.message.includes('Use service descriptors instead') ||
                 error.message.includes('Functions must be service calls')
        }
      )
    })
  })

  describe('Proper Service Descriptor Functions Should Work', () => {
    const testServices = {
      util,
      string: {
        async includesLetter({text, letter}) {
          return text.includes(letter)
        },
        async toUpper({text}) {
          return text.toUpperCase()
        }
      }
    }

    it('should work with service descriptor in util.filter', async () => {
      const result = await query({
        given: {items: ['apple', 'banana', 'cherry']},
        services: testServices,
        queries: {
          filtered: ['util:filter', {
            on: '$.given.items',
            service: ['string:includesLetter', {text: '@', letter: 'a'}]
          }]
        }
      })

      assert.deepStrictEqual(result.filtered, ['apple', 'banana'])
    })

    it('should work with service descriptor in util.map', async () => {
      const result = await query({
        given: {items: ['apple', 'banana']},
        services: testServices,
        queries: {
          mapped: ['util:map', {
            on: '$.given.items',
            service: ['string:toUpper', {text: '@'}]
          }]
        }
      })

      assert.deepStrictEqual(result.mapped, ['APPLE', 'BANANA'])
    })

    it('should work with template objects', async () => {
      const result = await query({
        given: {items: ['apple', 'banana']},
        services: testServices,
        queries: {
          mapped: ['util:map', {
            on: '$.given.items',
            service: {
              original: '@',
              upper: '@' // Simple template access (extra space to test linter)
            }
          }]
        }
      })

      assert.deepStrictEqual(result.mapped, [
        {original: 'apple', upper: 'apple'},
        {original: 'banana', upper: 'banana'}
      ])
    })
  })
})