import query from '../query.js'

// Test data sets
const testCases = [
  {
    name: 'Basic dependency chain',
    config: {
      given: { userId: 'user123' },
      services: {
        users: async (action, { id }) => {
          if (action === 'getProfile') return { id, name: 'John', email: 'john@example.com' }
        },
        audit: async (action, { user }) => {
          if (action === 'log') return { logged: true, user: user.name }
        }
      },
      query: {
        profile: ['users', 'getProfile', { id: '$.given.userId' }],
        auditLog: ['audit', 'log', { user: '$.profile' }]
      }
    },
    expected: {
      profile: { id: 'user123', name: 'John', email: 'john@example.com' },
      auditLog: { logged: true, user: 'John' }
    }
  },
  
  {
    name: 'Object service auto-wrapping',
    config: {
      given: { numbers: [1, 2, 3, 4, 5] },
      services: {
        math: {
          async sum({ values }) { return values.reduce((a, b) => a + b, 0) },
          async average({ values }) { return values.reduce((a, b) => a + b, 0) / values.length },
          async max({ values }) { return Math.max(...values) }
        }
      },
      query: {
        total: ['math', 'sum', { values: '$.given.numbers' }],
        avg: ['math', 'average', { values: '$.given.numbers' }],
        maximum: ['math', 'max', { values: '$.given.numbers' }]
      }
    },
    expected: {
      total: 15,
      avg: 3,
      maximum: 5
    }
  },
  
  {
    name: 'Method syntax with data transformation',
    config: {
      given: { items: ['apple', 'banana', 'cherry'] },
      services: {
        transform: {
          async filter({ on, predicate }) { 
            return on.filter(item => item.includes(predicate)) 
          },
          async upper({ on }) { 
            return on.map(item => item.toUpperCase()) 
          },
          async count({ on }) { 
            return on.length 
          }
        }
      },
      methods: ['transform'],
      query: {
        filtered: ['$.given.items', 'transform:filter', { predicate: 'a' }],
        uppercased: ['$.filtered', 'transform:upper', {}],
        count: ['$.uppercased', 'transform:count', {}]
      }
    },
    expected: {
      filtered: ['apple', 'banana'],
      uppercased: ['APPLE', 'BANANA'],
      count: 2
    }
  },
  
  {
    name: 'Service chains with @ symbol',
    config: {
      given: { text: 'Hello World 123' },
      services: {
        text: {
          async extractNumbers({ input }) {
            return input.match(/\d+/g) || []
          },
          async sum({ numbers }) {
            return numbers.map(Number).reduce((a, b) => a + b, 0)
          }
        }
      },
      query: {
        result: [
          ['text', 'extractNumbers', { input: '$.given.text' }],
          ['text', 'sum', { numbers: '@' }]
        ]
      }
    },
    expected: {
      result: 123
    }
  },
  
  {
    name: 'Complex @ symbol field access',
    config: {
      given: { userData: 'name:John,age:30,city:NYC' },
      services: {
        parser: {
          async parseKeyValue({ data }) {
            const pairs = data.split(',')
            const result = {}
            pairs.forEach(pair => {
              const [key, value] = pair.split(':')
              result[key] = value
            })
            return result
          },
          async formatGreeting({ name, city }) {
            return `Hello ${name} from ${city}!`
          }
        }
      },
      query: {
        parsed: ['parser', 'parseKeyValue', { data: '$.given.userData' }],
        greeting: ['parser', 'formatGreeting', { 
          name: '$.parsed.name', 
          city: '$.parsed.city' 
        }]
      }
    },
    expected: {
      parsed: { name: 'John', age: '30', city: 'NYC' },
      greeting: 'Hello John from NYC!'
    }
  },
  
  {
    name: 'Parallel execution test',
    config: {
      given: { delay: 10 },
      services: {
        async: {
          async delay({ ms, value }) {
            await new Promise(resolve => setTimeout(resolve, ms))
            return value
          }
        }
      },
      query: {
        task1: ['async', 'delay', { ms: '$.given.delay', value: 'A' }],
        task2: ['async', 'delay', { ms: '$.given.delay', value: 'B' }],
        task3: ['async', 'delay', { ms: '$.given.delay', value: 'C' }]
      }
    },
    expected: {
      task1: 'A',
      task2: 'B', 
      task3: 'C'
    }
  },
  
  {
    name: 'Select functionality',
    config: {
      given: { x: 5, y: 10 },
      services: {
        calc: {
          async add({ a, b }) { return a + b },
          async multiply({ a, b }) { return a * b }
        }
      },
      query: {
        sum: ['calc', 'add', { a: '$.given.x', b: '$.given.y' }],
        product: ['calc', 'multiply', { a: '$.given.x', b: '$.given.y' }],
        unused: ['calc', 'add', { a: 1, b: 2 }]
      },
      select: ['sum', 'product']
    },
    expected: {
      sum: 15,
      product: 50
    }
  },
  
  {
    name: 'Alias jobs (JSONPath references)',
    config: {
      given: { user: { profile: { name: 'Alice', settings: { theme: 'dark' } } } },
      services: {},
      query: {
        userName: '$.given.user.profile.name',
        userTheme: '$.given.user.profile.settings.theme',
        fullProfile: '$.given.user.profile'
      }
    },
    expected: {
      userName: 'Alice',
      userTheme: 'dark',
      fullProfile: { name: 'Alice', settings: { theme: 'dark' } }
    }
  }
]

// Error test cases
const errorCases = [
  {
    name: 'Missing service',
    config: {
      given: { x: 1 },
      services: {},
      query: {
        result: ['nonexistent', 'action', { value: '$.given.x' }]
      }
    },
    expectedError: /Service 'nonexistent' not found/
  },
  
  {
    name: 'Missing service method',
    config: {
      given: { x: 1 },
      services: {
        test: { validMethod() { return 'ok' } }
      },
      query: {
        result: ['test', 'invalidMethod', { value: '$.given.x' }]
      }
    },
    expectedError: /Service method 'invalidMethod' not found/
  },
  
  {
    name: 'Missing dependency',
    config: {
      given: { start: 1 },
      services: {
        test: async (action, { value }) => value + 1
      },
      query: {
        result: ['test', 'increment', { value: '$.nonexistent' }]
      }
    },
    expectedError: /Task 'nonexistent' not found/
  },
  
  {
    name: 'Invalid service type',
    config: {
      given: { data: [1, 2, 3] },
      services: {
        invalid: 'not a function or object'
      },
      query: {
        result: ['invalid', 'action', { value: '$.given.data' }]
      }
    },
    expectedError: /Invalid service 'invalid'/
  }
]

// Performance test
const performanceTest = {
  name: 'Large parallel execution',
  config: {
    given: { count: 50 },
    services: {
      worker: {
        async process({ id }) {
          // Simulate some work
          await new Promise(resolve => setTimeout(resolve, Math.random() * 5))
          return `processed-${id}`
        }
      }
    },
    query: Object.fromEntries(
      Array.from({ length: 50 }, (_, i) => [
        `task${i}`,
        ['worker', 'process', { id: i }]
      ])
    )
  }
}

// Test runner
async function runTest(testCase) {
  try {
    const start = Date.now()
    const result = await query(testCase.config)
    const duration = Date.now() - start
    
    // Deep comparison - exclude 'given' from result if not in expected
    const compareResult = testCase.expected.given ? result : { ...result }
    if (!testCase.expected.given && result.given) {
      delete compareResult.given
    }
    const success = JSON.stringify(compareResult) === JSON.stringify(testCase.expected)
    
    if (success) {
      console.log(`✓ ${testCase.name} (${duration}ms)`)
      return true
    } else {
      console.log(`✗ ${testCase.name} - Expected:`, testCase.expected)
      console.log(`  Got:`, result)
      return false
    }
  } catch (error) {
    console.log(`✗ ${testCase.name} - Error:`, error.message)
    return false
  }
}

async function runErrorTest(testCase) {
  try {
    await query(testCase.config)
    console.log(`✗ ${testCase.name} - Should have thrown error`)
    return false
  } catch (error) {
    if (testCase.expectedError.test(error.message)) {
      console.log(`✓ ${testCase.name} - Correctly threw: ${error.message}`)
      return true
    } else {
      console.log(`✗ ${testCase.name} - Wrong error: ${error.message}`)
      return false
    }
  }
}

async function runPerformanceTest() {
  console.log('\nPerformance Test:')
  const start = Date.now()
  const result = await query(performanceTest.config)
  const duration = Date.now() - start
  
  // Check that all 50 tasks completed successfully
  const taskResults = Object.entries(result)
    .filter(([key]) => key.startsWith('task'))
    .map(([key, value]) => ({ key, value, expected: `processed-${key.slice(4)}` }))
  
  const allProcessed = taskResults.every(({ value, expected }) => value === expected)
  
  if (allProcessed) {
    console.log(`✓ ${performanceTest.name} - 50 parallel tasks completed in ${duration}ms`)
    return true
  } else {
    console.log(`✗ ${performanceTest.name} - Some tasks failed`)
    return false
  }
}

// Main test suite
async function runAllTests() {
  console.log('Running Comprehensive MicroQL Tests...\n')
  
  let passed = 0
  let total = 0
  
  // Basic functionality tests
  console.log('=== Basic Functionality Tests ===')
  for (const testCase of testCases) {
    total++
    if (await runTest(testCase)) passed++
  }
  
  // Error handling tests
  console.log('\n=== Error Handling Tests ===')
  for (const testCase of errorCases) {
    total++
    if (await runErrorTest(testCase)) passed++
  }
  
  // Performance test
  total++
  if (await runPerformanceTest()) passed++
  
  console.log(`\n=== Results ===`)
  console.log(`${passed}/${total} tests passed`)
  
  if (passed === total) {
    console.log('🎉 All tests passed!')
    process.exit(0)
  } else {
    console.log('❌ Some tests failed')
    process.exit(1)
  }
}

runAllTests().catch(error => {
  console.error('Test suite crashed:', error)
  process.exit(1)
})