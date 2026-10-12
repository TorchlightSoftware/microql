import assert from 'node:assert'
import {describe, it} from 'node:test'
import {z} from 'zod'
import query, {serviceFromTable} from '../index.js'

describe('Error Handling Tests', () => {
  // Test services
  const errorService = serviceFromTable({
    '/fail': async () => {
      throw new Error('Service failed')
    },
    '/succeed': async () => {
      return {success: true}
    }
  })

  const logService = serviceFromTable({
    '/logError': async ({on}) => {
      const errorContext = on
      //console.log('logError received context:', errorContext)
      return {
        logged: true,
        error: errorContext.message,
        key: errorContext.key
      }
    },
    '/logQueryError': async ({on}) => {
      const errorContext = on
      return {
        queryLogged: true,
        error: errorContext.message,
        address: errorContext.address
      }
    }
  })

  describe('Service-Level Error Handling', () => {
    it('should call onError handler when service fails', async () => {
      const config = {
        services: {error: errorService, log: logService},
        settings: {debug: false},
        phases: {
          result: ['[error]/fail', {onError: ['[log]/logError', {on: '@'}]}]
        }
      }

      await assert.rejects(
        query(config),
        (error) => {
          // Verify the error has all expected properties
          assert.match(error.message, /\[\$result\.@1 - \[error\]\/fail\] Service failed/)
          assert.strictEqual(error.address, '$result.@1')
          assert.strictEqual(error.key, '[error]/fail')
          return true
        }
      )
    })

    it('should ignore errors when ignoreErrors is true', async () => {
      const config = {
        services: {error: errorService},
        phases: {
          failedQuery: ['[error]/fail', {ignoreErrors: true}],
          successQuery: ['[error]/succeed', {}]
        },
        select: ['$failedQuery', '$successQuery']
      }

      const result = await query(config)
      assert.strictEqual(result.failedQuery, null)
      assert.deepStrictEqual(result.successQuery, {success: true})
    })

    it('should work with both onError and ignoreErrors', async () => {
      let errorLogged = false

      const customLog = serviceFromTable({
        '/track': async ({_on}) => {
          errorLogged = true
          return {tracked: true}
        }
      })

      const config = {
        services: {error: errorService, customLog},
        phases: {
          result: ['[error]/fail', {
            onError: ['[customLog]/track', {on: '@'}],
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
        phases: {
          willFail: ['[error]/fail', {}]
        },
        onError: ['[log]/logQueryError', {on: '@'}]
      }

      await assert.rejects(() => query(config), /Service failed/)
    })

    it('should handle errors in nested service chains', async () => {
      const chainService = serviceFromTable({
        '/step1': async () => ({value: 1}),
        '/step2': async () => {
          throw new Error('Chain step failed')
        }
      })

      const config = {
        services: {chain: chainService},
        phases: {
          chained: [
            ['[chain]/step1', {}],
            ['[chain]/step2', {ignoreErrors: true}]
          ]
        }
      }

      const result = await query(config)
      assert.strictEqual(result.chained, null)
    })

    it('should call onError chain when service fails', async () => {
      // on is the target of both, for method syntax
      const logService = serviceFromTable({
        '/addContext': {
          input: {on: ['target']},
          call: async ({on, severity}) => {
            // `on` should be the error object
            on.severity = severity
            on.timestamp = new Date().toISOString()
            return on
          }
        },
        '/logError': {
          input: {on: ['target']},
          call: async ({on}) => {
            // `on` should be the enriched error from addContext
            return {status: 'error', logged: true, severity: on.severity}
          }
        }
      })

      const config = {
        services: {error: errorService, log: logService},
        settings: {debug: false},
        phases: {
          result: ['[error]/fail', {
            onError: [
              // a chain's first step receives nothing; the error is @err
              ['@err', '[log]/addContext', {severity: 'bad'}],
              ['@', '[log]/logError']
            ]
          }]
        }
      }

      await assert.rejects(
        query(config),
        (error) => {
          // Verify the error has all expected properties
          assert.strictEqual(error.severity, 'bad')
          assert.match(error.message, /\[\$result\.@1 - \[error\]\/fail\] Service failed/)
          assert.strictEqual(error.address, '$result.@1')
          assert.strictEqual(error.key, '[error]/fail')
          assert.ok(error.timestamp)
          return true
        }
      )

    })
  })

  describe('Global Error Handling', () => {
    it('should ignore errors globally when ignoreErrors is true', async () => {
      const config = {
        services: {error: errorService},
        settings: {ignoreErrors: true},
        phases: {
          failedQuery: ['[error]/fail', {}]
        }
      }

      const result = await query(config)
      assert.strictEqual(result.failedQuery, undefined)
    })

    it('should call global onError handler', async () => {
      let errorLogged = false

      const logService = serviceFromTable({
        '/logError': async ({on}) => {
          errorLogged = true
          return {globallyLogged: true, error: on.message}
        }
      })

      const config = {
        services: {error: errorService, log: logService},
        settings: {onError: ['[log]/logError', {on: '@'}]},
        phases: {
          failedQuery: ['[error]/fail', {}]
        }
      }

      await assert.rejects(query(config), /Service failed/)
      assert.strictEqual(errorLogged, true)
    })

    it('should call global onError and ignore errors when both are set', async () => {
      let errorLogged = false

      const logService = serviceFromTable({
        '/logError': async ({on}) => {
          errorLogged = true
          return {globallyLogged: true, error: on.message}
        }
      })

      const config = {
        services: {error: errorService, log: logService},
        settings: {
          ignoreErrors: true,
          onError: ['[log]/logError', {on: '@'}]
        },
        phases: {
          failedQuery: ['[error]/fail', {}]
        }
      }

      const result = await query(config)
      assert.strictEqual(result.failedQuery, undefined)
      assert.strictEqual(errorLogged, true)
    })
  })

  describe('Nested error handlers', () => {
    it('reaches the outer error as @@err from inside an inner handler', async () => {
      const seen = []
      const services = {
        error: errorService,
        log: serviceFromTable({
          async '/record'({inner, outer}) {
            seen.push({inner, outer})
            return 'recorded'
          },
          async '/flaky'() {
            throw new Error('handler failed too')
          }
        })
      }

      const result = await query({
        services,
        phases: {
          result: ['[error]/fail', {
            onError: ['[log]/flaky', {
              onError: ['[log]/record', {inner: '@err.message', outer: '@@err.address'}],
              ignoreErrors: true
            }],
            ignoreErrors: true
          }]
        },
        select: '$result'
      })

      assert.strictEqual(result, 'recorded')
      assert.deepStrictEqual(seen, [{inner: '[$result.@1a1 - [log]/flaky] handler failed too', outer: '$result.@1'}])
    })
  })

  describe('Error Context', () => {
    it('should provide complete error context to handlers', async () => {
      let capturedContext = null

      const captureService = serviceFromTable({
        '/capture': async ({on}) => {
          capturedContext = on
          return {captured: true}
        }
      })

      const config = {
        services: {error: errorService, capture: captureService},
        settings: {debug: false},
        phases: {
          testQuery: ['[error]/fail', {
            someArg: 'value',
            onError: ['[capture]/capture', {on: '@'}],
            ignoreErrors: true
          }]
        }
      }

      await query(config)

      assert.ok(capturedContext)
      assert.match(capturedContext.message, /\[\$testQuery\.@1 - \[error\]\/fail\] Service failed/)
      assert.strictEqual(capturedContext.address, '$testQuery.@1')
      assert.strictEqual(capturedContext.key, '[error]/fail')
      assert.strictEqual(capturedContext.args.someArg, 'value')
    })
  })

  describe('Validation Error Attribution in Nested Services', () => {
    it('should attribute postcheck errors to nested service, not wrapper service', async () => {
      const atLeastOne = z.array(z.object({})).min(1)
      const scraper = serviceFromTable({
        '/extract': {
          output: [['type', {fromZod: z.object({images: atLeastOne, websites: atLeastOne})}]],
          async call() {
            return {
              images: [], // Will fail postcheck
              websites: []
            }
          }
        }
      })

      const config = {
        services: {scraper},
        phases: {
          listings: ['$given.urls', '[util]/flattenEach', {
            service: ['[scraper]/extract', {url: '@'}]
          }]
        },
        given: {
          urls: ['http://example.com']
        }
      }

      await assert.rejects(
        query(config),
        (error) => {
          // Error properties should reflect the innermost service (where the error originated)
          assert.strictEqual(error.key, '[scraper]/extract')
          assert.strictEqual(error.address, '$listings.@1a1')

          // Error message should contain only the innermost service context
          // (outer services don't relabel an error that already has an address)
          assert.match(error.message, /\[\$listings\.@1a1 - \[scraper\]\/extract\]/)
          assert.match(error.message, /Service Schema Validation postcheck failed/)

          // Validation details should be present
          assert.match(error.message, /images:.*Too small/)
          assert.match(error.message, /websites:.*Too small/)

          return true
        }
      )
    })
  })
})
