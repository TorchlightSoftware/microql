import assert from 'node:assert'
import {describe, it, beforeEach, afterEach} from 'node:test'
import query from '../query.js'
import util from '../services/util.js'
import {ANSI_COLORS} from '../common.js'

describe('Util Service Tests', () => {
  // Test data
  const testData = {
    people: [
      {name: 'Alice', age: 30, department: 'Engineering'},
      {name: 'Bob', age: 25, department: 'Marketing'},
      {name: 'Charlie', age: 35, department: 'Engineering'},
      {name: 'Diana', age: 28, department: 'Sales'}
    ],
    products: [
      {id: 1, name: 'Widget', price: 10.99, categories: ['tools', 'gadgets']},
      {
        id: 2,
        name: 'Gadget',
        price: 25.5,
        categories: ['electronics', 'gadgets']
      },
      {id: 3, name: 'Tool', price: 15.0, categories: ['tools', 'hardware']}
    ],
    orders: [
      {orderId: 'A123', items: [1, 2]},
      {orderId: 'B456', items: [2, 3]},
      {orderId: 'C789', items: [1, 3]}
    ]
  }

  // Mock services
  const mockServices = {
    data: {
      async getAge(args) {
        return args.person.age
      },
      async isEngineer(args) {
        return args.person.department === 'Engineering'
      },
      async formatName(args) {
        return args.person.name.toUpperCase()
      },
      async getCategories(args) {
        return args.product.categories
      },
      async calculateTotal(args) {
        return args.items.reduce((sum, id) => {
          const product = args.products.find((p) => p.id === id)
          return sum + (product ? product.price : 0)
        }, 0)
      }
    },
    util
  }

  describe('Direct Service Usage', () => {
    it('should map with function', async () => {
      const result = await util.map({
        on: testData.people,
        service: async (person) => ({
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
        args: [['a', 'b'], ['c', 'd'], ['e']]
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
      assert.strictEqual(await util.eq({l: 5, r: 5}), true)
      assert.strictEqual(await util.eq({l: 5, r: 3}), false)
      assert.strictEqual(await util.gt({l: 10, r: 5}), true)
      assert.strictEqual(await util.lt({l: 3, r: 8}), true)
    })

    it('should handle exists and length', async () => {
      assert.strictEqual(await util.exists({value: 'hello'}), true)
      assert.strictEqual(await util.exists({value: null}), false)
      assert.strictEqual(await util.length({value: 'hello'}), 5)
      assert.strictEqual(await util.length({value: [1, 2, 3]}), 3)
    })

    it('should pick fields from objects', async () => {
      const result = await util.pick({
        on: {
          name: 'Alice',
          age: 30,
          email: 'alice@example.com',
          secret: 'hidden'
        },
        fields: ['name', 'email']
      })

      assert.deepStrictEqual(result, {
        name: 'Alice',
        email: 'alice@example.com'
      })
    })
  })

  describe('MicroQL Integration', () => {
    it('should handle util.map with template in MicroQL', async () => {
      const result = await query({
        given: {people: testData.people},
        services: {util},
        queries: {
          summary: [
            'util:map',
            {
              on: '$.given.people',
              service: {
                name: '@.name',
                info: '@.department'
              }
            }
          ]
        },
        select: 'summary'
      })

      assert.deepStrictEqual(result, [
        {name: 'Alice', info: 'Engineering'},
        {name: 'Bob', info: 'Marketing'},
        {name: 'Charlie', info: 'Engineering'},
        {name: 'Diana', info: 'Sales'}
      ])
    })

    it('should handle util.map with service function', async () => {
      const result = await query({
        given: {people: testData.people},
        services: mockServices,
        queries: {
          formatted: [
            'util:map',
            {
              on: '$.given.people',
              service: ['data:formatName', {person: '@'}]
            }
          ]
        },
        select: 'formatted'
      })

      assert.deepStrictEqual(result, ['ALICE', 'BOB', 'CHARLIE', 'DIANA'])
    })

    it('should handle util.filter with fn', async () => {
      const result = await query({
        given: {people: testData.people},
        services: mockServices,
        queries: {
          engineers: [
            'util:filter',
            {
              on: '$.given.people',
              service: ['data:isEngineer', {person: '@'}]
            }
          ]
        },
        select: 'engineers'
      })

      assert.deepStrictEqual(
        result,
        testData.people.filter((p) => p.department === 'Engineering')
      )
    })

    it('should handle util.flatMap', async () => {
      const result = await query({
        given: {products: testData.products},
        services: mockServices,
        queries: {
          allCategories: [
            'util:flatMap',
            {
              on: '$.given.products',
              service: ['data:getCategories', {product: '@'}]
            }
          ]
        },
        select: 'allCategories'
      })

      assert.deepStrictEqual(result, [
        'tools',
        'gadgets',
        'electronics',
        'gadgets',
        'tools',
        'hardware'
      ])
    })

    it('should handle util.when with service call condition', async () => {
      const result = await query({
        given: {person: {name: 'Alice', age: 30}},
        services: {
          util,
          age: {
            isAdult({person}) {return person.age >= 18}
          }
        },
        queries: {
          status: [
            'util:when',
            {
              test: ['age:isAdult', {person: '$.given.person'}],
              then: 'Adult',
              or: 'Minor'
            }
          ]
        },
        select: 'status'
      })

      assert.strictEqual(result, 'Adult')
    })

    it('should handle method syntax with util', async () => {
      const result = await query({
        given: {items: [{id: 1}, {id: 2}, {id: 3}]},
        services: {util},
        queries: {
          processed: [
            '$.given.items',
            'util:map',
            {
              service: {original: '@.id', processed: true}
            }
          ]
        },
        select: 'processed'
      })

      assert.deepStrictEqual(result, [
        {original: 1, processed: true},
        {original: 2, processed: true},
        {original: 3, processed: true}
      ])
    })

    it('should handle complex data processing pipeline', async () => {
      const result = await query({
        given: {
          orders: testData.orders,
          products: testData.products
        },
        services: mockServices,
        queries: {
          // Calculate total for each order
          orderTotals: [
            'util:map',
            {
              on: '$.given.orders',
              service: [
                'data:calculateTotal',
                {
                  items: '@.items',
                  products: testData.products
                }
              ]
            }
          ],

          // Filter to orders over $30
          bigOrders: [
            'util:filter',
            {
              on: '$.orderTotals',
              service: ['util:gt', {l: '@', r: 30}]
            }
          ],

          // Count big orders
          bigOrderCount: ['util:length', {value: '$.bigOrders'}]
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
      process.stdout.write = (data) => {
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
        services: {util},
        queries: {
          printed: [
            'util:print',
            {
              on: 'Hello World',
              color: 'blue',
              ts: false
            }
          ]
        },
        select: 'printed'
      })

      // Should return the printed value for chaining
      assert.strictEqual(result, 'Hello World')

      // Should have captured some output
      assert(capturedOutput.length > 0, 'Should have captured some output')

      // Find the output that contains the blue color
      const blueOutput = capturedOutput.find((output) =>
        output.includes(ANSI_COLORS.blue))
      assert(blueOutput, 'Should find output with blue color')

      // Should contain the message
      assert(blueOutput.includes('Hello World'), 'Should contain the message')
    })

    it('should print with query-level inspect settings', async () => {
      const testData = {
        users: [
          {
            id: 1,
            name: 'Alice',
            profile: {
              email: 'alice@example.com',
              preferences: {theme: 'dark', notifications: true}
            }
          },
          {
            id: 2,
            name: 'Bob',
            profile: {
              email: 'bob@example.com',
              preferences: {theme: 'light', notifications: false}
            }
          }
        ]
      }

      const result = await query({
        given: testData,
        services: {util},
        settings: {
          inspect: {
            depth: 1,
            maxArrayLength: 1,
            maxStringLength: 20
          }
        },
        queries: {
          printed: ['util:print', {on: '$.given.users', color: 'blue', ts: false}]
        },
        select: 'printed'
      })

      // Should return the printed value for chaining
      assert.deepStrictEqual(result, testData.users)

      // Should have captured some output
      assert(capturedOutput.length > 0, 'Should have captured some output')

      // Find the output that contains the blue color (from our print call)
      const blueOutput = capturedOutput.find((output) =>
        output.includes(ANSI_COLORS.blue))
      assert(blueOutput, 'Should find output with blue color')

      // Should contain ANSI blue color codes
      assert(blueOutput.includes(ANSI_COLORS.reset), 'Should contain reset color code')

      // Should show truncation due to maxArrayLength: 1
      assert(
        blueOutput.includes('... 1 more item') || blueOutput.includes('...'),
        'Should truncate array due to maxArrayLength setting'
      )
    })

    it('should work with method syntax and custom inspect settings', async () => {
      const testData = {
        message:
          'This is a very long string that should be truncated based on settings'
      }

      await query({
        given: testData,
        services: {util},
        queries: {
          result: [
            '$.given.message',
            'util:print',
            {
              settings: {inspect: {maxStringLength: 30}},
              color: 'green',
              ts: false
            }
          ]
        }
      })

      // Check output
      assert.strictEqual(capturedOutput.length, 1)
      const output = capturedOutput[0]

      // Should be a string (not inspected as object)
      assert(
        output.includes('This is a very long string'),
        'Should contain the message'
      )
      assert(output.includes(ANSI_COLORS.green), 'Should contain green color code')
    })
  })

  describe('Snapshot Function Tests', () => {
    const testSnapshotPath = './test-snapshot.json'

    afterEach(async () => {
      // Clean up test snapshot
      const fs = await import('fs-extra')
      try {
        await fs.default.remove(testSnapshotPath)
      } catch (_error) {
        // Ignore cleanup errors
      }
    })

    it('should create snapshot with results format', async () => {
      const testQuery = {
        given: {value: 42},
        services: {util},
        settings: {debug: false},
        queries: {
          doubled: ['util:when', {test: true, then: 84, or: 0}],
          snapshot: ['$.doubled', 'util:snapshot', {capture: '$', out: testSnapshotPath}]
        }
      }

      const _results = await query(testQuery)

      // Verify snapshot file was created
      const fs = await import('fs-extra')
      assert(await fs.default.pathExists(testSnapshotPath))

      // Verify snapshot content has results format
      const snapshot = JSON.parse(
        await fs.default.readFile(testSnapshotPath, 'utf8')
      )
      assert(snapshot.timestamp)
      assert(snapshot.results)
      assert.strictEqual(snapshot.results.given.value, 42)
      assert.strictEqual(snapshot.results.doubled, 84)
    })

    it('should save execution state correctly in snapshot', async () => {
      const testQuery = {
        given: {start: 1},
        services: {util},
        settings: {debug: false},
        queries: {
          step1: ['util:pick', {on: '$.given', fields: ['start']}],
          snapshot: [
            '$.step1',
            'util:snapshot',
            {capture: '$', out: testSnapshotPath}
          ]
        }
      }

      await query(testQuery)

      const fs = await import('fs-extra')
      const snapshot = JSON.parse(
        await fs.default.readFile(testSnapshotPath, 'utf8')
      )

      // Verify that completed queries are saved in results
      assert(snapshot.results.step1)
      assert.strictEqual(snapshot.results.step1.start, 1)
      assert(snapshot.results.given)
      assert.strictEqual(snapshot.results.given.start, 1)
    })

    it('should work with different capture options', async () => {
      const testQuery = {
        given: {data: [1, 2, 3]},
        services: {util},
        settings: {debug: false},
        queries: {
          result: [
            ['util:map', {on: '$.given.data', service: {doubled: '@'}}],
            ['util:snapshot', {on: '@', out: testSnapshotPath}],
            ['util:map', {on: '@', service: {tripled: '@.doubled'}}]
          ]
        }
      }

      await query(testQuery)

      const fs = await import('fs-extra')
      const snapshot = JSON.parse(
        await fs.default.readFile(testSnapshotPath, 'utf8')
      )

      // Verify current context is captured (not full $ state)
      assert(snapshot.results)
      assert(Array.isArray(snapshot.results))
      assert.strictEqual(snapshot.results[0].doubled, 1)
      assert.strictEqual(snapshot.results[1].doubled, 2)
      assert.strictEqual(snapshot.results[2].doubled, 3)
    })
  })
})
