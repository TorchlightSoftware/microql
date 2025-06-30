import { describe, it } from 'mocha'
import assert from 'assert'
import query from '../query.js'

describe('Timeout Tests', () => {
  
  // Test service with configurable delays
  const createDelayService = (delay, name) => async (action, args) => {
    if (action === 'delay') {
      await new Promise(resolve => setTimeout(resolve, delay))
      return `${name} completed after ${delay}ms`
    }
    throw new Error(`Unknown action: ${action}`)
  }
  
  describe('Basic Timeout Behavior', () => {
    
    it('should complete normally without timeout', async () => {
      const result = await query({
        given: { value: 'test' },
        services: {
          fast: createDelayService(50, 'fast')
        },
        query: {
          result: ['fast', 'delay', { input: '$.given.value' }]
        }
      })
      
      assert.strictEqual(result.result, 'fast completed after 50ms')
    })
    
    it('should timeout with default timeout', async () => {
      await assert.rejects(
        query({
          given: { value: 'test' },
          services: {
            slow: createDelayService(200, 'slow')
          },
          timeouts: {
            default: 100
          },
          query: {
            result: ['slow', 'delay', { input: '$.given.value' }]
          }
        }),
        /slow\.delay.*timed out after 100ms/
      )
    })
    
    it('should complete within default timeout', async () => {
      const result = await query({
        given: { value: 'test' },
        services: {
          fast: createDelayService(50, 'fast')
        },
        timeouts: {
          default: 100
        },
        query: {
          result: ['fast', 'delay', { input: '$.given.value' }]
        }
      })
      
      assert.strictEqual(result.result, 'fast completed after 50ms')
    })
  })
  
  describe('Timeout Priority', () => {
    
    it('should use service-specific timeout over default', async () => {
      const result = await query({
        given: { value: 'test' },
        services: {
          medium: createDelayService(150, 'medium')
        },
        timeouts: {
          default: 100,
          medium: 200
        },
        query: {
          result: ['medium', 'delay', { input: '$.given.value' }]
        }
      })
      
      assert.strictEqual(result.result, 'medium completed after 150ms')
    })
    
    it('should use argument timeout over service and default', async () => {
      const result = await query({
        given: { value: 'test' },
        services: {
          slow: createDelayService(150, 'slow')
        },
        timeouts: {
          default: 100,
          slow: 120
        },
        query: {
          result: ['slow', 'delay', { 
            input: '$.given.value',
            timeout: 200
          }]
        }
      })
      
      assert.strictEqual(result.result, 'slow completed after 150ms')
    })
    
    it('should timeout with low argument timeout despite high defaults', async () => {
      await assert.rejects(
        query({
          given: { value: 'test' },
          services: {
            slow: createDelayService(150, 'slow')
          },
          timeouts: {
            default: 1000
          },
          query: {
            result: ['slow', 'delay', { 
              input: '$.given.value',
              timeout: 100
            }]
          }
        }),
        /slow\.delay.*timed out after 100ms/
      )
    })
  })
  
  describe('Advanced Scenarios', () => {
    
    it('should handle multiple services with different timeouts', async () => {
      const result = await query({
        given: { value: 'test' },
        services: {
          fast: createDelayService(30, 'fast'),
          medium: createDelayService(80, 'medium'),
          slow: createDelayService(150, 'slow')
        },
        timeouts: {
          default: 100,
          slow: 200
        },
        query: {
          fastResult: ['fast', 'delay', { input: '$.given.value' }],
          mediumResult: ['medium', 'delay', { input: '$.given.value' }],
          slowResult: ['slow', 'delay', { input: '$.given.value' }]
        }
      })
      
      assert.strictEqual(result.fastResult, 'fast completed after 30ms')
      assert.strictEqual(result.mediumResult, 'medium completed after 80ms')
      assert.strictEqual(result.slowResult, 'slow completed after 150ms')
    })
    
    it('should handle service chains with timeouts', async () => {
      const result = await query({
        given: { value: 'test' },
        services: {
          step1: createDelayService(50, 'step1'),
          step2: createDelayService(60, 'step2')
        },
        timeouts: {
          default: 200
        },
        query: {
          chained: [
            ['step1', 'delay', { input: '$.given.value' }],
            ['step2', 'delay', { input: '@' }]
          ]
        }
      })
      
      assert.strictEqual(result.chained, 'step2 completed after 60ms')
    })
    
    it('should timeout individual steps in service chains', async () => {
      await assert.rejects(
        query({
          given: { value: 'test' },
          services: {
            step1: createDelayService(50, 'step1'),
            step2: createDelayService(150, 'step2')
          },
          timeouts: {
            default: 100
          },
          query: {
            chained: [
              ['step1', 'delay', { input: '$.given.value' }],
              ['step2', 'delay', { input: '@' }]
            ]
          }
        }),
        /step2\.delay.*timed out after 100ms/
      )
    })
    
    it('should pass timeout value to service', async () => {
      let receivedTimeout = null
      
      await query({
        given: { value: 'test' },
        services: {
          test: async (action, args) => {
            receivedTimeout = args.timeout
            return 'completed'
          }
        },
        timeouts: {
          default: 200,
          test: 300
        },
        query: {
          withServiceTimeout: ['test', 'action', { data: 'x' }],
          withArgTimeout: ['test', 'action', { data: 'y', timeout: 400 }]
        }
      })
      
      // Last call should have received timeout: 400
      assert.strictEqual(receivedTimeout, 400)
    })
    
    it('should use service-specific timeout from settings', async () => {
      const result = await query({
        given: { value: 'test' },
        services: {
          slow: createDelayService(150, 'slow')
        },
        settings: {
          timeout: {
            default: 100,
            slow: 200
          }
        },
        query: {
          result: ['slow', 'delay', { input: '$.given.value' }]
        }
      })
      
      assert.strictEqual(result.result, 'slow completed after 150ms')
    })
    
    it('should prioritize legacy timeouts over settings timeouts', async () => {
      const result = await query({
        given: { value: 'test' },
        services: {
          slow: createDelayService(150, 'slow')
        },
        timeouts: {
          slow: 200  // Legacy config should take priority
        },
        settings: {
          timeout: {
            slow: 100  // This should be ignored
          }
        },
        query: {
          result: ['slow', 'delay', { input: '$.given.value' }]
        }
      })
      
      assert.strictEqual(result.result, 'slow completed after 150ms')
    })
  })
})