import { describe, it } from 'mocha'
import assert from 'assert'
import query from '../query.js'
import util from '../util.js'

describe('Util Service Tests', () => {
  
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
  
  // Mock services
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
  
  describe('Direct Service Usage', () => {
    
    it('should map with function', async () => {
      const result = await util.map({
        on: testData.people,
        fn: async (person) => ({
          fullName: person.name,
          yearsOld: person.age,
          team: person.department
        })
      })
      
      assert.strictEqual(result.length, 4)
      assert.strictEqual(result[0].fullName, 'Alice')
      assert.strictEqual(result[0].yearsOld, 30)
      assert.strictEqual(result[0].team, 'Engineering')
    })
    
    it('should concat arrays', async () => {
      const result = await util.concat({
        args: [
          ['a', 'b'],
          ['c', 'd'],
          ['e']
        ]
      })
      
      assert.deepStrictEqual(result, ['a', 'b', 'c', 'd', 'e'])
    })
    
    it('should handle when with boolean condition', async () => {
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
      
      assert.strictEqual(resultTrue, 'success')
      assert.strictEqual(resultFalse, 'failure')
    })
    
    it('should handle comparison functions', async () => {
      assert.strictEqual(await util.eq({ l: 5, r: 5 }), true)
      assert.strictEqual(await util.eq({ l: 5, r: 3 }), false)
      assert.strictEqual(await util.gt({ l: 10, r: 5 }), true)
      assert.strictEqual(await util.lt({ l: 3, r: 8 }), true)
    })
    
    it('should handle exists and length', async () => {
      assert.strictEqual(await util.exists({ value: 'hello' }), true)
      assert.strictEqual(await util.exists({ value: null }), false)
      assert.strictEqual(await util.length({ value: 'hello' }), 5)
      assert.strictEqual(await util.length({ value: [1, 2, 3] }), 3)
    })
    
    it('should pick fields from objects', async () => {
      const result = await util.pick({
        on: { name: 'Alice', age: 30, email: 'alice@example.com', secret: 'hidden' },
        fields: ['name', 'email']
      })
      
      assert.deepStrictEqual(result, { name: 'Alice', email: 'alice@example.com' })
    })
  })
  
  describe('MicroQL Integration', () => {
    
    it('should handle util.map with template in MicroQL', async () => {
      const result = await query({
        given: { people: testData.people },
        services: { util },
        query: {
          summary: ['util', 'map', {
            on: '$.given.people',
            template: {
              name: '@.name',
              info: '@.department'
            }
          }]
        },
        select: 'summary'
      })
      
      assert.deepStrictEqual(result, [
        { name: 'Alice', info: 'Engineering' },
        { name: 'Bob', info: 'Marketing' },
        { name: 'Charlie', info: 'Engineering' },
        { name: 'Diana', info: 'Sales' }
      ])
    })
    
    it('should handle util.map with service function', async () => {
      const result = await query({
        given: { people: testData.people },
        services: mockServices,
        query: {
          formatted: ['util', 'map', {
            on: '$.given.people',
            fn: ['data', 'formatName', { person: '@' }]
          }]
        },
        select: 'formatted'
      })
      
      assert.deepStrictEqual(result, ['ALICE', 'BOB', 'CHARLIE', 'DIANA'])
    })
    
    it('should handle util.filter with predicate', async () => {
      const result = await query({
        given: { people: testData.people },
        services: mockServices,
        query: {
          engineers: ['util', 'filter', {
            on: '$.given.people',
            predicate: ['data', 'isEngineer', { person: '@' }]
          }]
        },
        select: 'engineers'
      })
      
      assert.deepStrictEqual(result, testData.people.filter(p => p.department === 'Engineering'))
    })
    
    it('should handle util.flatMap', async () => {
      const result = await query({
        given: { products: testData.products },
        services: mockServices,
        query: {
          allCategories: ['util', 'flatMap', {
            on: '$.given.products',
            fn: ['data', 'getCategories', { product: '@' }]
          }]
        },
        select: 'allCategories'
      })
      
      assert.deepStrictEqual(result, ['tools', 'gadgets', 'electronics', 'gadgets', 'tools', 'hardware'])
    })
    
    it('should handle util.when with service call condition', async () => {
      const result = await query({
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
      })
      
      assert.strictEqual(result, 'Adult')
    })
    
    it('should handle method syntax with util', async () => {
      const result = await query({
        given: { items: [{ id: 1 }, { id: 2 }, { id: 3 }] },
        services: { util },
        methods: ['util'],
        query: {
          processed: ['$.given.items', 'util:map', {
            template: { original: '@.id', processed: true }
          }]
        },
        select: 'processed'
      })
      
      assert.deepStrictEqual(result, [
        { original: 1, processed: true },
        { original: 2, processed: true },
        { original: 3, processed: true }
      ])
    })
    
    it('should handle complex data processing pipeline', async () => {
      const result = await query({
        given: { 
          orders: testData.orders,
          products: testData.products
        },
        services: mockServices,
        query: {
          // Calculate total for each order
          orderTotals: ['util', 'map', {
            on: '$.given.orders',
            fn: ['data', 'calculateTotal', { 
              items: '@.items',
              products: testData.products
            }]
          }],
          
          // Filter to orders over $30
          bigOrders: ['util', 'filter', {
            on: '$.orderTotals',
            predicate: ['util', 'gt', { l: '@', r: 30 }]
          }],
          
          // Count big orders
          bigOrderCount: ['util', 'length', { value: '$.bigOrders' }]
        },
        select: 'bigOrderCount'
      })
      
      assert.strictEqual(result, 2) // Orders B456 and C789 are over $30
    })
  })

  describe('Print Function Tests', () => {
    let originalWrite
    let capturedOutput

    beforeEach(() => {
      // Capture stdout.write calls
      capturedOutput = []
      originalWrite = process.stdout.write
      process.stdout.write = function(data) {
        capturedOutput.push(data)
        return true
      }
    })

    afterEach(() => {
      // Restore original stdout.write
      process.stdout.write = originalWrite
    })

    it('should print basic values', async () => {
      const result = await query({
        services: { util },
        query: {
          printed: ['util', 'print', { 
            on: 'Hello World', 
            color: 'blue',
            ts: false
          }]
        },
        select: 'printed'
      })

      // Should return the printed value for chaining
      assert.strictEqual(result, 'Hello World')
      
      // Should have captured some output  
      assert(capturedOutput.length > 0, 'Should have captured some output')
      
      // Find the output that contains the blue color
      const blueOutput = capturedOutput.find(output => output.includes('\x1b[34m'))
      assert(blueOutput, 'Should find output with blue color')
      
      // Should contain the message
      assert(blueOutput.includes('Hello World'), 'Should contain the message')
    })

    it.skip('should print with query-level inspect settings', async () => {
      const testData = {
        users: [
          { id: 1, name: 'Alice', profile: { email: 'alice@example.com', preferences: { theme: 'dark', notifications: true } } },
          { id: 2, name: 'Bob', profile: { email: 'bob@example.com', preferences: { theme: 'light', notifications: false } } }
        ]
      }

      const result = await query({
        given: testData,
        services: { util },
        settings: {
          inspect: {
            depth: 1,
            maxArrayLength: 1,
            maxStringLength: 20
          }
        },
        query: {
          printed: ['util', 'print', { 
            value: '$.given.users', 
            color: 'blue',
            ts: false
          }]
        },
        select: 'printed'
      })


      // Should return the printed value for chaining
      assert.deepStrictEqual(result, testData.users)
      
      // Should have captured some output  
      assert(capturedOutput.length > 0, 'Should have captured some output')
      
      // Find the output that contains the blue color (from our print call)
      const blueOutput = capturedOutput.find(output => output.includes('\\x1b[34m'))
      assert(blueOutput, 'Should find output with blue color')
      
      // Should contain ANSI blue color codes
      // Already checked that blueOutput contains blue color
      assert(blueOutput.includes('\x1b[0m'), 'Should contain reset color code')
      
      
      // Should show truncation due to maxArrayLength: 1
      assert(blueOutput.includes('... 1 more item'), 'Should truncate array due to maxArrayLength setting')
    })

    it('should work with method syntax and custom inspect settings', async () => {
      const testData = { message: 'This is a very long string that should be truncated based on settings' }

      await query({
        given: testData,
        services: { util },
        methods: ['util'],
        query: {
          result: ['$.given.message', 'util:print', { 
            settings: { inspect: { maxStringLength: 30 } },
            color: 'green',
            ts: false
          }]
        }
      })

      // Check output
      assert.strictEqual(capturedOutput.length, 1)
      const output = capturedOutput[0]
      
      // Should be a string (not inspected as object)
      assert(output.includes('This is a very long string'), 'Should contain the message')
      assert(output.includes('\x1b[32m'), 'Should contain green color code')
    })
  })
})