/**
 * Test for onError handler receiving correct error context
 */

import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import {z} from 'zod'
import query, {serviceFromTable} from '../index.js'

// The context MicroQL attaches to the error onError receives.
const errorContext = z.object({message: z.string(), key: z.string(), address: z.string()})

describe('Error Handler Context Tests', () => {
  it('should pass error object when error occurs in nested service within util:map - SINGLE ITEM', async () => {
    let capturedContext = null

    const services = {
      failing: serviceFromTable({
        async '/process'() {
          throw new Error('Test failure')
        }
      }),
      recorder: serviceFromTable({
        '/record': {
          input: {on: ['target']},
          async call(args) {
            capturedContext = args.on
            return {recorded: true}
          }
        }
      })
    }

    const config = {
      services,
      given: {items: [1]}, // Single item
      phases: {
        mapped: ['$given.items', '[util]/each', {
          service: ['[failing]/process', {
            data: '@',
            onError: ['@', '[recorder]/record'],
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
    assert.strictEqual(capturedContext.key, '[failing]/process', 'Should have correct key')
  })

  it('should pass error object when error occurs in nested service within util:map - TWO ITEMS', async () => {
    let capturedContext = null

    const services = {
      failing: serviceFromTable({
        async '/process'() {
          throw new Error('Test failure')
        }
      }),
      recorder: serviceFromTable({
        '/record': {
          input: {on: ['target']},
          async call(args) {
            capturedContext = args.on
            return {recorded: true}
          }
        }
      })
    }

    const config = {
      services,
      given: {items: [1, 2]}, // Two items
      phases: {
        mapped: ['$given.items', '[util]/each', {
          service: ['[failing]/process', {
            data: '@',
            onError: ['@', '[recorder]/record'],
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
    assert.strictEqual(capturedContext.key, '[failing]/process', 'Should have correct key')
  })

  it('should pass error object as @ context to onError handler', async () => {
    let capturedContext = null

    const services = {
      failing: serviceFromTable({
        async '/process'() {
          throw new Error('Test failure')
        }
      }),
      // on is the target, for method syntax, and is checked to be error context
      recorder: serviceFromTable({
        '/record': {
          input: {on: ['target', ['type', {fromZod: errorContext}]]},
          async call({on}) {
            capturedContext = on
            return {recorded: true}
          }
        }
      })
    }

    const config = {
      services,
      phases: {
        test: ['[failing]/process', {
          onError: ['@', '[recorder]/record'],
          ignoreErrors: true
        }]
      }
    }

    await query(config)

    // Verify the recorder received the error object, not query results
    assert.ok(capturedContext, 'Context should be captured')
    assert.ok(capturedContext.message, 'Should have error message')
    assert.strictEqual(capturedContext.key, '[failing]/process')
  })

  it('should pass error object to onError handler with additional args', async () => {
    let capturedContext = null
    let capturedLocation = null

    const services = {
      failing: serviceFromTable({
        async '/process'() {
          throw new Error('Test failure')
        }
      }),
      // on is the target, and is checked to be error context
      recorder: serviceFromTable({
        '/record': {
          input: {on: ['target', ['type', {fromZod: errorContext}]]},
          async call({on, location}) {
            capturedContext = on
            capturedLocation = location
            return {recorded: true}
          }
        }
      })
    }

    const config = {
      services,
      phases: {
        test: ['[failing]/process', {
          onError: ['@', '[recorder]/record', {location: 'db/failed/test'}],
          ignoreErrors: true
        }]
      }
    }

    await query(config)

    // Verify the recorder received the error object
    assert.ok(capturedContext, 'Context should be captured')
    assert.ok(capturedContext.message, 'Should have error message')
    assert.strictEqual(capturedContext.key, '[failing]/process')
    assert.strictEqual(capturedLocation, 'db/failed/test')
  })
})
