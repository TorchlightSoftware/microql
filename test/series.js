import query from '../query.js'

// Simple assertion helper
const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message || 'Assertion failed')
  }
  console.log('✓', message || 'Test passed')
}

// Test services (function-based)
const fieldAgent = async (action, { animal }) => {
  if (action === 'findAnimal') return animal
  if (action === 'tranquilize') return `Sleepy ${animal}`
  throw new Error(`Unknown action: ${action}`)
}

const truck = async (action, { animal }) => {
  if (action === 'bringHome') return `Friendly ${animal}`
  throw new Error(`Unknown action: ${action}`)
}

// Test services (object-based)
const util = {
  async map({ on, fn }) {
    if (!Array.isArray(on)) return []
    return Promise.all(on.map(item => {
      // Execute the function service call on each item
      const [serviceName, action, args] = fn
      // This would need the services context, simplified for test
      return `${action}(${item})`
    }))
  },
  
  async filter({ on, predicate }) {
    if (!Array.isArray(on)) return []
    return on.filter(item => item.includes(predicate))
  }
}

async function runTests() {
  console.log('Running MicroQL Tests...\n')
  
  // Test 1: Basic series execution with new syntax
  console.log('Test 1: Basic series execution')
  try {
    const result = await query({
      given: { creatureType: 'Monkey' },
      services: { fieldAgent, truck },
      query: {
        monkey: ['fieldAgent', 'findAnimal', { animal: '$.given.creatureType' }],
        caged: ['fieldAgent', 'tranquilize', { animal: '$.monkey' }],
        pet: ['truck', 'bringHome', { animal: '$.caged' }],
      },
      select: 'pet'
    })
    
    assert(result === 'Friendly Sleepy Monkey', 'Should return "Friendly Sleepy Monkey"')
  } catch (error) {
    console.error('Test 1 failed:', error.message)
    process.exit(1)
  }
  
  // Test 2: Service object auto-wrapping
  console.log('Test 2: Service object auto-wrapping')
  try {
    const result = await query({
      given: { items: ['apple', 'banana', 'cherry'] },
      services: { util },
      query: {
        filtered: ['util', 'filter', { on: '$.given.items', predicate: 'a' }]
      },
      select: 'filtered'
    })
    
    assert(Array.isArray(result), 'Should return an array')
    assert(result.length === 2, 'Should filter to 2 items containing "a"')
  } catch (error) {
    console.error('Test 2 failed:', error.message)
    process.exit(1)
  }
  
  // Test 3: Method syntax (basic)
  console.log('Test 3: Method syntax')
  try {
    const result = await query({
      given: { items: ['test1', 'test2'] },
      services: { util },
      methods: ['util'],
      query: {
        filtered: ['$.given.items', 'util:filter', { predicate: '1' }]
      },
      select: 'filtered'
    })
    
    assert(Array.isArray(result), 'Should return an array')
    assert(result.length === 1, 'Should filter to 1 item containing "1"')
  } catch (error) {
    console.error('Test 3 failed:', error.message)
    process.exit(1)
  }
  
  // Test 4: Service chains
  console.log('Test 4: Service chains')
  try {
    const result = await query({
      given: { creatureType: 'Cat' },
      services: { fieldAgent, truck },
      query: {
        petChain: [
          ['fieldAgent', 'findAnimal', { animal: '$.given.creatureType' }],
          ['fieldAgent', 'tranquilize', { animal: '@' }],
          ['truck', 'bringHome', { animal: '@' }]
        ]
      },
      select: 'petChain'
    })
    
    assert(result === 'Friendly Sleepy Cat', 'Should chain operations with @ symbol')
  } catch (error) {
    console.error('Test 4 failed:', error.message)
    process.exit(1)
  }
  
  console.log('\n✅ All tests passed!')
}

runTests().catch(error => {
  console.error('Test suite failed:', error)
  process.exit(1)
})