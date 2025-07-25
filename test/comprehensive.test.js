import assert from 'node:assert'
import {describe, it} from 'node:test'
import query from '../query.js'

describe('MicroQL Comprehensive Tests', () => {
  describe('Basic Functionality', () => {
    it('should handle basic dependency chain', async () => {
      const result = await query({
        given: {userId: 'user123'},
        services: {
          users: {
            async getProfile({id}) {
              return {id, name: 'John', email: 'john@example.com'}
            }
          },
          audit: {
            async log({user}) {
              return {logged: true, user: user.name}
            }
          }
        },
        queries: {
          profile: ['users:getProfile', {id: '$.given.userId'}],
          auditLog: ['audit:log', {user: '$.profile'}]
        }
      })

      assert.deepStrictEqual(result.profile, {
        id: 'user123',
        name: 'John',
        email: 'john@example.com'
      })
      assert.deepStrictEqual(result.auditLog, {logged: true, user: 'John'})
    })

    it('should auto-wrap service objects', async () => {
      const result = await query({
        given: {numbers: [1, 2, 3, 4, 5]},
        services: {
          math: {
            async sum({values}) {
              return values.reduce((a, b) => a + b, 0)
            },
            async average({values}) {
              return values.reduce((a, b) => a + b, 0) / values.length
            },
            async max({values}) {
              return Math.max(...values)
            }
          }
        },
        queries: {
          total: ['math:sum', {values: '$.given.numbers'}],
          avg: ['math:average', {values: '$.given.numbers'}],
          maximum: ['math:max', {values: '$.given.numbers'}]
        }
      })

      assert.strictEqual(result.total, 15)
      assert.strictEqual(result.avg, 3)
      assert.strictEqual(result.maximum, 5)
    })

    it('should handle method syntax with data transformation', async () => {
      const services = {
        transform: {
          async filter({on, fn}) {
            return on.filter((item) => item.includes(fn))
          },
          async upper({on}) {
            return on.map((item) => item.toUpperCase())
          },
          async count({on}) {
            return on.length
          }
        }
      }

      // Add argOrder metadata for method syntax
      services.transform.filter._argtypes = {on: {argOrder: 0}}
      services.transform.upper._argtypes = {on: {argOrder: 0}}
      services.transform.count._argtypes = {on: {argOrder: 0}}

      const result = await query({
        given: {items: ['apple', 'banana', 'cherry']},
        services,
        queries: {
          filtered: ['$.given.items', 'transform:filter', {fn: 'a'}],
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
        given: {text: 'Hello World 123'},
        services: {
          text: {
            async extractNumbers({input}) {
              return input.match(/\d+/g) || []
            },
            async sum({numbers}) {
              return numbers.map(Number).reduce((a, b) => a + b, 0)
            }
          }
        },
        queries: {
          result: [
            ['text:extractNumbers', {input: '$.given.text'}],
            ['text:sum', {numbers: '@'}]
          ]
        }
      })

      assert.strictEqual(result.result, 123)
    })

    it('should handle complex @ symbol field access', async () => {
      const result = await query({
        given: {userData: 'name:John,age:30,city:NYC'},
        services: {
          parser: {
            async parseKeyValue({data}) {
              const pairs = data.split(',')
              const result = {}
              pairs.forEach((pair) => {
                const [key, value] = pair.split(':')
                result[key] = value
              })
              return result
            },
            async formatGreeting({name, city}) {
              return `Hello ${name} from ${city}!`
            }
          }
        },
        queries: {
          parsed: ['parser:parseKeyValue', {data: '$.given.userData'}],
          greeting: [
            'parser:formatGreeting',
            {
              name: '$.parsed.name',
              city: '$.parsed.city'
            }
          ]
        }
      })

      assert.deepStrictEqual(result.parsed, {
        name: 'John',
        age: '30',
        city: 'NYC'
      })
      assert.strictEqual(result.greeting, 'Hello John from NYC!')
    })

    it('should execute queries in parallel when possible', async () => {
      const start = Date.now()
      const result = await query({
        given: {delay: 10},
        services: {
          async: {
            async delay({ms, value}) {
              await new Promise((resolve) => setTimeout(resolve, ms))
              return value
            }
          }
        },
        queries: {
          query1: ['async:delay', {ms: '$.given.delay', value: 'A'}],
          query2: ['async:delay', {ms: '$.given.delay', value: 'B'}],
          query3: ['async:delay', {ms: '$.given.delay', value: 'C'}]
        }
      })

      const duration = Date.now() - start
      assert(duration < 30, `Should execute in parallel (took ${duration}ms, expected <30ms)`)
      assert.strictEqual(result.query1, 'A')
      assert.strictEqual(result.query2, 'B')
      assert.strictEqual(result.query3, 'C')
    })

    it('should handle select functionality', async () => {
      const result = await query({
        given: {x: 5, y: 10},
        services: {
          calc: {
            async add({a, b}) {
              return a + b
            },
            async multiply({a, b}) {
              return a * b
            }
          }
        },
        queries: {
          sum: ['calc:add', {a: '$.given.x', b: '$.given.y'}],
          product: ['calc:multiply', {a: '$.given.x', b: '$.given.y'}],
          unused: ['calc:add', {a: 1, b: 2}]
        },
        select: ['sum', 'product']
      })

      assert.deepStrictEqual(result, {sum: 15, product: 50})
    })
  })

  describe('Error Handling', () => {
    it('should throw error for missing service', async () => {
      await assert.rejects(
        query({
          given: {x: 1},
          services: {},
          queries: {
            result: ['nonexistent:action', {value: '$.given.x'}]
          }
        }),
        /Service 'nonexistent' not found/
      )
    })

    it('should throw error for missing service method', async () => {
      await assert.rejects(
        query({
          given: {x: 1},
          services: {
            test: {
              validMethod() {
                return 'ok'
              }
            }
          },
          queries: {
            result: ['test:invalidMethod', {value: '$.given.x'}]
          }
        }),
        /Method 'invalidMethod' not found on service 'test'/
      )
    })

    it('should throw error for missing dependency', async () => {
      await assert.rejects(
        query({
          given: {start: 1},
          services: {
            test: {
              async increment({value}) {
                return value + 1
              }
            }
          },
          queries: {
            result: ['test:increment', {value: '$.nonexistent'}]
          }
        }),
        /Circular dependency detected at compile time: result/
      )
    })

    it('should throw error for invalid service type', async () => {
      await assert.rejects(
        query({
          given: {data: [1, 2, 3]},
          services: {
            invalid: 'not a function or object'
          },
          queries: {
            result: ['invalid:action', {value: '$.given.data'}]
          }
        }),
        /Service 'invalid' must be an object with methods in the form: async \(args\) => result/
      )
    })
  })

  describe('Performance', () => {
    it('should handle large parallel execution efficiently', async () => {
      const start = Date.now()
      const result = await query({
        given: {count: 50},
        services: {
          worker: {
            async process({id}) {
              await new Promise((resolve) =>
                setTimeout(resolve, Math.random() * 5))
              return `processed-${id}`
            }
          }
        },
        queries: Object.fromEntries(
          Array.from({length: 50}, (_, i) => [
            `query${i}`,
            ['worker:process', {id: i}]
          ])
        )
      })

      const duration = Date.now() - start
      assert(duration < 40, `Should complete quickly (took ${duration}ms, expected <40ms)`)

      // Verify all queries completed correctly
      for (let i = 0; i < 50; i++) {
        assert.strictEqual(result[`query${i}`], `processed-${i}`)
      }
    })
  })

  describe('Array Literal Arguments', () => {
    it('should pass array literals as static arguments to services', async () => {
      const result = await query({
        services: {
          arrayProcessor: {
            async sum({numbers}) {
              return numbers.reduce((a, b) => a + b, 0)
            },
            async concatenate({strings}) {
              return strings.join(' ')
            },
            async count({items}) {
              return items.length
            }
          }
        },
        queries: {
          numberSum: ['arrayProcessor:sum', {numbers: [1, 2, 3, 4, 5]}],
          textJoin: [
            'arrayProcessor:concatenate',
            {strings: ['hello', 'world', 'test']}
          ],
          itemCount: [
            'arrayProcessor:count',
            {items: ['a', 'b', 'c', 'd']}
          ]
        }
      })

      assert.strictEqual(result.numberSum, 15)
      assert.strictEqual(result.textJoin, 'hello world test')
      assert.strictEqual(result.itemCount, 4)
    })

    it('should handle mixed array and scalar arguments', async () => {
      const result = await query({
        given: {multiplier: 2},
        services: {
          calculator: {
            async multiplyAndSum({numbers, factor}) {
              return numbers.reduce((a, b) => a + b, 0) * factor
            }
          }
        },
        queries: {
          result: [
            'calculator:multiplyAndSum',
            {
              numbers: [10, 20, 30],
              factor: '$.given.multiplier'
            }
          ]
        }
      })

      assert.strictEqual(result.result, 120) // (10+20+30) * 2 = 120
    })

    it('should handle nested arrays and objects in arguments', async () => {
      const result = await query({
        services: {
          dataProcessor: {
            async processNestedData({config}) {
              const {items, settings} = config
              return {
                processedCount: items.length,
                maxDepth: settings.depth,
                categories: items.map((item) => item.category)
              }
            }
          }
        },
        queries: {
          processed: [
            'dataProcessor:processNestedData',
            {
              config: {
                items: [
                  {id: 1, category: 'A'},
                  {id: 2, category: 'B'},
                  {id: 3, category: 'A'}
                ],
                settings: {
                  depth: 2,
                  mode: 'strict'
                }
              }
            }
          ]
        }
      })

      assert.deepStrictEqual(result.processed, {
        processedCount: 3,
        maxDepth: 2,
        categories: ['A', 'B', 'A']
      })
    })

    it('should work with method syntax and array literals', async () => {
      const result = await query({
        given: {baseNumbers: [1, 2, 3]},
        services: {
          arrayOps: {
            async merge({on, additional}) {
              return [...on, ...additional]
            },
            async transform({on, operations}) {
              return on.map((num) => {
                let result = num
                operations.forEach((op) => {
                  if (op === 'double') result *= 2
                  if (op === 'add10') result += 10
                })
                return result
              })
            }
          }
        },
        queries: {
          merged: [
            'arrayOps:merge',
            {
              on: '$.given.baseNumbers',
              additional: [4, 5, 6]
            }
          ],
          transformed: [
            'arrayOps:transform',
            {
              on: '$.merged',
              operations: ['double', 'add10']
            }
          ]
        }
      })

      assert.deepStrictEqual(result.merged, [1, 2, 3, 4, 5, 6])
      assert.deepStrictEqual(result.transformed, [12, 14, 16, 18, 20, 22]) // (n*2)+10 for each
    })
  })
})
