import assert from 'node:assert'
import {describe, it} from 'node:test'
import query from '../query.js'

describe('Retry Tests', () => {
  describe('Basic Retry Behavior', () => {
    it('should retry failed operations', async () => {
      let callCount = 0

      const services = {
        flaky: {
          async process(_args) {
            callCount++
            if (callCount < 3) {
              throw new Error('Service temporarily unavailable')
            }
            return {success: true, attempts: callCount}
          }
        }
      }

      const result = await query({
        given: {value: 'test'},
        services,
        queries: {
          result: [
            'flaky',
            'process',
            {
              input: '$.given.value',
              retry: 3 // Will try up to 4 times total (1 initial + 3 retries)
            }
          ]
        },
        select: 'result'
      })

      assert.strictEqual(result.success, true)
      assert.strictEqual(result.attempts, 3)
    })

    it('should fail after exhausting retries', async () => {
      let callCount = 0

      const services = {
        broken: {
          async process(_args) {
            callCount++
            throw new Error('Service permanently broken')
          }
        }
      }

      try {
        await query({
          given: {value: 'test'},
          services,
          queries: {
            result: [
              'broken',
              'process',
              {
                input: '$.given.value',
                retry: 2 // Will try 3 times total
              }
            ]
          },
          select: 'result'
        })
        assert.fail('Should have thrown error')
      } catch (error) {
        assert(error.message.includes('Service permanently broken'))
        assert.strictEqual(callCount, 3) // 1 initial + 2 retries
      }
    })

    it('should work with no retry specified', async () => {
      let callCount = 0

      const services = {
        stable: {
          async process(_args) {
            callCount++
            return {success: true}
          }
        }
      }

      const result = await query({
        given: {value: 'test'},
        services,
        queries: {
          result: [
            'stable',
            'process',
            {
              input: '$.given.value'
              // No retry specified
            }
          ]
        },
        select: 'result'
      })

      assert.strictEqual(result.success, true)
      assert.strictEqual(callCount, 1) // No retries
    })

    it('should pass retry and timeout values via settings', async () => {
      const services = {
        aware: {
          async check(args) {
            return {
              retryReceived: args.settings?.retry,
              timeoutReceived: args.settings?.timeout,
              inputReceived: args.input
            }
          }
        }
      }

      // Add settings argtype so settings get injected
      services.aware.check._argtypes = {
        settings: 'settings'
      }

      const result = await query({
        given: {value: 'test'},
        services,
        queries: {
          result: [
            'aware',
            'check',
            {
              input: '$.given.value',
              retry: 3,
              timeout: 5000
            }
          ]
        },
        select: 'result'
      })

      assert.strictEqual(result.retryReceived, 3)
      assert.strictEqual(result.timeoutReceived, 5000)
      assert.strictEqual(result.inputReceived, 'test')
    })
  })

  describe('Retry with Chains', () => {
    it('should retry individual steps in a chain', async () => {
      const callCounts = {step1: 0, step2: 0}

      const services = {
        chain: {
          async step1(args) {
            callCounts.step1++
            return {step: 1, data: args.input}
          },
          async step2(args) {
            callCounts.step2++
            if (callCounts.step2 < 2) {
              throw new Error('Step 2 failed')
            }
            return {step: 2, data: args.input, previous: args.previous}
          }
        }
      }

      const result = await query({
        given: {value: 'test'},
        services,
        queries: {
          result: [
            ['chain', 'step1', {input: '$.given.value'}],
            [
              'chain',
              'step2',
              {
                input: '$.given.value',
                previous: '@',
                retry: 2
              }
            ]
          ]
        },
        select: 'result'
      })

      assert.strictEqual(result.step, 2)
      assert.strictEqual(callCounts.step1, 1) // No retry on step 1
      assert.strictEqual(callCounts.step2, 2) // 1 initial + 1 retry
    })
  })

  describe('Retry with Method Syntax', () => {
    it('should work with method syntax', async () => {
      let callCount = 0

      const services = {
        processor: {
          transform: async ({on, retry}) => {
            callCount++
            if (callCount < 2) {
              throw new Error('Transform failed')
            }
            return on.map((item) => ({...item, processed: true}))
          }
        }
      }

      const result = await query({
        given: {
          items: [{id: 1}, {id: 2}]
        },
        services,
        methods: ['processor'],
        queries: {
          // Method syntax with retry
          result: ['$.given.items', 'processor:transform', {retry: 2}]
        },
        select: 'result'
      })

      assert.strictEqual(result.length, 2)
      assert.strictEqual(result[0].processed, true)
      assert.strictEqual(callCount, 2)
    })
  })
})
