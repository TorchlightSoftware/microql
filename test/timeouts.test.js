import assert from 'node:assert'
import {describe, it} from 'node:test'
import query from '../query.js'

describe('Timeout Tests', () => {
  // Test service with configurable delays
  const createDelayService = (delay, name) => ({
    async delay(_args) {
      await new Promise((resolve) => setTimeout(resolve, delay))
      return `${name} completed after ${delay}ms`
    }
  })

  describe('Basic Timeout Behavior', () => {
    it('should complete normally without timeout', async () => {
      const result = await query({
        given: {value: 'test'},
        services: {
          fast: createDelayService(50, 'fast')
        },
        queries: {
          result: ['fast', 'delay', {input: '$.given.value'}]
        }
      })

      assert.strictEqual(result.result, 'fast completed after 50ms')
    })

    it('should timeout with default timeout', async () => {
      await assert.rejects(
        query({
          given: {value: 'test'},
          services: {
            slow: createDelayService(200, 'slow')
          },
          settings: {
            timeout: 100
          },
          queries: {
            result: ['slow', 'delay', {input: '$.given.value'}]
          }
        }),
        /result - slow:delay.*Timed out after 100ms/
      )
    })

    it('should complete within default timeout', async () => {
      const result = await query({
        given: {value: 'test'},
        services: {
          fast: createDelayService(50, 'fast')
        },
        settings: {
          timeout: 100
        },
        queries: {
          result: ['fast', 'delay', {input: '$.given.value'}]
        }
      })

      assert.strictEqual(result.result, 'fast completed after 50ms')
    })
  })

  describe('Timeout Priority', () => {
    it('should use argument timeout over service and default', async () => {
      const result = await query({
        given: {value: 'test'},
        services: {
          slow: createDelayService(150, 'slow')
        },
        settings: {
          timeout: 100
        },
        queries: {
          result: ['slow', 'delay', {input: '$.given.value', timeout: 200}]
        }
      })

      assert.strictEqual(result.result, 'slow completed after 150ms')
    })

    it('should timeout with low argument timeout despite high defaults', async () => {
      await assert.rejects(
        query({
          given: {value: 'test'},
          services: {
            slow: createDelayService(150, 'slow')
          },
          settings: {
            timeout: 1000
          },
          queries: {
            result: ['slow', 'delay', {input: '$.given.value', timeout: 100}]
          }
        }),
        /result - slow:delay.*Timed out after 100ms/
      )
    })
  })

  describe('Advanced Scenarios', () => {
    it('should handle multiple services with different timeouts', async () => {
      const result = await query({
        given: {value: 'test'},
        services: {
          fast: createDelayService(30, 'fast'),
          medium: createDelayService(80, 'medium'),
          slow: createDelayService(150, 'slow')
        },
        settings: {
          timeout: 100
        },
        queries: {
          fastResult: ['fast', 'delay', {input: '$.given.value'}],
          mediumResult: ['medium', 'delay', {input: '$.given.value'}],
          slowResult: ['slow', 'delay', {input: '$.given.value', timeout: 200}]
        }
      })

      assert.strictEqual(result.fastResult, 'fast completed after 30ms')
      assert.strictEqual(result.mediumResult, 'medium completed after 80ms')
      assert.strictEqual(result.slowResult, 'slow completed after 150ms')
    })

    it('should handle service chains with timeouts', async () => {
      const result = await query({
        given: {value: 'test'},
        services: {
          step1: createDelayService(50, 'step1'),
          step2: createDelayService(60, 'step2')
        },
        settings: {
          timeout: 200
        },
        queries: {
          chained: [
            ['step1', 'delay', {input: '$.given.value'}],
            ['step2', 'delay', {input: '@'}]
          ]
        }
      })

      assert.strictEqual(result.chained, 'step2 completed after 60ms')
    })

    it('should timeout individual steps in service chains', async () => {
      await assert.rejects(
        query({
          given: {value: 'test'},
          services: {
            step1: createDelayService(50, 'step1'),
            step2: createDelayService(150, 'step2')
          },
          settings: {
            timeout: 100
          },
          queries: {
            chained: [
              ['step1', 'delay', {input: '$.given.value'}],
              ['step2', 'delay', {input: '@'}]
            ]
          }
        }),
        /chained\[1\] - step2:delay.*Timed out after 100ms/
      )
    })
  })
})
