import assert from 'node:assert'
import {afterEach, beforeEach, describe, it} from 'node:test'
import query from '../query.js'
import {ANSI_COLORS} from '../common.js'

describe('Debug Color Tests', () => {
  let originalWrite
  let captureState

  // Helper function to extract ANSI color code from a log string
  const extractColor = (log) => {
    // Get all color codes except 'reset'
    const colorCodes = Object.entries(ANSI_COLORS)
      .filter(([name]) => name !== 'reset')
      .map(([, code]) => code)
    
    for (const color of colorCodes) {
      if (log.includes(color)) return color
    }
    return null
  }

  beforeEach(() => {
    // Capture stdout.write calls
    captureState = {outputs: []}
    originalWrite = process.stdout.write
    process.stdout.write = function (data) {
      captureState.outputs.push(data)
      return true
    }
  })

  afterEach(() => {
    // Restore original stdout.write
    process.stdout.write = originalWrite
  })

  it('should use unique colors for different services in debug mode', async () => {
    const _result = await query({
      settings: {debug: true},
      services: {
        serviceA: {
          async test() {
            await new Promise(resolve => setTimeout(resolve, 10))
            return 'resultA'
          }
        },
        serviceB: {
          async test() {
            await new Promise(resolve => setTimeout(resolve, 20))
            return 'resultB'
          }
        },
        serviceC: {
          async test() {
            await new Promise(resolve => setTimeout(resolve, 30))
            return 'resultC'
          }
        }
      },
      queries: {
        testA: ['serviceA', 'test', {}],
        testB: ['serviceB', 'test', {}],
        testC: ['serviceC', 'test', {}]
      }
    })

    // Should have captured output
    assert(captureState.outputs.length > 0, `Should have captured output, but got: ${captureState.outputs.length} items`)

    // Should have debug logs for each service
    const output = captureState.outputs.join('')
    assert(output.includes('[serviceA:test]'), 'Should log serviceA calls')
    assert(output.includes('[serviceB:test]'), 'Should log serviceB calls')
    assert(output.includes('[serviceC:test]'), 'Should log serviceC calls')

    // Check for ANSI color codes in the logs
    const coloredLogs = captureState.outputs.filter(log => extractColor(log) !== null)
    assert(
      coloredLogs.length > 0,
      `Expected colored debug output, but found no ANSI color codes in logs: ${JSON.stringify(captureState.outputs.slice(0, 3))}`
    )
  })



  it('should use consistent colors for same service name', async () => {
    // Test that the same service gets the same color across multiple queries
    await query({
      settings: {debug: true},
      services: {
        consistentService: {
          async action1() { return 'r1' },
          async action2() { return 'r2' }
        },
        differentService: {
          async action() { return 'r3' }
        }
      },
      queries: {
        q1: ['consistentService', 'action1', {}],
        q2: ['differentService', 'action', {}],
        q3: ['consistentService', 'action2', {}]
      }
    })

    // Find all logs for consistentService
    const consistentLogs = captureState.outputs.filter(log =>
      log.includes('[consistentService:'))
    assert(consistentLogs.length >= 2, 'Should have multiple logs for consistentService')

    // Extract colors from logs using helper
    const colors = consistentLogs.map(extractColor).filter(c => c !== null)
    assert(colors.length >= 2, 'Should extract colors from logs')

    // All colors for the same service should be identical
    const firstColor = colors[0]
    assert(colors.every(c => c === firstColor), 'Same service should always use same color')

    // Different service should have different color
    const differentLog = captureState.outputs.find(log =>
      log.includes('[differentService:'))
    assert(differentLog, 'Should find differentService log')
    const differentColor = extractColor(differentLog)
    assert(differentColor !== firstColor, 'Different services should have different colors')
  })

  it('should not use red color for services (reserved for errors)', async () => {
    await query({
      settings: {debug: true},
      services: {
        testService: {
          async method() {
            return 'result'
          }
        }
      },
      queries: {
        test: ['testService', 'method', {}]
      }
    })

    // Check that no debug logs use red color
    const hasRedInDebugLogs = captureState.outputs.some(
      (log) =>
        log.includes('[testService:method]') && log.includes(ANSI_COLORS.red)
    )

    assert(
      !hasRedInDebugLogs,
      'Debug logs should not use red color (reserved for errors)'
    )
  })
})
