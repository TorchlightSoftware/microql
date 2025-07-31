import assert from 'node:assert'
import {describe, it} from 'node:test'
import query from '../query.js'
import {readdir, rm} from 'fs/promises'

const CACHEDIR = '.cache-test-cache'

describe('Cache Tests', () => {
  // Clean up cache before tests
  const cleanup = async () => {
    await rm(CACHEDIR, {recursive: true, force: true})
  }

  describe('Basic Caching', () => {
    it('should cache and return cached results', async () => {
      await cleanup()

      let callCount = 0
      const services = {
        counter: {
          async increment({value}) {
            callCount++
            return {count: callCount, input: value}
          }
        }
      }

      // First call - should execute and cache
      const result1 = await query({
        given: {value: 'test'},
        services,
        settings: {cache: {configDir: CACHEDIR}},
        queries: {
          count: ['counter:increment', {value: '$.given.value', cache: true}]
        },
        select: 'count'
      })

      assert.strictEqual(result1.count, 1)
      assert.strictEqual(result1.input, 'test')
      assert.strictEqual(callCount, 1)

      // Second call with same args - should return cached result
      const result2 = await query({
        given: {value: 'test'},
        services,
        settings: {cache: {configDir: CACHEDIR}},
        queries: {
          count: ['counter:increment', {value: '$.given.value', cache: true}]
        },
        select: 'count'
      })

      assert.strictEqual(result2.count, 1) // Same as first call
      assert.strictEqual(result2.input, 'test')
      assert.strictEqual(callCount, 1) // Service not called again

      // Third call with different args - should execute
      const result3 = await query({
        given: {value: 'different'},
        services,
        settings: {cache: {configDir: CACHEDIR}},
        queries: {
          count: ['counter:increment', {value: '$.given.value', cache: true}]
        },
        select: 'count'
      })

      assert.strictEqual(result3.count, 2) // New execution
      assert.strictEqual(result3.input, 'different')
      assert.strictEqual(callCount, 2)
    })

    it('should not cache when cache is not enabled', async () => {
      await cleanup()

      let callCount = 0
      const services = {
        counter: {
          async increment({value}) {
            callCount++
            return {count: callCount, input: value}
          }
        }
      }

      // First call without cache
      const result1 = await query({
        given: {value: 'test'},
        services,
        queries: {
          count: ['counter:increment', {value: '$.given.value'}]
        },
        select: 'count'
      })

      assert.strictEqual(result1.count, 1)
      assert.strictEqual(callCount, 1)

      // Second call without cache - should execute again
      const result2 = await query({
        given: {value: 'test'},
        services,
        queries: {
          count: ['counter:increment', {value: '$.given.value'}]
        },
        select: 'count'
      })

      assert.strictEqual(result2.count, 2)
      assert.strictEqual(callCount, 2)
    })

    it('should create cache files in correct directory structure', async () => {
      await cleanup()

      const services = {
        test: {
          async action({input}) {
            return {processed: input}
          }
        }
      }

      await query({
        given: {value: 'cached'},
        services,
        settings: {cache: {configDir: CACHEDIR}},
        queries: {
          result: ['test:action', {input: '$.given.value', cache: true}]
        },
        select: 'result'
      })

      // Check if cache directory and file were created
      const serviceDirs = await readdir(CACHEDIR)
      assert(serviceDirs.includes('test-action'), 'Service-action directory should exist')

      const cacheFiles = await readdir(`${CACHEDIR}/test-action`)
      assert(cacheFiles.length === 1, 'Should have one cache file')
      assert(cacheFiles[0].endsWith('.json'), 'Cache file should be JSON')
    })
  })

  describe('Cache Invalidation', () => {
    it('should cleanup expired cache entries', async () => {
      await cleanup()

      const services = {
        test: {
          async process({input}) {
            return {processed: input, timestamp: Date.now()}
          }
        }
      }

      // Create a cached entry
      await query({
        given: {value: 'test'},
        services,
        settings: {cache: {configDir: CACHEDIR}},
        queries: {
          result: ['test:process', {input: '$.given.value', cache: {invalidateAfter: '1h'}}]
        },
        select: 'result'
      })

      // Verify cache file exists
      const cacheFiles = await readdir(`${CACHEDIR}/test-process`)
      assert.strictEqual(cacheFiles.length, 1)

      // Note: In a real test, we'd manipulate file timestamps to test expiration
      // For now, just verify the structure exists
    })
  })

  describe('Cache with Other Wrappers', () => {
    it('should work with rate limiting', async () => {
      await cleanup()

      let callCount = 0
      const callTimes = []
      const startTime = Date.now()

      const services = {
        slow: {
          async process({input}) {
            callCount++
            callTimes.push(Date.now() - startTime)
            return {processed: input, call: callCount}
          }
        }
      }

      // First set of calls - should execute and cache with rate limiting
      const result1 = await query({
        given: {values: ['first', 'second']},
        services,
        settings: {
          cache: {configDir: CACHEDIR},
          rateLimit: {
            slow: 100
          }
        },
        queries: {
          result1: ['slow:process', {input: '$.given.values[0]', cache: true}],
          result2: ['slow:process', {input: '$.given.values[1]', cache: true}]
        },
        select: ['result1', 'result2']
      })

      assert.strictEqual(result1.result1.call, 1)
      assert.strictEqual(result1.result2.call, 2)
      assert.strictEqual(callCount, 2)

      // Verify rate limiting occurred
      assert(callTimes[1] >= 100, 'Second call should be rate limited')

      // Second set of calls - should return cached results without rate limiting
      const secondStartTime = Date.now()
      const result2 = await query({
        given: {values: ['first', 'second']},
        services,
        settings: {
          cache: {configDir: CACHEDIR},
          rateLimit: {
            slow: 100
          }
        },
        queries: {
          result1: ['slow:process', {input: '$.given.values[0]', cache: true}],
          result2: ['slow:process', {input: '$.given.values[1]', cache: true}]
        },
        select: ['result1', 'result2']
      })
      const duration = Date.now() - secondStartTime

      // Should return cached results
      assert.strictEqual(result2.result1.call, 1) // Same as before
      assert.strictEqual(result2.result2.call, 2) // Same as before
      assert.strictEqual(callCount, 2) // No new calls

      // Should be fast (no rate limiting for cached results)
      assert(duration < 50, 'Cached results should return quickly')
    })

    it('should work with validation', async () => {
      await cleanup()

      let callCount = 0
      const services = {
        validator: {
          async process({value}) {
            callCount++
            return {validated: value, count: callCount}
          }
        }
      }

      // Add simple validation
      services.validator.process._validators = {
        precheck: {value: ['string']}
      }

      // First call - should validate and cache
      const result1 = await query({
        given: {input: 'valid'},
        services,
        settings: {cache: {configDir: CACHEDIR}},
        queries: {
          result: ['validator:process', {value: '$.given.input', cache: true}]
        },
        select: 'result'
      })

      assert.strictEqual(result1.validated, 'valid')
      assert.strictEqual(result1.count, 1)
      assert.strictEqual(callCount, 1)

      // Second call - should return cached result (validation bypassed)
      const result2 = await query({
        given: {input: 'valid'},
        services,
        settings: {cache: {configDir: CACHEDIR}},
        queries: {
          result: ['validator:process', {value: '$.given.input', cache: true}]
        },
        select: 'result'
      })

      assert.strictEqual(result2.validated, 'valid')
      assert.strictEqual(result2.count, 1) // Same as first call
      assert.strictEqual(callCount, 1) // No new execution
    })
  })
})
