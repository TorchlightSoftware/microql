import assert from 'assert'
import query from '../index.js'

describe('Error Handling Tests', () => {
  // Test services
  const errorService = {
    fail: async () => {
      throw new Error('Service failed')
    },
    succeed: async () => {
      return { success: true }
    }
  }
  
  const logService = {
    logError: async ({ on }) => {
      const errorContext = on
      return {
        logged: true,
        error: errorContext.error,
        service: `${errorContext.serviceName}.${errorContext.action}`
      }
    },
    logQueryError: async ({ on }) => {
      const errorContext = on
      return {
        queryLogged: true,
        error: errorContext.error,
        taskName: errorContext.taskName
      }
    }
  }

  describe('Service-Level Error Handling', () => {
    it('should call onError handler when service fails', async () => {
      const config = {
        services: { error: errorService, log: logService },
        query: {
          result: ['error', 'fail', {
            onError: ['log', 'logError', { on: '@' }]
          }]
        }
      }
      
      await assert.rejects(
        () => query(config),
        /Service failed/
      )
    })
    
    it('should ignore errors when ignoreErrors is true', async () => {
      const config = {
        services: { error: errorService },
        query: {
          failedTask: ['error', 'fail', { ignoreErrors: true }],
          successTask: ['error', 'succeed', {}]
        },
        select: ['failedTask', 'successTask']
      }
      
      const result = await query(config)
      assert.strictEqual(result.failedTask, null)
      assert.deepStrictEqual(result.successTask, { success: true })
    })
    
    it('should work with both onError and ignoreErrors', async () => {
      let errorLogged = false
      
      const customLog = {
        track: async ({ on }) => {
          errorLogged = true
          return { tracked: true }
        }
      }
      
      const config = {
        services: { error: errorService, customLog },
        query: {
          result: ['error', 'fail', {
            onError: ['customLog', 'track', { on: '@' }],
            ignoreErrors: true
          }]
        }
      }
      
      const result = await query(config)
      assert.strictEqual(result.result, null)
      assert.strictEqual(errorLogged, true)
    })
  })
  
  describe('Query-Level Error Handling', () => {
    it('should call query-level onError for unhandled errors', async () => {
      const config = {
        services: { error: errorService, log: logService },
        query: {
          willFail: ['error', 'fail', {}]
        },
        onError: ['log', 'logQueryError', { on: '@' }]
      }
      
      await assert.rejects(
        () => query(config),
        /Service failed/
      )
    })
    
    it('should handle errors in nested service chains', async () => {
      const chainService = {
        step1: async () => ({ value: 1 }),
        step2: async () => {
          throw new Error('Chain step failed')
        }
      }
      
      const config = {
        services: { chain: chainService },
        query: {
          chained: [
            ['chain', 'step1', {}],
            ['chain', 'step2', { ignoreErrors: true }]
          ]
        }
      }
      
      const result = await query(config)
      assert.strictEqual(result.chained, null)
    })
  })
  
  describe('Error Context', () => {
    it('should provide complete error context to handlers', async () => {
      let capturedContext = null
      
      const captureService = {
        capture: async ({ on }) => {
          capturedContext = on
          return { captured: true }
        }
      }
      
      const config = {
        services: { error: errorService, capture: captureService },
        query: {
          testTask: ['error', 'fail', {
            someArg: 'value',
            onError: ['capture', 'capture', { on: '@' }],
            ignoreErrors: true
          }]
        }
      }
      
      await query(config)
      
      assert.ok(capturedContext)
      assert.strictEqual(capturedContext.error, 'Service failed')
      assert.strictEqual(capturedContext.serviceName, 'error')
      assert.strictEqual(capturedContext.action, 'fail')
      assert.deepStrictEqual(capturedContext.args, { someArg: 'value', timeout: 5000 })
      assert.strictEqual(capturedContext.taskName, 'testTask')
    })
  })
})