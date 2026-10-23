import assert from 'node:assert'
import {describe, it} from 'node:test'
import query, {defineService} from '../index.js'

describe('Timeout Tests', () => {
  // Test service with configurable delays
  const createDelayService = (delay, name) => defineService({
    async '/delay'(_args) {
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
        phases: {
          result: ['[fast]/delay', {input: '$given.value'}]
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
          phases: {
            result: ['[slow]/delay', {input: '$given.value'}]
          }
        }),
        {code: 'timeout', timeout: 100, address: '$result.@1', key: '[slow]/delay'}
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
        phases: {
          result: ['[fast]/delay', {input: '$given.value'}]
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
        phases: {
          result: ['[slow]/delay', {input: '$given.value', timeout: 200}]
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
          phases: {
            result: ['[slow]/delay', {input: '$given.value', timeout: 100}]
          }
        }),
        {code: 'timeout', timeout: 100, address: '$result.@1', key: '[slow]/delay'}
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
        phases: {
          fastResult: ['[fast]/delay', {input: '$given.value'}],
          mediumResult: ['[medium]/delay', {input: '$given.value'}],
          slowResult: ['[slow]/delay', {input: '$given.value', timeout: 200}]
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
        phases: {
          chained: [
            ['[step1]/delay', {input: '$given.value'}],
            ['[step2]/delay', {input: '@'}]
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
          phases: {
            chained: [
              ['[step1]/delay', {input: '$given.value'}],
              ['[step2]/delay', {input: '@'}]
            ]
          }
        }),
        {code: 'timeout', timeout: 100, address: '$chained.@2', key: '[step2]/delay'}
      )
    })
  })
})
