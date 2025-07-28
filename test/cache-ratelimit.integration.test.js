import assert from 'node:assert'
import {describe, it} from 'node:test'
import query from '../query.js'
import {existsSync} from 'fs'
import {rm} from 'fs/promises'

describe('Cache and Rate Limit Integration Tests', () => {
  const cleanup = async () => {
    if (existsSync('.cache')) {
      await rm('.cache', {recursive: true, force: true})
    }
  }

  it('should cache results and work with rate limiting within single query', async () => {
    await cleanup()

    let callCount = 0
    const callTimes = []
    const startTime = Date.now()

    const services = {
      heavy: {
        async process({input}) {
          callCount++
          callTimes.push(Date.now() - startTime)
          // Simulate heavy processing
          await new Promise(resolve => setTimeout(resolve, 10))
          return {processed: input, call: callCount, timestamp: Date.now()}
        }
      }
    }

    // Single query with multiple calls - some cached, some not
    const result = await query({
      given: {value: 'cached'},
      services,
      settings: {
        rateLimit: {
          heavy: 100 // 100ms between calls
        }
      },
      queries: {
        result1: ['heavy:process', {input: '$.given.value', cache: {}}], // First execution
        result2: ['heavy:process', {input: '$.given.value', cache: {}}], // Cache hit
        result3: ['heavy:process', {input: 'different', cache: {}}], // Second execution (rate limited)
        result4: ['heavy:process', {input: '$.given.value', cache: {}}] // Cache hit
      },
      select: ['result1', 'result2', 'result3', 'result4']
    })

    // Verify results
    assert.strictEqual(result.result1.processed, 'cached')
    assert.strictEqual(result.result1.call, 1)

    assert.strictEqual(result.result2.processed, 'cached')
    assert.strictEqual(result.result2.call, 1) // Same cached result
    assert.strictEqual(result.result2.timestamp, result.result1.timestamp) // Exact same object

    assert.strictEqual(result.result3.processed, 'different')
    assert.strictEqual(result.result3.call, 2) // New execution

    assert.strictEqual(result.result4.processed, 'cached')
    assert.strictEqual(result.result4.call, 1) // Same cached result again

    // Should have had exactly 2 actual service calls
    assert.strictEqual(callCount, 2)
    assert.strictEqual(callTimes.length, 2)

    // Rate limiting should apply between actual executions
    assert(callTimes[0] < 50, 'First call should be immediate')
    assert(callTimes[1] >= 100, `Second call at ${callTimes[1]}ms, should be >= 100ms due to rate limiting`)
  })

  it('should return cached results quickly across separate query executions', async () => {
    await cleanup()

    let callCount = 0
    const services = {
      heavy: {
        async process({input}) {
          callCount++
          await new Promise(resolve => setTimeout(resolve, 50)) // Slow operation
          return {processed: input, call: callCount}
        }
      }
    }

    // First query - create cache entry
    const start1 = Date.now()
    const result1 = await query({
      given: {value: 'test'},
      services,
      queries: {
        result: ['heavy:process', {input: '$.given.value', cache: {}}]
      },
      select: 'result'
    })
    const duration1 = Date.now() - start1

    assert.strictEqual(result1.call, 1)
    assert.strictEqual(callCount, 1)
    assert(duration1 >= 50, 'First call should take time due to service execution')

    // Second query - should use cache
    const start2 = Date.now()
    const result2 = await query({
      given: {value: 'test'},
      services,
      queries: {
        result: ['heavy:process', {input: '$.given.value', cache: {}}]
      },
      select: 'result'
    })
    const duration2 = Date.now() - start2

    assert.strictEqual(result2.call, 1) // Same cached result
    assert.strictEqual(callCount, 1) // No new service call
    assert(duration2 < 20, `Second call took ${duration2}ms, should be fast due to cache`)
  })

  it('should handle cache invalidation with rate limiting', async () => {
    await cleanup()

    let callCount = 0
    const services = {
      timed: {
        async process({input}) {
          callCount++
          return {processed: input, call: callCount, created: new Date().toISOString()}
        }
      }
    }

    // Create cached result with short invalidation time
    const result1 = await query({
      given: {value: 'expiring'},
      services,
      settings: {
        rateLimit: {
          timed: 100
        }
      },
      queries: {
        result: ['timed:process', {input: '$.given.value', cache: {invalidateAfter: '1h'}}]
      },
      select: 'result'
    })

    assert.strictEqual(result1.call, 1)
    assert.strictEqual(callCount, 1)

    // Subsequent call should return cached result
    const result2 = await query({
      given: {value: 'expiring'},
      services,
      settings: {
        rateLimit: {
          timed: 100
        }
      },
      queries: {
        result: ['timed:process', {input: '$.given.value', cache: {invalidateAfter: '1h'}}]
      },
      select: 'result'
    })

    assert.strictEqual(result2.call, 1) // Same cached result
    assert.strictEqual(callCount, 1) // No new execution
  })
})