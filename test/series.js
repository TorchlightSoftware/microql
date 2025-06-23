import query from '../query.js'

// Simple assertion helper
const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message || 'Assertion failed')
  }
  console.log('✓', message || 'Test passed')
}

// Test services (function-based) - E-commerce example
const orders = async (action, { id, customerId }) => {
  if (action === 'getOrder') return { 
    id, 
    customerId, 
    total: 99.99, 
    items: ['Widget', 'Gadget'] 
  }
  throw new Error(`Unknown action: ${action}`)
}

const payments = async (action, { customerId, amount }) => {
  if (action === 'chargeCard') return { 
    transactionId: 'TXN-12345',
    amount,
    status: 'approved'
  }
  throw new Error(`Unknown action: ${action}`)
}

const shipping = async (action, { order, paymentId }) => {
  if (action === 'createLabel') return {
    trackingNumber: '1Z999AA1012345678',
    status: 'ready',
    estimatedDelivery: '3-5 days'
  }
  throw new Error(`Unknown action: ${action}`)
}

// Test services (object-based)
const dataService = {
  async filter({ on, predicate }) {
    if (!Array.isArray(on)) return []
    return on.filter(item => item.includes(predicate))
  },
  
  async validate({ email }) {
    return email.includes('@') && email.includes('.')
  },
  
  async normalize({ email }) {
    return email.toLowerCase().trim()
  }
}

async function runTests() {
  console.log('Running MicroQL Tests...\n')
  
  // Test 1: Basic series execution with new syntax
  console.log('Test 1: E-commerce order processing pipeline')
  try {
    const result = await query({
      given: { orderId: 'ORDER-123', customerId: 'CUST-456' },
      services: { orders, payments, shipping },
      query: {
        order: ['orders', 'getOrder', { id: '$.given.orderId' }],
        payment: ['payments', 'chargeCard', { 
          customerId: '$.given.customerId',
          amount: '$.order.total' 
        }],
        shipment: ['shipping', 'createLabel', {
          order: '$.order',
          paymentId: '$.payment.transactionId'
        }],
      },
      select: 'shipment'
    })
    
    assert(result.trackingNumber === '1Z999AA1012345678', 'Should return tracking number')
    assert(result.status === 'ready', 'Should have ready status')
  } catch (error) {
    console.error('Test 1 failed:', error.message)
    process.exit(1)
  }
  
  // Test 2: Service object auto-wrapping
  console.log('\nTest 2: Service object auto-wrapping')
  try {
    const result = await query({
      given: { items: ['apple', 'banana', 'cherry'] },
      services: { dataService },
      query: {
        filtered: ['dataService', 'filter', { on: '$.given.items', predicate: 'a' }]
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
  console.log('\nTest 3: Method syntax')
  try {
    const result = await query({
      given: { emails: ['test@example.com', 'admin@example.org', 'invalid-email'] },
      services: { dataService },
      methods: ['dataService'],
      query: {
        filtered: ['$.given.emails', 'dataService:filter', { predicate: '.com' }]
      },
      select: 'filtered'
    })
    
    assert(Array.isArray(result), 'Should return an array')
    assert(result.length === 1, 'Should filter to 1 item containing ".com"')
  } catch (error) {
    console.error('Test 3 failed:', error.message)
    process.exit(1)
  }
  
  // Test 4: Service chains
  console.log('\nTest 4: Service chains with @ symbol')
  try {
    const emailService = {
      async extract({ text }) {
        // Simple email extraction
        const match = text.match(/[\w.-]+@[\w.-]+\.\w+/)
        return match ? match[0] : null
      }
    }
    
    const result = await query({
      given: { 
        rawText: 'Contact us at John.Doe@EXAMPLE.COM for more info' 
      },
      services: { emailService, dataService },
      query: {
        processedEmail: [
          ['emailService', 'extract', { text: '$.given.rawText' }],
          ['dataService', 'normalize', { email: '@' }]
        ]
      },
      select: 'processedEmail'
    })
    
    assert(result === 'john.doe@example.com', 'Should extract and normalize email')
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