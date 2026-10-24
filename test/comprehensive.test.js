import assert from 'node:assert'
import {describe, it} from 'node:test'
import query from '../index.js'
import {servicesFromTables} from './test-services.js'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// Counts how many calls are in flight at once: parallelism measured without a
// clock, so a loaded machine can't fail it.
const overlapCounter = () => {
  const counter = {active: 0, max: 0}
  counter.during = async (work) => {
    counter.max = Math.max(counter.max, ++counter.active)
    try {
      return await work()
    } finally {
      counter.active--
    }
  }
  return counter
}

describe('MicroQL Comprehensive Tests', () => {
  describe('Basic Functionality', () => {
    it('should handle basic dependency chain', async () => {
      const result = await query({
        given: {userId: 'user123'},
        services: servicesFromTables({
          users: {
            async '/getProfile'({id}) {
              return {id, name: 'John', email: 'john@example.com'}
            }
          },
          audit: {
            async '/log'({user}) {
              return {logged: true, user: user.name}
            }
          }
        }),
        phases: {
          profile: ['[users]/getProfile', {id: '$given.userId'}],
          auditLog: ['[audit]/log', {user: '$profile'}]
        }
      })

      assert.deepStrictEqual(result.profile, {
        id: 'user123',
        name: 'John',
        email: 'john@example.com'
      })
      assert.deepStrictEqual(result.auditLog, {logged: true, user: 'John'})
    })

    it('should answer several resources of one service', async () => {
      const result = await query({
        given: {numbers: [1, 2, 3, 4, 5]},
        services: servicesFromTables({
          math: {
            async '/sum'({values}) {
              return values.reduce((a, b) => a + b, 0)
            },
            async '/average'({values}) {
              return values.reduce((a, b) => a + b, 0) / values.length
            },
            async '/max'({values}) {
              return Math.max(...values)
            }
          }
        }),
        phases: {
          total: ['[math]/sum', {values: '$given.numbers'}],
          avg: ['[math]/average', {values: '$given.numbers'}],
          maximum: ['[math]/max', {values: '$given.numbers'}]
        }
      })

      assert.strictEqual(result.total, 15)
      assert.strictEqual(result.avg, 3)
      assert.strictEqual(result.maximum, 5)
    })

    it('should handle method syntax with data transformation', async () => {
      // method syntax fills the field tagged target
      const onTarget = {on: ['any', 'optional', {tags: ['target']}]}
      const services = servicesFromTables({
        transform: {
          '/filter': {input: {...onTarget, fn: ['string']}, call: async ({on, fn}) => on.filter((item) => item.includes(fn))},
          '/upper': {input: onTarget, call: async ({on}) => on.map((item) => item.toUpperCase())},
          '/count': {input: onTarget, call: async ({on}) => on.length}
        }
      })

      const result = await query({
        given: {items: ['apple', 'banana', 'cherry']},
        services,
        phases: {
          filtered: ['$given.items', '[transform]/filter', {fn: 'a'}],
          uppercased: ['$filtered', '[transform]/upper', {}],
          count: ['$uppercased', '[transform]/count', {}]
        }
      })

      assert.deepStrictEqual(result.filtered, ['apple', 'banana'])
      assert.deepStrictEqual(result.uppercased, ['APPLE', 'BANANA'])
      assert.strictEqual(result.count, 2)
    })

    it('should handle service chains with @ symbol', async () => {
      const result = await query({
        given: {text: 'Hello World 123'},
        services: servicesFromTables({
          text: {
            async '/extractNumbers'({input}) {
              return input.match(/\d+/g) || []
            },
            async '/sum'({numbers}) {
              return numbers.map(Number).reduce((a, b) => a + b, 0)
            }
          }
        }),
        phases: {
          result: [
            ['[text]/extractNumbers', {input: '$given.text'}],
            ['[text]/sum', {numbers: '@'}]
          ]
        }
      })

      assert.strictEqual(result.result, 123)
    })

    it('should handle complex @ symbol field access', async () => {
      const result = await query({
        given: {userData: 'name:John,age:30,city:NYC'},
        services: servicesFromTables({
          parser: {
            async '/parseKeyValue'({data}) {
              const pairs = data.split(',')
              const result = {}
              pairs.forEach((pair) => {
                const [key, value] = pair.split(':')
                result[key] = value
              })
              return result
            },
            async '/formatGreeting'({name, city}) {
              return `Hello ${name} from ${city}!`
            }
          }
        }),
        phases: {
          parsed: ['[parser]/parseKeyValue', {data: '$given.userData'}],
          greeting: [
            '[parser]/formatGreeting',
            {
              name: '$parsed.name',
              city: '$parsed.city'
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
      const overlap = overlapCounter()
      const result = await query({
        given: {delay: 10},
        services: servicesFromTables({
          async: {
            async '/delay'({ms, value}) {
              return overlap.during(() => sleep(ms).then(() => value))
            }
          }
        }),
        phases: {
          query1: ['[async]/delay', {ms: '$given.delay', value: 'A'}],
          query2: ['[async]/delay', {ms: '$given.delay', value: 'B'}],
          query3: ['[async]/delay', {ms: '$given.delay', value: 'C'}]
        }
      })

      assert.strictEqual(overlap.max, 3, 'independent phases run at once')
      assert.strictEqual(result.query1, 'A')
      assert.strictEqual(result.query2, 'B')
      assert.strictEqual(result.query3, 'C')
    })

    it('should handle select functionality', async () => {
      const result = await query({
        given: {x: 5, y: 10},
        services: servicesFromTables({
          calc: {
            async '/add'({a, b}) {
              return a + b
            },
            async '/multiply'({a, b}) {
              return a * b
            }
          }
        }),
        phases: {
          sum: ['[calc]/add', {a: '$given.x', b: '$given.y'}],
          product: ['[calc]/multiply', {a: '$given.x', b: '$given.y'}],
          unused: ['[calc]/add', {a: 1, b: 2}]
        },
        select: ['$sum', '$product']
      })

      assert.deepStrictEqual(result, {sum: 15, product: 50})
    })
  })

  describe('Error Handling', () => {
    it('should throw error for missing service', async () => {
      await assert.rejects(
        query({
          given: {x: 1},
          services: servicesFromTables({}),
          phases: {
            result: ['[nonexistent]/action', {value: '$given.x'}]
          }
        }),
        {code: 'unknown-service', service: 'nonexistent', address: '$result.@1'}
      )
    })

    it('should throw error for missing service method', async () => {
      await assert.rejects(
        query({
          given: {x: 1},
          services: servicesFromTables({
            test: {
              validMethod() {
                return 'ok'
              }
            }
          }),
          phases: {
            result: ['[test]/invalidMethod', {value: '$given.x'}]
          }
        }),
        {code: 'unknown-resource', key: '[test]/invalidMethod', address: '$result.@1'}
      )
    })

    it('should throw error for an unknown phase reference', async () => {
      await assert.rejects(
        query({
          given: {start: 1},
          services: servicesFromTables({
            test: {
              async '/increment'({value}) {
                return value + 1
              }
            }
          }),
          phases: {
            result: ['[test]/increment', {value: '$nonexistent'}]
          }
        }),
        {code: 'unknown-reference', reference: '$nonexistent', address: '$result.@1'}
      )
    })

    it('should throw error for invalid service type', async () => {
      await assert.rejects(
        query({
          given: {data: [1, 2, 3]},
          services: {
            invalid: 'not a function or object'
          },
          phases: {
            result: ['[invalid]/action', {value: '$given.data'}]
          }
        }),
        {code: 'not-a-service', service: 'invalid', address: '$result.@1'}
      )
    })
  })

  describe('Performance', () => {
    it('should handle large parallel execution efficiently', async () => {
      const overlap = overlapCounter()
      const result = await query({
        given: {count: 50},
        services: servicesFromTables({
          worker: {
            async '/process'({id}) {
              return overlap.during(() => sleep(Math.random() * 5).then(() => `processed-${id}`))
            }
          }
        }),
        phases: Object.fromEntries(
          Array.from({length: 50}, (_, i) => [
            `query${i}`,
            ['[worker]/process', {id: i}]
          ])
        )
      })

      assert.strictEqual(overlap.max, 50, 'all 50 independent phases run at once')

      // Verify all queries completed correctly
      for (let i = 0; i < 50; i++) {
        assert.strictEqual(result[`query${i}`], `processed-${i}`)
      }
    })
  })

  describe('Array Literal Arguments', () => {
    it('should pass array literals as static arguments to services', async () => {
      const result = await query({
        services: servicesFromTables({
          arrayProcessor: {
            async '/sum'({numbers}) {
              return numbers.reduce((a, b) => a + b, 0)
            },
            async '/concatenate'({strings}) {
              return strings.join(' ')
            },
            async '/count'({items}) {
              return items.length
            }
          }
        }),
        phases: {
          numberSum: ['[arrayProcessor]/sum', {numbers: [1, 2, 3, 4, 5]}],
          textJoin: [
            '[arrayProcessor]/concatenate',
            {strings: ['hello', 'world', 'test']}
          ],
          itemCount: [
            '[arrayProcessor]/count',
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
        services: servicesFromTables({
          calculator: {
            async '/multiplyAndSum'({numbers, factor}) {
              return numbers.reduce((a, b) => a + b, 0) * factor
            }
          }
        }),
        phases: {
          result: [
            '[calculator]/multiplyAndSum',
            {
              numbers: [10, 20, 30],
              factor: '$given.multiplier'
            }
          ]
        }
      })

      assert.strictEqual(result.result, 120) // (10+20+30) * 2 = 120
    })

    it('should handle nested arrays and objects in arguments', async () => {
      const result = await query({
        services: servicesFromTables({
          dataProcessor: {
            async '/processNestedData'({config}) {
              const {items, settings} = config
              return {
                processedCount: items.length,
                maxDepth: settings.depth,
                categories: items.map((item) => item.category)
              }
            }
          }
        }),
        phases: {
          processed: [
            '[dataProcessor]/processNestedData',
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
        services: servicesFromTables({
          arrayOps: {
            async '/merge'({on, additional}) {
              return [...on, ...additional]
            },
            async '/transform'({on, operations}) {
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
        }),
        phases: {
          merged: [
            '[arrayOps]/merge',
            {
              on: '$given.baseNumbers',
              additional: [4, 5, 6]
            }
          ],
          transformed: [
            '[arrayOps]/transform',
            {
              on: '$merged',
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
