import assert from 'node:assert'
import {describe, it, beforeEach} from 'node:test'
import query from '../query.js'
import {rm} from 'fs/promises'

const CACHEDIR = '.cache-test-cache-error-handling'

describe('Cache Error Handling Tests', () => {
  // Clean up cache before each test
  beforeEach(async () => {
    await rm(CACHEDIR, {recursive: true, force: true})
    // Reset all service counters
    unreliableService.callCount = 0
    failingServices.serviceCallCount = 0
    failingServices.errorHandlerCallCount = 0
    conditionalServices.serviceCallCount = 0
    conditionalServices.errorHandlerCallCount = 0
    testServices.serviceCallCount = 0
  })

  // Reusable services
  const unreliableService = {
    unreliable: {
      async getData({value}) {
        unreliableService.callCount++
        if (unreliableService.callCount === 1) {
          throw new Error('Service failed')
        }
        return {processed: value, attempt: unreliableService.callCount}
      }
    }
  }
  unreliableService.callCount = 0

  const failingServices = {
    failing: {
      async process() {
        failingServices.serviceCallCount++
        throw new Error('Always fails')
      }
    },
    errorHandler: {
      async handleError() {
        failingServices.errorHandlerCallCount++
        return {errorHandled: true, handlerCall: failingServices.errorHandlerCallCount}
      }
    }
  }
  failingServices.serviceCallCount = 0
  failingServices.errorHandlerCallCount = 0

  const conditionalServices = {
    conditional: {
      async process({shouldFail}) {
        conditionalServices.serviceCallCount++
        if (shouldFail) {
          throw new Error('Conditional failure')
        }
        return {serviceResult: true, call: conditionalServices.serviceCallCount}
      }
    },
    errorHandler: {
      async handleError() {
        conditionalServices.errorHandlerCallCount++
        return {errorResult: true, call: conditionalServices.errorHandlerCallCount}
      }
    }
  }
  conditionalServices.serviceCallCount = 0
  conditionalServices.errorHandlerCallCount = 0

  const testServices = {
    test: {
      async getData({value}) {
        testServices.serviceCallCount++
        if (value === 'fail') {
          throw new Error('Intentional failure')
        }
        return {data: value, call: testServices.serviceCallCount}
      }
    },
    errorHandler: {
      async handle() {return {error: 'handled'}}
    }
  }
  testServices.serviceCallCount = 0

  // Base query template
  const baseQuery = {
    settings: {cache: {configDir: CACHEDIR}}
  }

  describe('Error caching prevention', () => {
    it('should not cache errors when service throws exception', async () => {
      const q = {
        ...baseQuery,
        given: {input: 'test'},
        services: unreliableService,
        queries: {
          result: ['unreliable:getData', {value: '$.given.input', cache: true}]
        },
        select: 'result'
      }

      // First call should fail
      await assert.rejects(
        query(q),
        /Service failed/
      )

      // Second call should succeed and not return cached error
      const result = await query(q)

      assert.strictEqual(unreliableService.callCount, 2) // Should have been called twice
      assert.strictEqual(result.processed, 'test')
      assert.strictEqual(result.attempt, 2)
    })

    it('should not cache onError handler results when ignoreErrors is true', async () => {
      const q = {
        ...baseQuery,
        services: failingServices,
        queries: {
          result: ['failing:process', {
            onError: ['errorHandler:handleError'],
            ignoreErrors: true,
            cache: true
          }]
        },
        select: 'result'
      }

      // First call with error handler
      const result1 = await query(q)

      // Second call should not return cached error handler result
      const result2 = await query(q)

      // Both calls should have invoked the service and error handler
      assert.strictEqual(failingServices.serviceCallCount, 2)
      assert.strictEqual(failingServices.errorHandlerCallCount, 2)

      // Results should be undefined
      assert.deepEqual(result1, {
        errorHandled: true,
        handlerCall: 1
      })

      assert.deepEqual(result2, {
        errorHandled: true,
        handlerCall: 2
      })
    })
  })

  describe('Timestamp-based verification of cache behavior', () => {
    it('should not cache error handler results between identical calls', async () => {
      const timestampServices = {
        failingService: {
          async process() {
            throw new Error('Always fails')
          }
        },
        errorHandler: {
          async handle() {
            return {handled: true, timestamp: Date.now()}
          }
        }
      }

      const q = {
        ...baseQuery,
        services: timestampServices,
        queries: {
          result: ['failingService:process', {
            onError: ['errorHandler:handle'],
            ignoreErrors: true,
            cache: true
          }]
        },
        select: 'result'
      }

      // First call
      const result1 = await query(q)

      // Wait to ensure different timestamp
      await new Promise(resolve => setTimeout(resolve, 10))

      // Second call with identical arguments
      const result2 = await query(q)

      // If error handler results were cached, timestamps would be identical
      // Since error handlers shouldn't be cached, timestamps should differ
      assert.notStrictEqual(result1.timestamp, result2.timestamp,
        'Error handler results should not be cached - timestamps should differ')
    })
  })

  describe('Source tracking verification of cache behavior', () => {
    it('should return correct source type and not mix error handler with service results', async () => {
      const sourceTrackingServices = {
        conditionalService: {
          async getData({shouldFail, id}) {
            if (shouldFail) {
              throw new Error('Intentional failure')
            }
            return {success: true, id, source: 'service'}
          }
        },
        errorService: {
          async handleError() {
            return {success: false, source: 'error-handler'}
          }
        }
      }

      const testQuery = {
        ...baseQuery,
        services: sourceTrackingServices,
        queries: {
          result: ['conditionalService:getData', {
            shouldFail: '$.given.shouldFail',
            id: '$.given.id',
            onError: ['errorService:handleError'],
            ignoreErrors: true,
            cache: true
          }]
        },
        select: 'result'
      }

      // Call 1: Fail case - should get error handler result
      const failResult = await query({
        ...testQuery,
        given: {shouldFail: true, id: 'test1'}
      })

      // Call 2: Success case with same id but different shouldFail - should get service result
      const successResult = await query({
        ...testQuery,
        given: {shouldFail: false, id: 'test1'}
      })

      // Verify we get the correct source for each scenario
      assert.strictEqual(failResult.source, 'error-handler', 'Failed call should return error handler result')
      assert.strictEqual(successResult.source, 'service', 'Successful call should return service result, not cached error result')
    })
  })

  describe('Error handler output should never substitute for correct service execution', () => {
    it('should not return error handler output when service would succeed', async () => {
      const q = {
        ...baseQuery,
        given: {shouldFail: true},
        services: conditionalServices,
        queries: {
          result: ['conditional:process', {
            shouldFail: '$.given.shouldFail',
            onError: ['errorHandler:handleError'],
            ignoreErrors: true,
            cache: true
          }]
        },
        select: 'result'
      }

      // First call fails and uses error handler
      const failResult = await query(q)

      // Second call should succeed with different args and not use cached error handler result
      q.given.shouldFail = false
      const successResult = await query(q)

      assert.strictEqual(conditionalServices.serviceCallCount, 2)
      assert.strictEqual(conditionalServices.errorHandlerCallCount, 1)

      assert.strictEqual(failResult.errorResult, true)
      assert.strictEqual(successResult.serviceResult, true)
      assert.notDeepStrictEqual(failResult, successResult)
    })

    it('should not allow error handler results to pollute cache for successful service calls', async () => {
      let serviceCallCount = 0
      const services = {
        test: {
          async getData({value}) {
            serviceCallCount++
            if (value === 'fail') {
              throw new Error('Intentional failure')
            }
            return {data: value, call: serviceCallCount}
          }
        },
        errorHandler: {
          async handle() {return {error: 'handled'}}
        }
      }

      const q = {
        ...baseQuery,
        given: {input: 'fail'},
        services,
        queries: {
          result: ['test:getData', {
            value: '$.given.input',
            onError: ['errorHandler:handle'],
            ignoreErrors: true,
            cache: true
          }]
        },
        select: 'result'
      }

      // Call with failing input first
      const errorResult = await query(q)

      // Call with successful input - should not get error handler result from cache
      q.given.input = 'success'
      const successResult = await query(q)

      // Call successful input again - should get cached successful result
      const cachedResult = await query(q)

      assert.strictEqual(serviceCallCount, 2) // fail + success + not called for cache hit

      assert.strictEqual(errorResult.error, 'handled')
      assert.strictEqual(successResult.data, 'success')
      assert.strictEqual(successResult.call, 2)
      assert.deepStrictEqual(successResult, cachedResult)
    })
  })
})
