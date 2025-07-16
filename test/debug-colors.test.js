import assert from 'node:assert'
import { afterEach, beforeEach, describe, it } from 'node:test'
import query from '../query.js'

describe('Debug Color Tests', () => {
  let originalLog
  let logCalls = []

  beforeEach(() => {
    // Capture console.log calls
    originalLog = console.log
    logCalls = []
    console.log = (...args) => {
      logCalls.push(args.join(' '))
    }
  })

  afterEach(() => {
    // Restore original console.log
    console.log = originalLog
  })

  it('should use unique colors for different services in debug mode', async () => {
    await query({
      settings: { debug: true },
      services: {
        serviceA: {
          async test() {
            return 'resultA'
          }
        },
        serviceB: {
          async test() {
            return 'resultB'
          }
        },
        serviceC: {
          async test() {
            return 'resultC'
          }
        }
      },
      query: {
        testA: ['serviceA', 'test', {}],
        testB: ['serviceB', 'test', {}],
        testC: ['serviceC', 'test', {}]
      }
    })

    // Extract service calls from debug logs
    const serviceCalls = logCalls.filter((log) => log.includes('Called with:'))

    // Should have debug logs for each service
    assert(
      serviceCalls.some((log) => log.includes('[serviceA.test]')),
      'Should log serviceA calls'
    )
    assert(
      serviceCalls.some((log) => log.includes('[serviceB.test]')),
      'Should log serviceB calls'
    )
    assert(
      serviceCalls.some((log) => log.includes('[serviceC.test]')),
      'Should log serviceC calls'
    )

    // Check for ANSI color codes in the logs
    const colorCodes = [
      '\x1b[32m', // green
      '\x1b[33m', // yellow
      '\x1b[34m', // blue
      '\x1b[35m', // magenta
      '\x1b[36m', // cyan
      '\x1b[37m' // white
    ]

    let foundColorCodes = 0
    for (const log of logCalls) {
      for (const colorCode of colorCodes) {
        if (log.includes(colorCode)) {
          foundColorCodes++
          break // Count each log only once
        }
      }
    }

    // Should have colored output for debug logs
    assert(
      foundColorCodes > 0,
      `Expected colored debug output, but found no ANSI color codes in logs: ${JSON.stringify(logCalls)}`
    )
  })

  it('should assign consistent colors to the same service across calls', async () => {
    // First call
    await query({
      settings: { debug: true },
      services: {
        testService: {
          async method() {
            return 'result1'
          }
        }
      },
      query: {
        test1: ['testService', 'method', {}]
      }
    })

    const firstCallLogs = [...logCalls]
    logCalls = []

    // Second call with same service
    await query({
      settings: { debug: true },
      services: {
        testService: {
          async method() {
            return 'result2'
          }
        }
      },
      query: {
        test2: ['testService', 'method', {}]
      }
    })

    const secondCallLogs = [...logCalls]

    // Extract color from service logs
    const extractColor = (logs) => {
      const serviceLog = logs.find((log) =>
        log.includes('[testService.method]'))
      if (!serviceLog) return null

      const colorCodes = [
        '\x1b[32m', // green
        '\x1b[33m', // yellow
        '\x1b[34m', // blue
        '\x1b[35m', // magenta
        '\x1b[36m', // cyan
        '\x1b[37m' // white
      ]

      for (const colorCode of colorCodes) {
        if (serviceLog.includes(colorCode)) {
          return colorCode
        }
      }
      return null
    }

    const firstColor = extractColor(firstCallLogs)
    const secondColor = extractColor(secondCallLogs)

    assert(firstColor !== null, 'First call should have colored output')
    assert(secondColor !== null, 'Second call should have colored output')
    assert.strictEqual(
      firstColor,
      secondColor,
      'Same service should use same color across calls'
    )
  })

  it('should not use red color for services (reserved for errors)', async () => {
    await query({
      settings: { debug: true },
      services: {
        testService: {
          async method() {
            return 'result'
          }
        }
      },
      query: {
        test: ['testService', 'method', {}]
      }
    })

    // Check that no debug logs use red color
    const redColorCode = '\x1b[31m'
    const hasRedInDebugLogs = logCalls.some(
      (log) =>
        log.includes('[testService.method]') && log.includes(redColorCode)
    )

    assert(
      !hasRedInDebugLogs,
      'Debug logs should not use red color (reserved for errors)'
    )
  })
})
