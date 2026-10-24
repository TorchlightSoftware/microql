import assert from 'node:assert'
import {describe, it, beforeEach, afterEach} from 'node:test'
import query, {plan, defineService} from '../index.js'
import util from '../src/service/util.js'
import {ANSI_COLORS} from '../index.js'

// A key to util, as core hands it to the service.
const utilKey = (resource, {method = null, confined = false} = {}) => ({method, service: 'util', resource, confined})

// Makes one of util's service calls directly, as core does: through an instance.
const callUtil = async (resource, fields) => (await util.init({})).call({...utilKey(resource), fields})

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
    data: defineService({
      async '/isEngineer'(args) {
        return args.person.department === 'Engineering'
      },
      async '/formatName'(args) {
        return args.person.name.toUpperCase()
      },
      async '/getCategories'(args) {
        return args.product.categories
      },
      async '/calculateTotal'(args) {
        return args.items.reduce((sum, id) => {
          const product = args.products.find((p) => p.id === id)
          return sum + (product ? product.price : 0)
        }, 0)
      }
    })
  }

  describe('Direct Service Usage', () => {
    // How many of a call's runs were in flight at once, with the results in order.
    const inFlight = async (resource, fields) => {
      let running = 0
      let most = 0
      const service = async (item) => {
        most = Math.max(most, ++running)
        await new Promise(resolve => setTimeout(resolve, 5))
        running--
        return [item]
      }
      return {result: await callUtil(resource, {on: [1, 2, 3], service, ...fields}), most}
    }

    // [resource, fields, the most runs in flight at once, the result]
    const iterations = [
      ['/each', {}, 3, [[1], [2], [3]]],
      ['/each', {sequential: true}, 1, [[1], [2], [3]]],
      ['/flattenEach', {}, 3, [1, 2, 3]],
      ['/flattenEach', {sequential: true}, 1, [1, 2, 3]]
    ]

    for (const [resource, fields, most, result] of iterations) {
      it(`${resource} ${JSON.stringify(fields)} runs ${most} at once, keeping the items' order`, async () => {
        assert.deepEqual(await inFlight(resource, fields), {result, most})
      })
    }

    it('should map with function', async () => {
      const result = await callUtil('/each', {
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

    it('should flatten the lists a call returns for each item', async () => {
      const result = await callUtil('/flattenEach', {
        on: testData.products,
        service: async (product) => product.categories
      })
      assert.deepStrictEqual(result, ['tools', 'gadgets', 'electronics', 'gadgets', 'tools', 'hardware'])
    })

    it('should concat arrays', async () => {
      const result = await callUtil('/concat', {
        args: [['a', 'b'], ['c', 'd'], ['e']]
      })

      assert.deepStrictEqual(result, ['a', 'b', 'c', 'd', 'e'])
    })

    it('should handle when with boolean condition', async () => {
      const resultTrue = await callUtil('/when', {
        test: true,
        then: 'success',
        otherwise: 'failure'
      })

      const resultFalse = await callUtil('/when', {
        test: false,
        then: 'success',
        otherwise: 'failure'
      })

      assert.strictEqual(resultTrue, 'success')
      assert.strictEqual(resultFalse, 'failure')
    })

    it('should handle comparison functions', async () => {
      assert.strictEqual(await callUtil('/eq', {l: 5, r: 5}), true)
      assert.strictEqual(await callUtil('/eq', {l: 5, r: 3}), false)
      assert.strictEqual(await callUtil('/gt', {l: 10, r: 5}), true)
      assert.strictEqual(await callUtil('/lt', {l: 3, r: 8}), true)
    })

    it('should handle exists and length', async () => {
      assert.strictEqual(await callUtil('/exists', {value: 'hello'}), true)
      assert.strictEqual(await callUtil('/exists', {value: null}), false)
      assert.strictEqual(await callUtil('/length', {value: 'hello'}), 5)
      assert.strictEqual(await callUtil('/length', {value: [1, 2, 3]}), 3)
    })

    it('should pick fields from objects', async () => {
      const result = await callUtil('/pick', {
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

    it('should merge objects together', async () => {
      const result = await callUtil('/merge', {
        on: {
          name: 'Alice',
          age: 30,
          profile: {
            theme: 'dark'
          }
        },
        with: {
          age: 31,
          profile: {
            notifications: true
          }
        }
      })

      assert.deepStrictEqual(result, {
        name: 'Alice',
        age: 31,
        profile: {
          theme: 'dark',
          notifications: true
        }
      })
    })

    it('should not mutate original objects in merge', async () => {
      const original = {name: 'Alice', age: 30}
      const toMerge = {age: 31, city: 'NYC'}

      const result = await callUtil('/merge', {
        on: original,
        with: toMerge
      })

      // Result should have merged values
      assert.deepStrictEqual(result, {
        name: 'Alice',
        age: 31,
        city: 'NYC'
      })

      // Original objects should be unchanged
      assert.deepStrictEqual(original, {name: 'Alice', age: 30})
      assert.deepStrictEqual(toMerge, {age: 31, city: 'NYC'})
    })

    // [description, on, with, merged]: arrays are a set union by value, so
    // merging the same `with` again changes nothing
    const merges = [
      ['unions primitive arrays', {tags: ['a', 'b']}, {tags: ['b', 'c']}, {tags: ['a', 'b', 'c']}],
      ['unions records by value, not identity', {items: [{id: 1}]}, {items: [{id: 1}, {id: 2}]}, {items: [{id: 1}, {id: 2}]}],
      ['keeps duplicates already in on', {tags: ['a', 'a']}, {tags: ['a']}, {tags: ['a', 'a']}],
      ['adds an array on lacks', {}, {tags: ['a']}, {tags: ['a']}],
      ['merges arrays inside nested objects', {profile: {roles: ['admin']}}, {profile: {roles: ['editor']}}, {profile: {roles: ['admin', 'editor']}}],
      ['skips undefined in with', {name: 'Alice'}, {name: undefined}, {name: 'Alice'}],
      ['overwrites with null', {name: 'Alice'}, {name: null}, {name: null}],
      ['replaces a value of another kind', {tags: 'a', profile: ['x']}, {tags: ['b'], profile: {theme: 'dark'}}, {tags: ['b'], profile: {theme: 'dark'}}]
    ]

    for (const [description, on, withObj, merged] of merges) {
      it(`merge ${description}`, async () => {
        assert.deepStrictEqual(await callUtil('/merge', {on, with: withObj}), merged)
      })
    }

    it('merges idempotently', async () => {
      const on = {tags: ['a'], profile: {roles: [{id: 1}]}}
      const withObj = {tags: ['b'], profile: {roles: [{id: 2}]}}
      const once = await callUtil('/merge', {on, with: withObj})
      assert.deepStrictEqual(await callUtil('/merge', {on: once, with: withObj}), once)
    })

    it('does not share nested objects with its inputs', async () => {
      const on = {profile: {roles: ['admin']}}
      const result = await callUtil('/merge', {on, with: {profile: {theme: 'dark'}}})
      result.profile.roles.push('editor')
      assert.deepStrictEqual(on, {profile: {roles: ['admin']}})
    })
  })

  describe('Declarations', () => {
    it('lists every supported call, each with no method, and described', () => {
      const supported = util.supportedCalls()
      const resources = ['/concat', '/each', '/eq', '/exists', '/filter', '/flattenEach', '/format', '/gt', '/inspect', '/length', '/log', '/lt', '/merge', '/partitionErrors', '/pick', '/repeat', '/template', '/throw', '/try', '/waitFor', '/when']
      assert.deepStrictEqual(supported.map(({resource}) => resource).sort(), resources)
      for (const {resource, method, description} of supported) {
        assert.strictEqual(method, null, `${resource} takes no method`)
        assert.ok(description, `${resource} has a description`)
      }
    })

    it('declares each\'s target, and a call that receives one item of on', () => {
      const {input, output} = util.lookup(utilKey('/each'))
      assert.deepStrictEqual(input.on, ['array', {tags: ['target']}])
      assert.deepStrictEqual(input.service, ['call', {input: ['type', {fromList: 'on'}]}])
      assert.deepStrictEqual(output, ['array', ['type', {without: [{fromField: 'service'}, {fromZodly: {fromValue: 'skip'}}]}]])
    })

    it('refuses to look up a method', () => {
      assert.throws(() => util.lookup(utilKey('/each', {method: 'GET'})), {code: 'method-not-allowed', key: '[util]/each', method: 'GET', methods: []})
    })

    it('refuses to call with a method', async () => {
      const instance = await util.init({})
      await assert.rejects(instance.call({...utilKey('/each', {method: 'GET'}), fields: {}}), {code: 'method-not-allowed', key: '[util]/each', method: 'GET'})
    })

    it('refuses a confined key: util is no service of the caller\'s own custody', () => {
      assert.throws(() => util.lookup(utilKey('/each', {confined: true})), {code: 'confined-key', key: '[@util]/each'})
    })
  })

  describe('MicroQL Integration', () => {
    it('should handle util.map with template in MicroQL', async () => {
      const result = await query({
        given: {people: testData.people},
        phases: {
          summary: ['$given.people', '[util]/each', {
            service: {name: '@.name', info: '@.department'}
          }]
        },
        select: '$summary'
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
        phases: {
          formatted: ['$given.people', '[util]/each', {
            service: ['[data]/formatName', {person: '@'}]
          }]
        },
        select: '$formatted'
      })

      assert.deepStrictEqual(result, ['ALICE', 'BOB', 'CHARLIE', 'DIANA'])
    })

    it('should handle util.filter with fn', async () => {
      const result = await query({
        given: {people: testData.people},
        services: mockServices,
        phases: {
          engineers: ['$given.people', '[util]/filter', {
            service: ['[data]/isEngineer', {person: '@'}]
          }]
        },
        select: '$engineers'
      })

      assert.deepStrictEqual(
        result,
        testData.people.filter((p) => p.department === 'Engineering')
      )
    })

    it('should handle util.flattenEach', async () => {
      const result = await query({
        given: {products: testData.products},
        services: mockServices,
        phases: {
          allCategories: ['$given.products', '[util]/flattenEach', {
            service: ['[data]/getCategories', {product: '@'}]
          }]
        },
        select: '$allCategories'
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

    it('should handle util.when with a condition computed by another phase', async () => {
      const result = await query({
        given: {person: {name: 'Alice', age: 30}},
        services: {
          age: defineService({
            '/isAdult'({person}) {return person.age >= 18}
          })
        },
        phases: {
          adult: ['[age]/isAdult', {person: '$given.person'}],
          status: ['[util]/when', {
            test: '$adult',
            then: 'Adult',
            otherwise: 'Minor'
          }]
        },
        select: '$status'
      })

      assert.strictEqual(result, 'Adult')
    })

    it('should handle method syntax with util', async () => {
      const result = await query({
        given: {items: [{id: 1}, {id: 2}, {id: 3}]},
        phases: {
          processed: ['$given.items', '[util]/each', {
            service: {original: '@.id', processed: true}
          }]
        },
        select: '$processed'
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
        phases: {
          // Calculate total for each order
          orderTotals: ['$given.orders', '[util]/each', {
            service: ['[data]/calculateTotal', {
              items: '@.items',
              products: testData.products
            }]
          }],

          // Filter to orders over $30
          bigOrders: ['$orderTotals', '[util]/filter', {
            service: ['[util]/gt', {l: '@', r: 30}]
          }],

          // Count big orders
          bigOrderCount: ['[util]/length', {value: '$bigOrders'}]
        },
        select: '$bigOrderCount'
      })

      assert.strictEqual(result, 2) // Orders B456 and C789 are over $30
    })

    it('should handle util.merge with method syntax', async () => {
      const result = await query({
        given: {
          person: {name: 'Alice', age: 30}
        },
        phases: {
          updated: ['$given.person', '[util]/merge', {
            with: {age: 31, city: 'NYC'}
          }]
        },
        select: '$updated'
      })

      assert.deepStrictEqual(result, {
        name: 'Alice',
        age: 31,
        city: 'NYC'
      })
    })

    it('should handle util.merge with @ references in nested context', async () => {
      const result = await query({
        given: {
          items: [
            {id: 1, name: 'Widget'},
            {id: 2, name: 'Gadget'}
          ],
          category: 'tools'
        },
        phases: {
          enriched: ['$given.items', '[util]/each', {
            service: ['@', '[util]/merge', {
              with: {category: '$given.category'}
            }]
          }]
        },
        select: '$enriched'
      })

      assert.deepStrictEqual(result, [
        {id: 1, name: 'Widget', category: 'tools'},
        {id: 2, name: 'Gadget', category: 'tools'}
      ])
    })

    it('should handle util.merge with deep @ references (@@@)', async () => {
      const result = await query({
        given: {
          items: [
            {id: 1, text: 'urgent'},
            {id: 2, text: 'normal'}
          ]
        },
        phases: {
          enriched: ['$given.items', '[util]/each', {
            service: ['@', '[util]/merge', {
              with: {category: '@.text'}
            }]
          }]
        },
        select: '$enriched'
      })

      assert.deepStrictEqual(result, [
        {id: 1, text: 'urgent', category: 'urgent'},
        {id: 2, text: 'normal', category: 'normal'}
      ])
    })

    it('should handle util.merge in a chain', async () => {
      const result = await query({
        given: {
          base: {name: 'Alice', age: 30}
        },
        phases: {
          result: [
            ['$given.base', '[util]/merge', {with: {city: 'NYC'}}],
            ['[util]/merge', {on: '@', with: {role: 'Engineer'}}],
            ['[util]/pick', {on: '@', fields: ['name', 'city', 'role']}]
          ]
        },
        select: '$result'
      })

      assert.deepStrictEqual(result, {
        name: 'Alice',
        city: 'NYC',
        role: 'Engineer'
      })
    })
  })

  describe('catch and skip', () => {
    // Fails the items marked to fail; `same` hands back what it's given.
    const items = defineService({
      async '/process'({item}) {
        if (item.fail) throw new Error(`Failed ${item.id}`)
        return {id: item.id, processed: true}
      },
      async '/listOf'({item}) {
        if (item.fail) throw new Error(`Failed ${item.id}`)
        return [item.id, item.id + 10]
      },
      async '/isEven'({item}) {
        if (item.fail) throw new Error(`Failed ${item.id}`)
        return item.id % 2 === 0
      },
      async '/same'({on}) {
        return on
      }
    })
    const given = {items: [{id: 1}, {id: 2, fail: true}, {id: 4}]}
    const run = (phase) => query({given, services: {items}, phases: {result: phase}, select: '$result'})
    const keepError = ['[items]/same', {on: '@'}]

    // [description, phase, result]
    const cases = [
      ['each puts what catch returns in place of a failed item',
        ['$given.items', '[util]/each', {service: ['[items]/process', {item: '@'}], catch: ['[util]/template', {failed: '@err.message'}]}],
        [{id: 1, processed: true}, {failed: '[$result.@1a1 - [items]/process] Failed 2'}, {id: 4, processed: true}]],
      ['catch sees the failed item by the as: name',
        ['$given.items', '[util]/each', {as: 'item', service: ['[items]/process', {item: '@item'}], catch: ['[util]/template', {failed: '@item.id'}]}],
        [{id: 1, processed: true}, {failed: 2}, {id: 4, processed: true}]],
      ['skip leaves out the items that fit its schema',
        ['$given.items', '[util]/each', {service: ['[items]/process', {item: '@'}], catch: keepError, skip: ['error']}],
        [{id: 1, processed: true}, {id: 4, processed: true}]],
      ['skip takes any zodly schema',
        ['$given.items', '[util]/each', {service: ['[items]/process', {item: '@'}], catch: ['[util]/when', {test: false, otherwise: null}], skip: ['union', ['error'], ['null']]}],
        [{id: 1, processed: true}, {id: 4, processed: true}]],
      ['a failure ends its chain: the steps after it never see it',
        ['$given.items', '[util]/each', {
          as: 'item',
          service: [['[items]/process', {item: '@item'}], ['@', '[util]/merge', {with: {merged: true}}]],
          catch: keepError,
          skip: ['error']
        }],
        [{id: 1, processed: true, merged: true}, {id: 4, processed: true, merged: true}]],
      ['catch handles a failure from anywhere below it',
        ['$given.items', '[util]/each', {
          service: ['[util]/each', {on: ['@'], service: ['[items]/process', {item: '@'}]}],
          catch: ['[util]/template', {failed: true}]
        }],
        [[{id: 1, processed: true}], {failed: true}, [{id: 4, processed: true}]]],
      ['flattenEach flattens what catch returns',
        ['$given.items', '[util]/flattenEach', {service: ['[items]/listOf', {item: '@'}], catch: ['[util]/concat', {args: [[]]}]}],
        [1, 11, 4, 14]],
      ['filter takes what catch returns as the test',
        ['$given.items', '[util]/filter', {service: ['[items]/isEven', {item: '@'}], catch: ['[util]/exists', {value: null}]}],
        [{id: 4}]],
      ['try holds a single call, so a catch can handle its failure',
        ['[util]/try', {on: {id: 2, fail: true}, service: ['[items]/process', {item: '@'}], catch: ['[util]/template', {failed: true}]}],
        {failed: true}],
      ['try returns its call\'s result when it succeeds',
        ['[util]/try', {on: {id: 1}, service: ['[items]/process', {item: '@'}]}],
        {id: 1, processed: true}]
    ]

    for (const [description, phase, expected] of cases) {
      it(description, async () => {
        assert.deepStrictEqual(await run(phase), expected)
      })
    }

    it('catch receives the failure as error data, with the Query version and the call\'s form hash', async () => {
      const phase = ['$given.items', '[util]/each', {service: ['[items]/process', {item: '@'}], catch: keepError}]
      const planned = plan({given, services: {items}, phases: {result: phase}})
      const formHash = planned.calls.find(call => call.address === '$result.@1a1').formHash
      assert.deepStrictEqual(await run(phase), [
        {id: 1, processed: true},
        {'@type': 'Error', name: 'Error', message: '[$result.@1a1 - [items]/process] Failed 2', baseMessage: '[$result.@1a1 - [items]/process] Failed 2', address: '$result.@1a1', key: '[items]/process', queryHash: planned.queryHash, formHash, args: {item: {id: 2, fail: true}}},
        {id: 4, processed: true}
      ])
    })

    // [description, phase, the Run's error]
    const failures = [
      ['without a catch, a failed item fails the call holding it',
        ['$given.items', '[util]/each', {service: ['[items]/process', {item: '@'}]}],
        {address: '$result.@1a1', key: '[items]/process', message: '[$result.@1a1 - [items]/process] Failed 2'}],
      ['a catch doesn\'t handle the failure of the call it sits on',
        ['[util]/each', {on: 'not a list', service: ['[items]/process', {item: '@'}], catch: keepError}],
        {code: 'precheck-failed', validation: 'Service Defined Validation', address: '$result.@1', key: '[util]/each'}],
      ['throw fails with the error it is given, as it was raised',
        ['$given.items', '[util]/each', {service: ['[items]/process', {item: '@'}], catch: ['@err', '[util]/throw']}],
        {name: 'Error', message: '[$result.@1a1 - [items]/process] Failed 2'}],
      ['a catch that fails fails the call holding it',
        ['$given.items', '[util]/each', {service: ['[items]/process', {item: '@'}], catch: ['[util]/gt', {l: 'not a number', r: 1}]}],
        {code: 'precheck-failed', validation: 'Service Defined Validation', address: '$result.@1e1', key: '[util]/gt'}]
    ]

    for (const [description, phase, error] of failures) {
      it(description, () => assert.rejects(run(phase), error))
    }

    it('throw keeps the address and key of the call that first failed', async () => {
      await assert.rejects(run(['$given.items', '[util]/each', {service: ['[items]/process', {item: '@'}], catch: ['@err', '[util]/throw']}]),
        (error) => error.address === '$result.@1a1' && error.key === '[items]/process')
    })

    it('throw attaches a cause: here, the failure its catch received', async () => {
      await assert.rejects(
        run(['$given.items', '[util]/each', {service: ['[items]/process', {item: '@'}], catch: ['[util]/throw', {on: 'Processing stopped', cause: '@err'}]}]),
        (error) => {
          assert.strictEqual(error.message, '[$result.@1e1 - [util]/throw] Processing stopped')
          assert.strictEqual(error.cause.message, '[$result.@1a1 - [items]/process] Failed 2')
          assert.strictEqual(error.cause.address, '$result.@1a1')
          return true
        }
      )
    })

    it('throw fails with anything else as an error saying it', async () => {
      await assert.rejects(run(['[util]/throw', {on: {reason: 'nope'}}]), /\{reason: "nope"\}/)
    })
  })

  describe('partitionErrors', () => {
    const failure = {'@type': 'Error', name: 'Error', message: 'failed'}

    // [description, list, successes, failures]
    const cases = [
      ['splits a list into successes and error data', [{id: 1}, failure, null, {id: 3}], [{id: 1}, null, {id: 3}], [failure]],
      ['keeps every item a success when none failed', [{id: 1}], [{id: 1}], []],
      ['keeps every item a failure when all failed', [failure, failure], [], [failure, failure]]
    ]

    for (const [description, list, successes, failures] of cases) {
      it(description, async () => {
        assert.deepStrictEqual(await callUtil('/partitionErrors', {on: list}), {successes, failures})
      })
    }
  })

  describe('retired resources', () => {
    // [resource, what replaced it]
    const retired = [
      ['/print', /\[util\]\/inspect/],
      ['/recordFailure', /\[util\]\/log with to:/],
      ['/removeErrors', /skip: \['error'\]/],
      ['/removeNulls', /skip: \['null'\]/],
      ['/removeSuccesses', /partitionErrors/]
    ]

    for (const [resource, replacement] of retired) {
      it(`refuses ${resource}, naming its replacement`, () => {
        assert.throws(() => util.lookup(utilKey(resource)), {code: 'retired-key', retired: `[util]${resource}`, replacement})
      })
    }
  })

  describe('inspect and log', () => {
    let originalWrite
    let capturedOutput

    beforeEach(() => {
      // Capture text; the test runner's own frames are buffers and pass through
      capturedOutput = []
      originalWrite = process.stdout.write
      process.stdout.write = (data, ...rest) => {
        if (typeof data !== 'string') return originalWrite.call(process.stdout, data, ...rest)
        capturedOutput.push(data)
        return true
      }
    })

    afterEach(() => {
      process.stdout.write = originalWrite
    })

    it('inspect shows a value in colour and returns it', async () => {
      const result = await query({phases: {shown: ['[util]/inspect', {on: 'Hello World', color: 'blue'}]}, select: '$shown'})
      assert.strictEqual(result, 'Hello World')
      assert.deepStrictEqual(capturedOutput, [`${ANSI_COLORS.blue}Hello World${ANSI_COLORS.reset}\n`])
    })

    it('inspect formats with the Query\'s inspect settings', async () => {
      const users = [{id: 1, profile: {email: 'alice@example.com'}}, {id: 2}]
      const result = await query({
        given: {users},
        settings: {inspect: {depth: 1, maxArrayLength: 1}},
        phases: {shown: ['$given.users', '[util]/inspect']},
        select: '$shown'
      })
      assert.deepStrictEqual(result, users)
      assert.deepStrictEqual(capturedOutput, ['[{id: 1, profile: [Object]}, ... 1 more items]\n'])
    })

    it('a call\'s own settings override the Query\'s', async () => {
      await query({
        given: {message: 'This is a very long string that should be truncated'},
        phases: {shown: ['$given.message', '[util]/inspect', {settings: {inspect: {maxStringLength: 9}}}]}
      })
      assert.deepStrictEqual(capturedOutput, ['This is a... 42 more characters\n'])
    })

    it('log writes a value as text and returns it, so a chain carries on with it', async () => {
      const result = await query({phases: {logged: [['[util]/template', {n: 1}], ['@', '[util]/log'], ['@', '[util]/pick', {fields: ['n']}]]}, select: '$logged'})
      assert.deepStrictEqual(result, {n: 1})
      assert.deepStrictEqual(capturedOutput, ['{n: 1}\n'])
    })
  })

  describe('log to a destination', () => {
    const logFile = './test-failures/util-log/failures.log'
    afterEach(async () => {
      const fs = await import('fs-extra')
      await fs.default.remove('./test-failures/util-log')
    })

    it('appends each failure a catch logs to the file it names, and keeps the failure as data', async () => {
      const failing = defineService({
        async '/process'({item}) {
          if (item.fail) throw new Error(`Failed ${item.id}`)
          return item.id
        }
      })
      const result = await query({
        given: {items: [{id: 1, fail: true}, {id: 2}, {id: 3, fail: true}]},
        services: {failing},
        phases: {result: ['$given.items', '[util]/each', {service: ['[failing]/process', {item: '@'}], catch: ['@err', '[util]/log', {to: logFile}]}]},
        select: '$result'
      })
      assert.strictEqual(result[1], 2)
      assert.match(result[0].message, /Failed 1/)

      const fs = await import('fs-extra')
      const lines = (await fs.default.readFile(logFile, 'utf8')).trim().split('\n').filter(line => line.startsWith('Error'))
      assert.deepStrictEqual(lines.sort(), [
        'Error: [$result.@1a1 - [failing]/process] Failed 1',
        'Error: [$result.@1a1 - [failing]/process] Failed 3'
      ])
    })
  })
})
