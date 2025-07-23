import assert from 'node:assert'
import {describe, it} from 'node:test'
import query from '../query.js'
import util from '../services/util.js'

describe('Chain Sequential Execution Tests', () => {
  describe('Chain steps without path dependencies', () => {
    it('should execute chain steps in sequence even without @ or $ dependencies', async () => {
      const executionOrder = []

      const result = await query({
        given: {start: 1},
        settings: {debug: false},
        services: {
          tracker: {
            async step1({value}) {
              executionOrder.push('step1')
              return value + 1
            },
            async step2({value}) {
              executionOrder.push('step2')
              return value + 10
            },
            async step3({value}) {
              executionOrder.push('step3')
              return value + 100
            }
          }
        },
        queries: {
          result: [
            // Step 1: uses given data (has $ dependency)
            ['tracker:step1', {value: '$.given.start'}],
            // Step 2: uses static value (NO @ or $ dependency)
            ['tracker:step2', {value: 5}],
            // Step 3: uses @ dependency from previous step
            ['tracker:step3', {value: '@'}]
          ]
        }
      })

      // Verify execution order
      assert.deepStrictEqual(executionOrder, ['step1', 'step2', 'step3'])

      // Verify final result: start=1 -> step1=2 -> step2=15 -> step3=115
      assert.strictEqual(result.result, 115)
    })

    it('should handle mixed chain with path-dependent and path-independent steps', async () => {
      const executionOrder = []

      const result = await query({
        given: {base: 10},
        services: {
          calc: {
            async add({a, b}) {
              executionOrder.push(`add-${a}-${b}`)
              return a + b
            },
            async multiply({a, b}) {
              executionOrder.push(`multiply-${a}-${b}`)
              return a * b
            },
            async constant({value}) {
              executionOrder.push(`constant-${value}`)
              return value
            }
          }
        },
        queries: {
          result: [
            // Step 1: uses given data
            ['calc:add', {a: '$.given.base', b: 5}], // 10 + 5 = 15
            // Step 2: no path dependencies (static values)
            ['calc:multiply', {a: 2, b: 3}], // 2 * 3 = 6
            // Step 3: uses previous chain result
            ['calc:add', {a: '@', b: 1}], // 6 + 1 = 7
            // Step 4: uses constant (no dependencies)
            ['calc:constant', {value: 100}], // 100
            // Step 5: uses previous result
            ['calc:add', {a: '@', b: 0}] // 100 + 0 = 100
          ]
        }
      })

      // Verify execution order
      assert.deepStrictEqual(executionOrder, [
        'add-10-5', // Step 1: 15
        'multiply-2-3', // Step 2: 6
        'add-6-1', // Step 3: 7
        'constant-100', // Step 4: 100
        'add-100-0' // Step 5: 100
      ])

      // Verify final result
      assert.strictEqual(result.result, 100)
    })

    it('should handle multiple static steps in sequence', async () => {
      const executionOrder = []

      const result = await query({
        given: {ignored: 'not used'},
        services: {
          math: {
            async getValue({n}) {
              executionOrder.push(`getValue-${n}`)
              return n * 2
            },
            async process({data}) {
              executionOrder.push(`process-${data}`)
              return data + 1
            }
          }
        },
        queries: {
          result: [
            // All steps use static values, no path dependencies
            ['math:getValue', {n: 5}], // 10
            ['math:getValue', {n: 3}], // 6 (ignores previous @)
            ['math:process', {data: 100}], // 101 (ignores previous @)
            ['math:getValue', {n: 1}] // 2 (ignores previous @)
          ]
        }
      })

      // Verify execution order (all steps should execute)
      assert.deepStrictEqual(executionOrder, [
        'getValue-5', // Step 1: 10
        'getValue-3', // Step 2: 6
        'process-100', // Step 3: 101
        'getValue-1' // Step 4: 2
      ])

      // Final result should be from last step
      assert.strictEqual(result.result, 2)
    })
  })

  describe('Template and function parameter sequences', () => {
    it('should handle util.map with service function in chain', async () => {
      const result = await query({
        given: {numbers: [1, 2, 3]},
        services: {
          math: {
            async double({value}) {
              return value * 2
            }
          },
          util
        },
        queries: {
          result: [
            // Step 1: map with service function
            [
              'util:map',
              {
                on: '$.given.numbers',
                service: ['math:double', {value: '@'}]
              }
            ],
            // Step 2: use result in static operation
            ['util:length', {value: '@'}]
          ]
        }
      })

      // Should execute map then length
      assert.strictEqual(result.result, 3) // length of [2, 4, 6]
    })

    it('should handle template processing in chain', async () => {
      const result = await query({
        given: {
          items: [
            {id: 1, name: 'A'},
            {id: 2, name: 'B'}
          ]
        },
        services: {util},
        queries: {
          result: [
            // Step 1: map with template
            [
              'util:map',
              {
                on: '$.given.items',
                service: {itemId: '@.id', itemName: '@.name'}
              }
            ],
            // Step 2: use result in static operation
            ['util:length', {value: '@'}]
          ]
        }
      })

      // Should execute template map then length
      assert.strictEqual(result.result, 2) // length of transformed array
    })
  })

  describe('Error scenarios in sequential chains', () => {
    it('should fail at the correct step in sequence', async () => {
      const executionOrder = []

      await assert.rejects(
        query({
          given: {start: 1},
          services: {
            test: {
              async step1({value}) {
                executionOrder.push('step1')
                return value + 1
              },
              async step2({_value}) {
                executionOrder.push('step2')
                throw new Error('Step 2 failed')
              },
              async step3({value}) {
                executionOrder.push('step3')
                return value + 100
              }
            }
          },
          queries: {
            result: [
              ['test:step1', {value: '$.given.start'}],
              ['test:step2', {value: 5}], // This will fail
              ['test:step3', {value: '@'}] // This should never execute
            ]
          }
        }),
        /Step 2 failed/
      )

      // Verify only step1 and step2 executed (step3 should not execute after step2 fails)
      assert.deepStrictEqual(executionOrder, ['step1', 'step2'])
    })
  })
})
