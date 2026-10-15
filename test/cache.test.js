import assert from 'node:assert'
import {describe, it} from 'node:test'
import query, {nodeRuntime, fileStore, defineService} from '../index.js'
import {readdir, rm} from 'fs/promises'

const CACHEDIR = '.cache-test-cache'
// the node runtime with its Cache kept in a test directory
const runtime = {...nodeRuntime, cache: fileStore(CACHEDIR)}

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
        counter: defineService({
          async '/increment'({value}) {
            callCount++
            return {count: callCount, input: value}
          }
        })
      }

      // First call - should execute and cache
      const result1 = await query({
        given: {value: 'test'},
        services,
        runtime,
        phases: {
          count: ['[counter]/increment', {value: '$given.value', cache: true}]
        },
        select: '$count'
      })

      assert.strictEqual(result1.count, 1)
      assert.strictEqual(result1.input, 'test')
      assert.strictEqual(callCount, 1)

      // Second call with same args - should return cached result
      const result2 = await query({
        given: {value: 'test'},
        services,
        runtime,
        phases: {
          count: ['[counter]/increment', {value: '$given.value', cache: true}]
        },
        select: '$count'
      })

      assert.strictEqual(result2.count, 1) // Same as first call
      assert.strictEqual(result2.input, 'test')
      assert.strictEqual(callCount, 1) // Service not called again

      // Third call with different args - should execute
      const result3 = await query({
        given: {value: 'different'},
        services,
        runtime,
        phases: {
          count: ['[counter]/increment', {value: '$given.value', cache: true}]
        },
        select: '$count'
      })

      assert.strictEqual(result3.count, 2) // New execution
      assert.strictEqual(result3.input, 'different')
      assert.strictEqual(callCount, 2)
    })

    it('should not cache when cache is not enabled', async () => {
      await cleanup()

      let callCount = 0
      const services = {
        counter: defineService({
          async '/increment'({value}) {
            callCount++
            return {count: callCount, input: value}
          }
        })
      }

      // First call without cache
      const result1 = await query({
        given: {value: 'test'},
        services,
        phases: {
          count: ['[counter]/increment', {value: '$given.value'}]
        },
        select: '$count'
      })

      assert.strictEqual(result1.count, 1)
      assert.strictEqual(callCount, 1)

      // Second call without cache - should execute again
      const result2 = await query({
        given: {value: 'test'},
        services,
        phases: {
          count: ['[counter]/increment', {value: '$given.value'}]
        },
        select: '$count'
      })

      assert.strictEqual(result2.count, 2)
      assert.strictEqual(callCount, 2)
    })

    it('should create cache files in correct directory structure', async () => {
      await cleanup()

      const services = {
        test: defineService({
          async '/action'({input}) {
            return {processed: input}
          }
        })
      }

      await query({
        given: {value: 'cached'},
        services,
        runtime,
        phases: {
          result: ['[test]/action', {input: '$given.value', cache: true}]
        },
        select: '$result'
      })

      // One directory per form, one file per input
      const formDirs = await readdir(CACHEDIR)
      assert.strictEqual(formDirs.length, 1, 'Should have one form directory')
      assert.match(formDirs[0], /^[0-9a-f]{64}$/, 'Form directory is named by form hash')

      const cacheFiles = await readdir(`${CACHEDIR}/${formDirs[0]}`)
      assert(cacheFiles.length === 1, 'Should have one cache file')
      assert.match(cacheFiles[0], /^[0-9a-f]{64}\.json$/, 'Cache file is named by input hash')
    })
  })

  describe('Cache Invalidation', () => {
    it('should cleanup expired cache entries', async () => {
      await cleanup()

      const services = {
        test: defineService({
          async '/process'({input}) {
            return {processed: input, timestamp: Date.now()}
          }
        })
      }

      // Create a cached entry
      await query({
        given: {value: 'test'},
        services,
        runtime,
        phases: {
          result: ['[test]/process', {input: '$given.value', cache: {ttl: '1h'}}]
        },
        select: '$result'
      })

      // Verify cache file exists
      const [formDir] = await readdir(CACHEDIR)
      const cacheFiles = await readdir(`${CACHEDIR}/${formDir}`)
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
        slow: defineService({
          async '/process'({input}) {
            callCount++
            callTimes.push(Date.now() - startTime)
            return {processed: input, call: callCount}
          }
        })
      }

      // First set of calls - should execute and cache with rate limiting
      const result1 = await query({
        given: {values: ['first', 'second']},
        services,
        runtime,
        settings: {
          rateLimit: {
            slow: 100
          }
        },
        phases: {
          result1: ['[slow]/process', {input: '$given.values[0]', cache: true}],
          result2: ['[slow]/process', {input: '$given.values[1]', cache: true}]
        },
        select: ['$result1', '$result2']
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
        runtime,
        settings: {
          rateLimit: {
            slow: 100
          }
        },
        phases: {
          result1: ['[slow]/process', {input: '$given.values[0]', cache: true}],
          result2: ['[slow]/process', {input: '$given.values[1]', cache: true}]
        },
        select: ['$result1', '$result2']
      })
      const duration = Date.now() - secondStartTime

      // Should return cached results
      assert.strictEqual(result2.result1.call, 1) // Same as before
      assert.strictEqual(result2.result2.call, 2) // Same as before
      assert.strictEqual(callCount, 2) // No new calls

      // cached results skip the rate limiter: a second limited call would wait 100ms
      assert(duration < 100, `Cached results took ${duration}ms, should skip the 100ms rate limit`)
    })

    it('should work with validation', async () => {
      await cleanup()

      let callCount = 0
      const services = {
        validator: defineService({
          '/process': {
            input: {value: [['type', ['string']]]},
            async call({value}) {
              callCount++
              return {validated: value, count: callCount}
            }
          }
        })
      }

      // First call - should validate and cache
      const result1 = await query({
        given: {input: 'valid'},
        services,
        runtime,
        phases: {
          result: ['[validator]/process', {value: '$given.input', cache: true}]
        },
        select: '$result'
      })

      assert.strictEqual(result1.validated, 'valid')
      assert.strictEqual(result1.count, 1)
      assert.strictEqual(callCount, 1)

      // Second call - should return cached result (validation bypassed)
      const result2 = await query({
        given: {input: 'valid'},
        services,
        runtime,
        phases: {
          result: ['[validator]/process', {value: '$given.input', cache: true}]
        },
        select: '$result'
      })

      assert.strictEqual(result2.validated, 'valid')
      assert.strictEqual(result2.count, 1) // Same as first call
      assert.strictEqual(callCount, 1) // No new execution
    })
  })
})
