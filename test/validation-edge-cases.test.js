/**
 * Test edge cases and error handling in the validation system
 */

import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import query from '../index.js'

describe('Validation Edge Cases and Error Handling', () => {
  describe('Invalid validation syntax in user queries', () => {
    it('should handle undefined schema descriptors gracefully', async () => {
      const testService = {
        async test(args) {
          return args.value
        }
      }

      const config = {
        services: {testService},
        queries: {
          result: ['testService:test', {
            value: 'hello',
            precheck: {
              value: undefined // Invalid: undefined schema
            }
          }]
        }
      }

      await assert.rejects(
        query(config),
        /Invalid schema descriptor/
      )
    })

    it('should handle null schema descriptors gracefully', async () => {
      const testService = {
        async test(args) {
          return args.value
        }
      }

      const config = {
        services: {testService},
        queries: {
          result: ['testService:test', {
            value: 'hello',
            precheck: {
              value: null // Invalid: null schema
            }
          }]
        }
      }

      await assert.rejects(
        query(config),
        /Invalid schema descriptor/
      )
    })

    it('should handle invalid array syntax (missing element schema)', async () => {
      const testService = {
        async test(args) {
          return args.items
        }
      }

      const config = {
        services: {testService},
        queries: {
          result: ['testService:test', {
            items: [1, 2, 3],
            precheck: {
              items: ['array'] // Now valid: defaults to ['array', ['any']]
            }
          }]
        }
      }

      // Should not throw - ['array'] is now valid syntax
      const result = await query(config)
      assert.deepStrictEqual(result, {result: [1, 2, 3]})
    })

    it('should handle invalid primitive types', async () => {
      const testService = {
        async test(args) {
          return args.value
        }
      }

      const config = {
        services: {testService},
        queries: {
          result: ['testService:test', {
            value: 'hello',
            precheck: {
              value: ['invalidType'] // Invalid: unknown primitive type
            }
          }]
        }
      }

      await assert.rejects(
        query(config),
        /Unknown primitive type: 'invalidType'/
      )
    })

    it('should handle malformed object syntax', async () => {
      const testService = {
        async test(args) {
          return args.value
        }
      }

      const config = {
        services: {testService},
        queries: {
          result: ['testService:test', {
            value: 'hello',
            precheck: {
              value: 'not-an-array-or-object' // Invalid: wrong format
            }
          }]
        }
      }

      await assert.rejects(
        query(config),
        /Unknown primitive type: 'not-an-array-or-object'/
      )
    })

    it('should handle invalid wrapper function syntax', async () => {
      const testService = {
        async test(args) {
          return args.value
        }
      }

      const config = {
        services: {testService},
        queries: {
          result: ['testService:test', {
            value: 'hello',
            precheck: {
              value: ['unknownWrapper', 'someArg'] // Invalid: unknown wrapper
            }
          }]
        }
      }

      await assert.rejects(
        query(config),
        /Unknown primitive type: 'unknownWrapper'/
      )
    })

    it('should handle empty enum values', async () => {
      const testService = {
        async test(args) {
          return args.value
        }
      }

      const config = {
        services: {testService},
        queries: {
          result: ['testService:test', {
            value: 'light',
            precheck: {
              value: ['enum', []] // Invalid: empty enum
            }
          }]
        }
      }

      await assert.rejects(
        query(config),
        /Enum must have an array of values/
      )
    })
  })

  describe('Invalid validation syntax in service definitions', () => {
    it('should handle service with invalid validator syntax', async () => {
      const testService = {
        async test(args) {
          return args.value
        }
      }

      // Invalid service-level validator
      testService.test._validators = {
        precheck: {
          value: ['invalid-syntax-here']
        }
      }

      const config = {
        services: {testService},
        queries: {
          result: ['testService:test', {value: 'hello'}]
        }
      }

      await assert.rejects(
        query(config),
        /Unknown primitive type: 'invalid-syntax-here'/
      )
    })

    it('should handle mixed valid and invalid validators', async () => {
      const testService = {
        async test(args) {
          return args
        }
      }

      testService.test._validators = {
        precheck: {
          validField: ['string'],
          invalidField: ['not-a-real-type'] // This should cause error
        }
      }

      const config = {
        services: {testService},
        queries: {
          result: ['testService:test', {
            validField: 'hello',
            invalidField: 'world'
          }]
        }
      }

      await assert.rejects(
        query(config),
        /Unknown primitive type: 'not-a-real-type'/
      )
    })
  })

  describe('Edge cases in validation compilation', () => {
    it('should handle service with only postcheck validation', async () => {
      const testService = {
        async test(args) {
          return {result: args.value.toUpperCase()}
        }
      }

      testService.test._validators = {
        postcheck: {
          result: ['string']
        }
      }

      const config = {
        services: {testService},
        queries: {
          result: ['testService:test', {value: 'hello'}]
        }
      }

      const result = await query(config)
      assert.deepStrictEqual(result, {result: {result: 'HELLO'}})
    })

    it('should handle empty validator objects', async () => {
      const testService = {
        async test(args) {
          return args.value
        }
      }

      testService.test._validators = {} // Empty validators

      const config = {
        services: {testService},
        queries: {
          result: ['testService:test', {value: 'hello'}]
        }
      }

      const result = await query(config)
      assert.deepStrictEqual(result, {result: 'hello'})
    })

    it('should handle validator with no precheck or postcheck', async () => {
      const testService = {
        async test(args) {
          return args.value
        }
      }

      testService.test._validators = {
        someOtherField: 'ignored' // Should be ignored
      }

      const config = {
        services: {testService},
        queries: {
          result: ['testService:test', {value: 'hello'}]
        }
      }

      const result = await query(config)
      assert.deepStrictEqual(result, {result: 'hello'})
    })
  })

  describe('Validation sequencing (service-level + user-level)', () => {
    it('should run both service-level and user-level validations', async () => {
      const testService = {
        async test(args) {
          return args.value
        }
      }

      // Service requires string
      testService.test._validators = {
        precheck: {
          value: ['string']
        }
      }

      const config = {
        services: {testService},
        queries: {
          result: ['testService:test', {
            value: 'hello',
            precheck: {
              value: ['string', {min: 3}] // User adds length constraint
            }
          }]
        }
      }

      const result = await query(config)
      assert.deepStrictEqual(result, {result: 'hello'})
    })

    it('should fail if service-level validation fails', async () => {
      const testService = {
        async test(args) {
          return args.value
        }
      }

      testService.test._validators = {
        precheck: {
          value: ['number'] // Service expects number
        }
      }

      const config = {
        services: {testService},
        queries: {
          result: ['testService:test', {
            value: 'hello', // But we provide string
            precheck: {
              value: ['string'] // User expects string
            }
          }]
        }
      }

      await assert.rejects(
        query(config),
        /precheck validation failed/
      )
    })

    it('should fail if user-level validation fails', async () => {
      const testService = {
        async test(args) {
          return args.value
        }
      }

      testService.test._validators = {
        precheck: {
          value: ['string'] // Service expects string
        }
      }

      const config = {
        services: {testService},
        queries: {
          result: ['testService:test', {
            value: 'hi', // Too short for user constraint
            precheck: {
              value: ['string', {min: 5}] // User requires min 5 chars
            }
          }]
        }
      }

      await assert.rejects(
        query(config),
        /precheck validation failed/
      )
    })
  })
})