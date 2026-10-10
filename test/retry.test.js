import assert from 'node:assert'
import {describe, it} from 'node:test'
import query from '../node.js'

describe('Retry Tests', () => {
  describe('Basic Retry Behavior', () => {
    it('should retry failed operations', async () => {
      let callCount = 0

      const services = {
        flaky: {
          async '/process'(_args) {
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
        phases: {
          result: [
            'GET [flaky]/process',
            {
              input: '$given.value',
              retry: 3 // Will try up to 4 times total (1 initial + 3 retries)
            }
          ]
        },
        select: '$result'
      })

      assert.strictEqual(result.success, true)
      assert.strictEqual(result.attempts, 3)
    })

    it('should fail after exhausting retries', async () => {
      let callCount = 0

      const services = {
        broken: {
          async '/process'(_args) {
            callCount++
            throw new Error('Service permanently broken')
          }
        }
      }

      try {
        await query({
          given: {value: 'test'},
          services,
          phases: {
            result: [
              'GET [broken]/process',
              {
                input: '$given.value',
                retry: 2 // Will try 3 times total
              }
            ]
          },
          select: '$result'
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
          async '/process'(_args) {
            callCount++
            return {success: true}
          }
        }
      }

      const result = await query({
        given: {value: 'test'},
        services,
        phases: {
          result: [
            'GET [stable]/process',
            {
              input: '$given.value'
              // No retry specified
            }
          ]
        },
        select: '$result'
      })

      assert.strictEqual(result.success, true)
      assert.strictEqual(callCount, 1) // No retries
    })

    it('should pass retry and timeout values via settings', async () => {
      const services = {
        aware: {
          async '/check'(args) {
            return {
              retryReceived: args.settings?.retry,
              timeoutReceived: args.settings?.timeout,
              inputReceived: args.input
            }
          }
        }
      }

      // Add settings argtype so settings get injected
      services.aware['/check']._argtypes = {
        settings: {type: 'settings'}
      }

      const result = await query({
        given: {value: 'test'},
        services,
        phases: {
          result: [
            'GET [aware]/check',
            {
              input: '$given.value',
              retry: 3,
              timeout: 5000
            }
          ]
        },
        select: '$result'
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
          async '/step1'(args) {
            callCounts.step1++
            return {step: 1, data: args.input}
          },
          async '/step2'(args) {
            callCounts.step2++
            if (callCounts.step2 < 2) {
              throw new Error('Step 2 failed')
            }
            return {step: 2, data: args.input, previous: args.previous}
          }
        }
      }

      // Add argOrder metadata for method syntax
      services.chain['/step1']._argtypes = {on: {argOrder: 0}}
      services.chain['/step2']._argtypes = {on: {argOrder: 0}}

      const result = await query({
        given: {value: 'test'},
        services,
        phases: {
          result: [
            ['GET [chain]/step1', {input: '$given.value'}],
            [
              'GET [chain]/step2',
              {
                input: '$given.value',
                previous: '@',
                retry: 2
              }
            ]
          ]
        },
        select: '$result'
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
          '/transform': async ({on, _retry}) => {
            callCount++
            if (callCount < 2) {
              throw new Error('Transform failed')
            }
            return on.map((item) => ({...item, processed: true}))
          }
        }
      }

      // Add argOrder metadata for method syntax
      services.processor['/transform']._argtypes = {on: {argOrder: 0}}

      const result = await query({
        given: {
          items: [{id: 1}, {id: 2}]
        },
        services,
        phases: {
          // Method syntax with retry
          result: ['$given.items', 'GET [processor]/transform', {retry: 2}]
        },
        select: '$result'
      })

      assert.strictEqual(result.length, 2)
      assert.strictEqual(result[0].processed, true)
      assert.strictEqual(callCount, 2)
    })
  })

  describe('Retry and validation', () => {
    // A writer whose first drafts are too long.
    const writer = (badDrafts) => {
      const service = {
        calls: 0,
        async '/write'({topic}) {
          service.calls++
          return {text: service.calls <= badDrafts ? `${topic} `.repeat(100) : topic}
        }
      }
      return service
    }
    const draft = (retry) => ['GET [writer]/write', {topic: 'retry', retry, postcheck: {text: ['string', {max: 50}]}}]

    it('retries a call whose result fails its postcheck', async () => {
      const service = writer(1)
      const result = await query({services: {writer: service}, phases: {draft: draft(2)}, select: '$draft'})
      assert.deepStrictEqual(result, {text: 'retry'})
      assert.strictEqual(service.calls, 2)
    })

    it('fails once its retries are spent', async () => {
      const service = writer(5)
      await assert.rejects(
        query({services: {writer: service}, phases: {draft: draft(2)}}),
        /Service Call Validation postcheck failed/
      )
      assert.strictEqual(service.calls, 3)
    })

    it('does not retry a precheck failure, which no attempt can change', async () => {
      const service = writer(0)
      await assert.rejects(
        query({services: {writer: service}, phases: {draft: ['GET [writer]/write', {topic: 5, retry: 3, precheck: {topic: ['string']}}]}}),
        /Service Call Validation precheck failed/
      )
      assert.strictEqual(service.calls, 0)
    })
  })
})
