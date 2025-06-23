import { describe, it } from 'mocha'
import assert from 'assert'
import query from '../query.js'

describe('MicroQL Comprehensive Tests', () => {
  
  describe('Basic Functionality', () => {
    
    it('should handle basic dependency chain', async () => {
      const result = await query({
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
      })
      
      assert.deepStrictEqual(result.profile, { id: 'user123', name: 'John', email: 'john@example.com' })
      assert.deepStrictEqual(result.auditLog, { logged: true, user: 'John' })
    })
    
    it('should auto-wrap service objects', async () => {
      const result = await query({
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
      })
      
      assert.strictEqual(result.total, 15)
      assert.strictEqual(result.avg, 3)
      assert.strictEqual(result.maximum, 5)
    })
    
    it('should handle method syntax with data transformation', async () => {
      const result = await query({
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
      })
      
      assert.deepStrictEqual(result.filtered, ['apple', 'banana'])
      assert.deepStrictEqual(result.uppercased, ['APPLE', 'BANANA'])
      assert.strictEqual(result.count, 2)
    })
    
    it('should handle service chains with @ symbol', async () => {
      const result = await query({
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
      })
      
      assert.strictEqual(result.result, 123)
    })
    
    it('should handle complex @ symbol field access', async () => {
      const result = await query({
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
      })
      
      assert.deepStrictEqual(result.parsed, { name: 'John', age: '30', city: 'NYC' })
      assert.strictEqual(result.greeting, 'Hello John from NYC!')
    })
    
    it('should execute tasks in parallel when possible', async () => {
      const start = Date.now()
      const result = await query({
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
      })
      
      const duration = Date.now() - start
      assert(duration < 30, `Should execute in parallel (took ${duration}ms)`)
      assert.strictEqual(result.task1, 'A')
      assert.strictEqual(result.task2, 'B')
      assert.strictEqual(result.task3, 'C')
    })
    
    it('should handle select functionality', async () => {
      const result = await query({
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
      })
      
      assert.deepStrictEqual(result, { sum: 15, product: 50 })
    })
    
    it('should handle alias jobs (JSONPath references)', async () => {
      const result = await query({
        given: { user: { profile: { name: 'Alice', settings: { theme: 'dark' } } } },
        services: {},
        query: {
          userName: '$.given.user.profile.name',
          userTheme: '$.given.user.profile.settings.theme',
          fullProfile: '$.given.user.profile'
        }
      })
      
      assert.strictEqual(result.userName, 'Alice')
      assert.strictEqual(result.userTheme, 'dark')
      assert.deepStrictEqual(result.fullProfile, { name: 'Alice', settings: { theme: 'dark' } })
    })
  })
  
  describe('Error Handling', () => {
    
    it('should throw error for missing service', async () => {
      await assert.rejects(
        query({
          given: { x: 1 },
          services: {},
          query: {
            result: ['nonexistent', 'action', { value: '$.given.x' }]
          }
        }),
        /Service 'nonexistent' not found/
      )
    })
    
    it('should throw error for missing service method', async () => {
      await assert.rejects(
        query({
          given: { x: 1 },
          services: {
            test: { validMethod() { return 'ok' } }
          },
          query: {
            result: ['test', 'invalidMethod', { value: '$.given.x' }]
          }
        }),
        /Service method 'invalidMethod' not found/
      )
    })
    
    it('should throw error for missing dependency', async () => {
      await assert.rejects(
        query({
          given: { start: 1 },
          services: {
            test: async (action, { value }) => value + 1
          },
          query: {
            result: ['test', 'increment', { value: '$.nonexistent' }]
          }
        }),
        /Task 'nonexistent' not found/
      )
    })
    
    it('should throw error for invalid service type', async () => {
      await assert.rejects(
        query({
          given: { data: [1, 2, 3] },
          services: {
            invalid: 'not a function or object'
          },
          query: {
            result: ['invalid', 'action', { value: '$.given.data' }]
          }
        }),
        /Invalid service 'invalid'/
      )
    })
  })
  
  describe('Performance', () => {
    
    it('should handle large parallel execution efficiently', async () => {
      const start = Date.now()
      const result = await query({
        given: { count: 50 },
        services: {
          worker: {
            async process({ id }) {
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
      })
      
      const duration = Date.now() - start
      assert(duration < 100, `Should complete quickly (took ${duration}ms)`)
      
      // Verify all tasks completed correctly
      for (let i = 0; i < 50; i++) {
        assert.strictEqual(result[`task${i}`], `processed-${i}`)
      }
    })
  })
})