import query from '../query.js'
import util from '../util.js'

// Test data
const testData = {
  people: [
    { name: 'Alice', age: 30, department: 'Engineering' },
    { name: 'Bob', age: 25, department: 'Marketing' },
    { name: 'Charlie', age: 35, department: 'Engineering' },
    { name: 'Diana', age: 28, department: 'Sales' }
  ],
  products: [
    { id: 1, name: 'Widget', price: 10.99, categories: ['tools', 'gadgets'] },
    { id: 2, name: 'Gadget', price: 25.50, categories: ['electronics', 'gadgets'] },
    { id: 3, name: 'Tool', price: 15.00, categories: ['tools', 'hardware'] }
  ],
  orders: [
    { orderId: 'A123', items: [1, 2] },
    { orderId: 'B456', items: [2, 3] },
    { orderId: 'C789', items: [1, 3] }
  ]
}

// Test services
const mockServices = {
  data: async (action, args) => {
    switch (action) {
      case 'getAge':
        return args.person.age
      case 'isEngineer':
        return args.person.department === 'Engineering'
      case 'formatName':
        return args.person.name.toUpperCase()
      case 'getCategories':
        return args.product.categories
      case 'calculateTotal':
        return args.items.reduce((sum, id) => {
          const product = args.products.find(p => p.id === id)
          return sum + (product ? product.price : 0)
        }, 0)
      default:
        throw new Error(`Unknown action: ${action}`)
    }
  },
  util
}

// Test cases for direct util service usage
const directTests = [
  {
    name: 'map with template',
    test: async () => {
      const result = await util.map({
        collection: testData.people,
        template: {
          fullName: '@.name',
          yearsOld: '@.age',
          team: '@.department'
        }
      })
      
      return result.length === 4 && 
             result[0].fullName === 'Alice' &&
             result[0].yearsOld === 30 &&
             result[0].team === 'Engineering'
    }
  },
  
  {
    name: 'concat arrays',
    test: async () => {
      const result = await util.concat({
        args: [
          ['a', 'b'],
          ['c', 'd'],
          ['e']
        ]
      })
      
      return JSON.stringify(result) === JSON.stringify(['a', 'b', 'c', 'd', 'e'])
    }
  },
  
  {
    name: 'when with boolean condition',
    test: async () => {
      const resultTrue = await util.when({
        test: true,
        then: 'success',
        or: 'failure'
      })
      
      const resultFalse = await util.when({
        test: false,
        then: 'success',
        or: 'failure'
      })
      
      return resultTrue === 'success' && resultFalse === 'failure'
    }
  },
  
  {
    name: 'comparison functions',
    test: async () => {
      const eq = await util.eq({ l: 5, r: 5 })
      const neq = await util.eq({ l: 5, r: 3 })
      const gt = await util.gt({ l: 10, r: 5 })
      const lt = await util.lt({ l: 3, r: 8 })
      
      return eq === true && neq === false && gt === true && lt === true
    }
  },
  
  {
    name: 'exists and length',
    test: async () => {
      const exists1 = await util.exists({ value: 'hello' })
      const exists2 = await util.exists({ value: null })
      const len1 = await util.length({ value: 'hello' })
      const len2 = await util.length({ value: [1, 2, 3] })
      
      return exists1 === true && exists2 === false && len1 === 5 && len2 === 3
    }
  }
]

// Test cases for MicroQL integration
const integrationTests = [
  {
    name: 'util.map with template in MicroQL',
    config: {
      given: { people: testData.people },
      services: { util },
      query: {
        summary: ['util', 'map', {
          collection: '$.given.people',
          template: {
            name: '@.name',
            info: '@.department'
          }
        }]
      },
      select: 'summary'
    },
    expected: [
      { name: 'Alice', info: 'Engineering' },
      { name: 'Bob', info: 'Marketing' },
      { name: 'Charlie', info: 'Engineering' },
      { name: 'Diana', info: 'Sales' }
    ]
  },
  
  {
    name: 'util.map with service function',
    config: {
      given: { people: testData.people },
      services: mockServices,
      query: {
        formatted: ['util', 'map', {
          collection: '$.given.people',
          fn: ['data', 'formatName', { person: '@' }]
        }]
      },
      select: 'formatted'
    },
    expected: ['ALICE', 'BOB', 'CHARLIE', 'DIANA']
  },
  
  {
    name: 'util.filter with predicate',
    config: {
      given: { people: testData.people },
      services: mockServices,
      query: {
        engineers: ['util', 'filter', {
          collection: '$.given.people',
          predicate: ['data', 'isEngineer', { person: '@' }]
        }]
      },
      select: 'engineers'
    },
    expected: testData.people.filter(p => p.department === 'Engineering')
  },
  
  {
    name: 'util.flatMap example',
    config: {
      given: { products: testData.products },
      services: mockServices,
      query: {
        allCategories: ['util', 'flatMap', {
          collection: '$.given.products',
          fn: ['data', 'getCategories', { product: '@' }]
        }]
      },
      select: 'allCategories'
    },
    expected: ['tools', 'gadgets', 'electronics', 'gadgets', 'tools', 'hardware']
  },
  
  {
    name: 'util.when with service call condition',
    config: {
      given: { person: { name: 'Alice', age: 30 } },
      services: {
        util,
        age: async (action, { person }) => {
          if (action === 'isAdult') return person.age >= 18
          throw new Error(`Unknown action: ${action}`)
        }
      },
      query: {
        status: ['util', 'when', {
          test: ['age', 'isAdult', { person: '$.given.person' }],
          then: 'Adult',
          or: 'Minor'
        }]
      },
      select: 'status'
    },
    expected: 'Adult'
  },
  
  {
    name: 'method syntax with util',
    config: {
      given: { items: [{ id: 1 }, { id: 2 }, { id: 3 }] },
      services: { util },
      methods: ['util'],
      query: {
        processed: ['$.given.items', 'util:map', {
          template: { original: '@.id', processed: true }
        }]
      },
      select: 'processed'
    },
    expected: [
      { original: 1, processed: true },
      { original: 2, processed: true },
      { original: 3, processed: true }
    ]
  },
  
  {
    name: 'complex data processing pipeline',
    config: {
      given: { 
        orders: testData.orders,
        products: testData.products
      },
      services: mockServices,
      query: {
        // Calculate total for each order
        orderTotals: ['util', 'map', {
          collection: '$.given.orders',
          fn: ['data', 'calculateTotal', { 
            items: '@.items',
            products: testData.products  // Use literal data instead of JSONPath
          }]
        }],
        
        // Filter to orders over $30
        bigOrders: ['util', 'filter', {
          collection: '$.orderTotals',
          predicate: ['util', 'gt', { l: '@', r: 30 }]
        }],
        
        // Count big orders
        bigOrderCount: ['util', 'length', { value: '$.bigOrders' }]
      },
      select: 'bigOrderCount'
    },
    expected: 2  // Orders B456 and C789 are over $30
  }
]

// Test runner
async function runDirectTests() {
  console.log('=== Direct Util Service Tests ===')
  let passed = 0
  
  for (const { name, test } of directTests) {
    try {
      const result = await test()
      if (result) {
        console.log(`✓ ${name}`)
        passed++
      } else {
        console.log(`✗ ${name} - Test returned false`)
      }
    } catch (error) {
      console.log(`✗ ${name} - Error: ${error.message}`)
    }
  }
  
  return passed
}

async function runIntegrationTests() {
  console.log('\n=== MicroQL Integration Tests ===')
  let passed = 0
  
  for (const testCase of integrationTests) {
    try {
      const result = await query(testCase.config)
      const success = JSON.stringify(result) === JSON.stringify(testCase.expected)
      
      if (success) {
        console.log(`✓ ${testCase.name}`)
        passed++
      } else {
        console.log(`✗ ${testCase.name}`)
        console.log('  Expected:', testCase.expected)
        console.log('  Got:     ', result)
      }
    } catch (error) {
      console.log(`✗ ${testCase.name} - Error: ${error.message}`)
    }
  }
  
  return passed
}

// Main test execution
async function runAllUtilTests() {
  console.log('Running Util Service Tests...\n')
  
  const directPassed = await runDirectTests()
  const integrationPassed = await runIntegrationTests()
  
  const totalPassed = directPassed + integrationPassed
  const totalTests = directTests.length + integrationTests.length
  
  console.log(`\n=== Results ===`)
  console.log(`${totalPassed}/${totalTests} tests passed`)
  
  if (totalPassed === totalTests) {
    console.log('🎉 All util tests passed!')
    return true
  } else {
    console.log('❌ Some util tests failed')
    return false
  }
}

export default runAllUtilTests

// Run tests if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runAllUtilTests().then(success => {
    process.exit(success ? 0 : 1)
  }).catch(error => {
    console.error('Util test suite crashed:', error)
    process.exit(1)
  })
}