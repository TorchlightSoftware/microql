import query from '../query.js'

// Test services with configurable delays
const createDelayService = (delay, name) => async (action, args) => {
  if (action === 'delay') {
    await new Promise(resolve => setTimeout(resolve, delay))
    return `${name} completed after ${delay}ms`
  }
  throw new Error(`Unknown action: ${action}`)
}

const testCases = [
  {
    name: 'No timeout - service completes normally',
    config: {
      given: { value: 'test' },
      services: {
        fast: createDelayService(50, 'fast')
      },
      query: {
        result: ['fast', 'delay', { input: '$.given.value' }]
      }
    },
    expectedResult: 'fast completed after 50ms',
    expectTimeout: false
  },
  
  {
    name: 'Default timeout - service times out',
    config: {
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
    },
    expectedError: /timed out after 100ms/,
    expectTimeout: true
  },
  
  {
    name: 'Default timeout - service completes within timeout',
    config: {
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
    },
    expectedResult: 'fast completed after 50ms',
    expectTimeout: false
  },
  
  {
    name: 'Service-specific timeout overrides default',
    config: {
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
    },
    expectedResult: 'medium completed after 150ms',
    expectTimeout: false
  },
  
  {
    name: 'Argument timeout overrides service and default',
    config: {
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
    },
    expectedResult: 'slow completed after 150ms',
    expectTimeout: false
  },
  
  {
    name: 'Argument timeout causes timeout',
    config: {
      given: { value: 'test' },
      services: {
        slow: createDelayService(150, 'slow')
      },
      timeouts: {
        default: 1000  // High default
      },
      query: {
        result: ['slow', 'delay', { 
          input: '$.given.value',
          timeout: 100   // But low arg timeout
        }]
      }
    },
    expectedError: /timed out after 100ms/,
    expectTimeout: true
  },

  {
    name: 'Multiple services with different timeouts',
    config: {
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
    },
    expectedResult: {
      fastResult: 'fast completed after 30ms',
      mediumResult: 'medium completed after 80ms', 
      slowResult: 'slow completed after 150ms'
    },
    expectTimeout: false
  },
  
  {
    name: 'Service chains with timeouts',
    config: {
      given: { value: 'test' },
      services: {
        step1: createDelayService(50, 'step1'),
        step2: createDelayService(60, 'step2')
      },
      timeouts: {
        default: 200  // Total time should be ~110ms, well under 200ms
      },
      query: {
        chained: [
          ['step1', 'delay', { input: '$.given.value' }],
          ['step2', 'delay', { input: '@' }]
        ]
      }
    },
    expectedResult: { chained: 'step2 completed after 60ms' },
    expectTimeout: false
  },
  
  {
    name: 'Service chains with individual step timeout',
    config: {
      given: { value: 'test' },
      services: {
        step1: createDelayService(50, 'step1'),
        step2: createDelayService(150, 'step2')  // This step will timeout
      },
      timeouts: {
        default: 100  // Each step gets 100ms
      },
      query: {
        chained: [
          ['step1', 'delay', { input: '$.given.value' }],
          ['step2', 'delay', { input: '@' }]
        ]
      }
    },
    expectedError: /step2\.delay.*timed out after 100ms/,
    expectTimeout: true
  }
]

// Test runner
async function runTimeoutTests() {
  console.log('Running Timeout Tests...\n')
  
  let passed = 0
  let total = testCases.length
  
  for (const testCase of testCases) {
    try {
      const start = Date.now()
      
      if (testCase.expectTimeout) {
        // Expecting an error
        try {
          await query(testCase.config)
          console.log(`✗ ${testCase.name} - Expected timeout but query succeeded`)
        } catch (error) {
          if (testCase.expectedError.test(error.message)) {
            const duration = Date.now() - start
            console.log(`✓ ${testCase.name} - Correctly timed out (${duration}ms)`)
            passed++
          } else {
            console.log(`✗ ${testCase.name} - Wrong error: ${error.message}`)
          }
        }
      } else {
        // Expecting success
        const result = await query(testCase.config)
        
        // Extract just the expected fields, excluding 'given'
        let compareResult
        if (typeof testCase.expectedResult === 'object' && testCase.expectedResult !== null && !Array.isArray(testCase.expectedResult)) {
          // Multiple fields expected
          compareResult = {}
          for (const key in testCase.expectedResult) {
            compareResult[key] = result[key]
          }
        } else {
          // Single field expected - assume it's in 'result' field
          compareResult = result.result
        }
        
        const success = JSON.stringify(compareResult) === JSON.stringify(testCase.expectedResult)
        const duration = Date.now() - start
        
        if (success) {
          console.log(`✓ ${testCase.name} (${duration}ms)`)
          passed++
        } else {
          console.log(`✗ ${testCase.name} - Expected:`, testCase.expectedResult)
          console.log(`  Got:`, compareResult)
        }
      }
    } catch (error) {
      console.log(`✗ ${testCase.name} - Unexpected error: ${error.message}`)
    }
  }
  
  console.log(`\n=== Timeout Test Results ===`)
  console.log(`${passed}/${total} tests passed`)
  
  if (passed === total) {
    console.log('🎉 All timeout tests passed!')
    return true
  } else {
    console.log('❌ Some timeout tests failed')
    return false
  }
}

export default runTimeoutTests

// Run tests if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runTimeoutTests().then(success => {
    process.exit(success ? 0 : 1)
  }).catch(error => {
    console.error('Timeout test suite crashed:', error)
    process.exit(1)
  })
}