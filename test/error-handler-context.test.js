/**
 * Test for onError handler receiving correct error context
 */

import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import query from '../query.js'

describe('Error Handler Context Tests', () => {
  it('should pass error object when error occurs in nested service within util:map - SINGLE ITEM', async () => {
    let capturedContext = null

    const services = {
      failing: {
        async process() {
          throw new Error('Test failure')
        }
      },
      recorder: {
        async record(args) {
          capturedContext = args.on
          return {recorded: true}
        }
      }
    }

    services.recorder.record._argtypes = {
      on: {argOrder: 0}
    }

    const config = {
      services,
      given: {items: [1]}, // Single item
      queries: {
        mapped: ['$.given.items', 'util:map', {
          service: ['failing:process', {
            data: '@',
            onError: ['@', 'recorder:record'],
            ignoreErrors: true
          }]
        }]
      }
    }

    await query(config)

    console.log('\n=== SINGLE ITEM - Captured context:', capturedContext)
    console.log('Is Error?', capturedContext instanceof Error)
    if (capturedContext instanceof Error) {
      console.log('✓ SUCCESS: Error context preserved with single item')
    } else {
      console.log('✗ FAIL: Lost error context with single item')
    }

    // Assertions to ensure test actually fails if bug returns
    assert.ok(capturedContext instanceof Error, 'Should receive Error object, not query results')
    assert.strictEqual(capturedContext.serviceName, 'failing', 'Should have correct serviceName')
    assert.strictEqual(capturedContext.action, 'process', 'Should have correct action')
  })

  it('should pass error object when error occurs in nested service within util:map - TWO ITEMS', async () => {
    let capturedContext = null

    const services = {
      failing: {
        async process() {
          throw new Error('Test failure')
        }
      },
      recorder: {
        async record(args) {
          capturedContext = args.on
          return {recorded: true}
        }
      }
    }

    services.recorder.record._argtypes = {
      on: {argOrder: 0}
    }

    const config = {
      services,
      given: {items: [1, 2]}, // Two items
      queries: {
        mapped: ['$.given.items', 'util:map', {
          service: ['failing:process', {
            data: '@',
            onError: ['@', 'recorder:record'],
            ignoreErrors: true
          }]
        }]
      }
    }

    await query(config)

    console.log('\n=== TWO ITEMS - Captured context:', capturedContext)
    console.log('Is Error?', capturedContext instanceof Error)
    if (capturedContext instanceof Error) {
      console.log('✓ SUCCESS: Error context preserved with two items')
    } else {
      console.log('✗ FAIL: Lost error context with two items')
    }

    // Assertions to ensure test actually fails if bug returns
    assert.ok(capturedContext instanceof Error, 'Should receive Error object, not query results')
    assert.strictEqual(capturedContext.serviceName, 'failing', 'Should have correct serviceName')
    assert.strictEqual(capturedContext.action, 'process', 'Should have correct action')
  })

  it('should pass error object as @ context to onError handler', async () => {
    let capturedContext = null

    const services = {
      failing: {
        async process() {
          throw new Error('Test failure')
        }
      },
      recorder: {
        async record({on}) {
          capturedContext = on
          return {recorded: true}
        }
      }
    }

    // Add argOrder for method syntax
    services.recorder.record._argtypes = {
      on: {argOrder: 0}
    }

    // Add validation to recorder to ensure it receives error context
    services.recorder.record._validators = {
      precheck: {
        on: {
          message: ['string'],
          serviceName: ['string'],
          action: ['string'],
          queryName: ['string']
        }
      }
    }

    const config = {
      services,
      queries: {
        test: ['failing:process', {
          onError: ['@', 'recorder:record'],
          ignoreErrors: true
        }]
      }
    }

    await query(config)

    // Verify the recorder received the error object, not query results
    assert.ok(capturedContext, 'Context should be captured')
    assert.ok(capturedContext.message, 'Should have error message')
    assert.strictEqual(capturedContext.serviceName, 'failing')
    assert.strictEqual(capturedContext.action, 'process')
  })

  it('should pass error object to onError handler with additional args', async () => {
    let capturedContext = null
    let capturedLocation = null

    const services = {
      failing: {
        async process() {
          throw new Error('Test failure')
        }
      },
      recorder: {
        async record({on, location}) {
          capturedContext = on
          capturedLocation = location
          return {recorded: true}
        }
      }
    }

    services.recorder.record._argtypes = {
      on: {argOrder: 0}
    }

    // Add validation to ensure it receives error context
    services.recorder.record._validators = {
      precheck: {
        on: {
          message: ['string'],
          serviceName: ['string'],
          action: ['string'],
          queryName: ['string']
        }
      }
    }

    const config = {
      services,
      queries: {
        test: ['failing:process', {
          onError: ['@', 'recorder:record', {location: 'db/failed/test'}],
          ignoreErrors: true
        }]
      }
    }

    await query(config)

    // Verify the recorder received the error object
    assert.ok(capturedContext, 'Context should be captured')
    assert.ok(capturedContext.message, 'Should have error message')
    assert.strictEqual(capturedContext.serviceName, 'failing')
    assert.strictEqual(capturedContext.action, 'process')
    assert.strictEqual(capturedLocation, 'db/failed/test')
  })
})
