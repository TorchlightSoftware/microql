import assert from 'node:assert'
import {describe, it} from 'node:test'
import query from '../index.js'

describe('Error Handling Tests', () => {
  // Test services
  const errorService = {
    fail: async () => {
      throw new Error('Service failed')
    },
    succeed: async () => {
      return {success: true}
    }
  }

  const logService = {
    logError: async ({on}) => {
      const errorContext = on
      //console.log('logError received context:', errorContext)
      return {
        logged: true,
        error: errorContext.message,
        service: `${errorContext.serviceName}.${errorContext.action}`
      }
    },
    logQueryError: async ({on}) => {
      const errorContext = on
      return {
        queryLogged: true,
        error: errorContext.message,
        queryName: errorContext.queryName
      }
    }
  }

  describe('Service-Level Error Handling', () => {
    it('should call onError handler when service fails', async () => {
      const config = {
        services: {error: errorService, log: logService},
        settings: {debug: true},
        queries: {
          result: ['error', 'fail', {onError: ['log', 'logError', {on: '@'}]}]
        }
      }

      await assert.rejects(
        query(config),
        (error) => {
          // Verify the error has all expected properties
          assert.strictEqual(error.message, '[result - error:fail] Service failed')
          assert.strictEqual(error.serviceName, 'error')
          assert.strictEqual(error.action, 'fail')
          return true
        }
      )
    })

    it('should ignore errors when ignoreErrors is true', async () => {
      const config = {
        services: {error: errorService},
        queries: {
          failedQuery: ['error', 'fail', {ignoreErrors: true}],
          successQuery: ['error', 'succeed', {}]
        },
        select: ['failedQuery', 'successQuery']
      }

      const result = await query(config)
      assert.strictEqual(result.failedQuery, null)
      assert.deepStrictEqual(result.successQuery, {success: true})
    })

    it('should work with both onError and ignoreErrors', async () => {
      let errorLogged = false

      const customLog = {
        track: async ({_on}) => {
          errorLogged = true
          return {tracked: true}
        }
      }

      const config = {
        services: {error: errorService, customLog},
        queries: {
          result: ['error', 'fail', {
            onError: ['customLog', 'track', {on: '@'}],
            ignoreErrors: true
          }]
        }
      }

      const result = await query(config)
      assert.deepStrictEqual(result.result, {tracked: true})
      assert.strictEqual(errorLogged, true)
    })
  })

  describe('Query-Level Error Handling', () => {
    it('should call query-level onError for unhandled errors', async () => {
      const config = {
        services: {error: errorService, log: logService},
        queries: {
          willFail: ['error', 'fail', {}]
        },
        onError: ['log', 'logQueryError', {on: '@'}]
      }

      await assert.rejects(() => query(config), /Service failed/)
    })

    it('should handle errors in nested service chains', async () => {
      const chainService = {
        step1: async () => ({value: 1}),
        step2: async () => {
          throw new Error('Chain step failed')
        }
      }

      const config = {
        services: {chain: chainService},
        queries: {
          chained: [
            ['chain', 'step1', {}],
            ['chain', 'step2', {ignoreErrors: true}]
          ]
        }
      }

      const result = await query(config)
      assert.strictEqual(result.chained, null)
    })

    it('should call onError chain when service fails', async () => {
      const logService = {
        addContext: async ({on, severity}) => {
          // `on` should be the error object
          on.severity = severity
          on.timestamp = new Date().toISOString()
          return on
        },
        logError: async ({on}) => {
          // `on` should be the enriched error from addContext
          return {status: 'error', logged: true, severity: on.severity}
        }
      }

      const config = {
        services: {error: errorService, log: logService},
        settings: {debug: false},
        queries: {
          result: ['error', 'fail', {
            onError: [
              // when processing an error in a chain, you actually need to use @@ to refer to the original error
              // ...because @ refers to the current chain context, and will be null within the first operation on the chain
              ['@@', 'log:addContext', {severity: 'bad'}],
              ['@', 'log:logError']
            ]
          }]
        }
      }

      await assert.rejects(
        query(config),
        (error) => {
          // Verify the error has all expected properties
          assert.strictEqual(error.severity, 'bad')
          assert.strictEqual(error.message, '[result - error:fail] Service failed')
          assert.strictEqual(error.serviceName, 'error')
          assert.strictEqual(error.action, 'fail')
          assert.ok(error.timestamp)
          return true
        }
      )

    })
  })

  describe('Error Context', () => {
    it('should provide complete error context to handlers', async () => {
      let capturedContext = null

      const captureService = {
        capture: async ({on}) => {
          capturedContext = on
          return {captured: true}
        }
      }

      const config = {
        services: {error: errorService, capture: captureService},
        settings: {debug: false},
        queries: {
          testQuery: ['error', 'fail', {
            someArg: 'value',
            onError: ['capture', 'capture', {on: '@'}],
            ignoreErrors: true
          }]
        }
      }

      await query(config)

      assert.ok(capturedContext)
      assert.strictEqual(capturedContext.message, '[testQuery - error:fail] Service failed')
      assert.strictEqual(capturedContext.queryName, 'testQuery')
      assert.strictEqual(capturedContext.serviceName, 'error')
      assert.strictEqual(capturedContext.action, 'fail')
      assert.strictEqual(capturedContext.args.someArg, 'value')
    })
  })
})
