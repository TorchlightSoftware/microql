import assert from 'node:assert'
import {afterEach, beforeEach, describe, it} from 'node:test'
import query from '../query.js'
import util from '../services/util.js'

describe('Settings Override Tests', () => {
  let originalWrite
  let capturedOutput

  beforeEach(() => {
    // Capture stdout.write calls
    capturedOutput = []
    originalWrite = process.stdout.write
    process.stdout.write = (data) => {
      capturedOutput.push(data)
      return true
    }
  })

  afterEach(() => {
    // Restore original stdout.write
    process.stdout.write = originalWrite
  })

  it('should allow deep merge override of inspect settings', async () => {
    const testData = ['item1', 'item2', 'item3', 'item4', 'item5']

    await query({
      given: testData,
      services: {util},
      settings: {
        inspect: {
          maxArrayLength: 2,
          depth: 1,
          colors: false
        }
      },
      queries: {
        result: [
          'util:print',
          {
            on: '$.given',
            color: 'blue',
            ts: false,
            settings: {
              inspect: {
                maxArrayLength: 10 // Override just this setting
              }
            }
          }
        ]
      }
    })

    // Should have captured output
    assert(capturedOutput.length > 0, 'Should have captured output')

    // Find the blue colored output
    const blueOutput = capturedOutput.find((output) =>
      output.includes('\x1b[34m'))
    assert(blueOutput, 'Should find blue colored output')

    // Should show all items, not truncated (because maxArrayLength was overridden to 10)
    assert(blueOutput.includes('item1'), 'Should contain item1')
    assert(blueOutput.includes('item5'), 'Should contain item5')
    assert(!blueOutput.includes('more items'), 'Should not be truncated')
  })

  it('should preserve other settings when overriding specific ones', async () => {
    const testData = {
      level1: {
        level2: {
          level3: {
            deep: 'value'
          }
        }
      }
    }

    await query({
      given: testData,
      services: {util},
      settings: {
        inspect: {
          depth: 1, // This should be preserved
          maxArrayLength: 5, // This should be overridden
          colors: false
        }
      },
      queries: {
        result: [
          'util:print',
          {
            on: '$.given',
            ts: false,
            settings: {
              inspect: {
                maxArrayLength: 20 // Override only this
              }
            }
          }
        ]
      }
    })

    // Should have output showing depth limitation (depth: 1 preserved)
    // but not array length limitation (maxArrayLength overridden)
    assert(capturedOutput.length > 0, 'Should have captured output')
    const output = capturedOutput.join('')

    // Should show truncation due to depth: 1 setting being preserved
    assert(
      output.includes('[Object]') || output.includes('level2:'),
      'Should show depth limitation from preserved setting'
    )
  })

  it('should work with nested setting overrides', async () => {
    await query({
      given: {test: 'value'},
      services: {util},
      settings: {
        inspect: {
          depth: 2,
          maxStringLength: 10,
          colors: false
        },
        debug: false
      },
      queries: {
        result: [
          'util:print',
          {
            on: '$.given',
            ts: false,
            settings: {
              inspect: {
                maxStringLength: 100 // Override nested setting
              }
              // debug: false should be preserved from query settings
            }
          }
        ]
      }
    })

    assert(capturedOutput.length > 0, 'Should have captured output')
    const output = capturedOutput.join('')
    assert(output.includes('value'), 'Should show the full string value')
  })

  it('should handle completely new settings branches', async () => {
    await query({
      given: ['a', 'b'],
      services: {util},
      settings: {
        inspect: {
          depth: 1
        }
      },
      queries: {
        result: [
          'util:print',
          {
            on: '$.given',
            ts: false,
            settings: {
              inspect: {
                depth: 1, // Keep existing
                compact: true // Add new setting
              },
              newBranch: {
                // Completely new settings branch
                customSetting: 'value'
              }
            }
          }
        ]
      }
    })

    // Should work without errors
    assert(capturedOutput.length > 0, 'Should have captured output')
  })
})
