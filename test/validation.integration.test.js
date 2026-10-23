/**
 * Integration Tests for Validation System
 * Tests validation through the query system with services
 */

import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import {z} from 'zod'
import query, {defineService} from '../index.js'

// A service with one service call, '/process', with an optional declaration.
const processor = (call, declaration = {}) => defineService({'/process': {...declaration, call}})

describe('Validation Integration Tests', () => {
  // Reusable service calls
  const serviceCalls = {
    echo: async (args) => args.value,
    double: async (args) => args.value * 2,
    divide: async (args) => args.numerator / args.denominator,
    createUser: async (args) => ({id: 123, ...args.userData}),
    updateTheme: async (args) => ({theme: args.theme, updated: true}),
    validateUsername: async (args) => `Valid: ${args.username}`,
    createProfile: async (args) => ({name: args.name, bio: args.bio || 'No bio'}),
    extract: async (args) => args.url,
    scrape: async (args) => ({url: args.url, queries: args.queries || {}, validate: args.validate || null})
  }

  // Runs one call to the service's '/process', returning its result or
  // expecting it to fail.
  async function runValidationTest(service, input, expectedError = null) {
    const config = {
      services: {testService: service},
      phases: {result: ['[testService]/process', input]}
    }

    if (expectedError) {
      await assert.rejects(query(config), expectedError)
    } else {
      return (await query(config)).result
    }
  }

  describe('Service and User Level Validation', () => {
    // Test cases for service validation
    const serviceValidationTests = [
      {
        name: 'service-level precheck validation',
        service: processor(serviceCalls.double, {input: {value: z.number().positive()}}),
        validInput: {value: 10},
        expectedResult: 20,
        invalidInput: {value: -5},
        expectedError: /Too small: expected number to be >0/
      },
      {
        name: 'service-level postcheck validation',
        service: processor(serviceCalls.divide, {
          input: {numerator: z.number(), denominator: z.number()},
          output: z.number().positive()
        }),
        validInput: {numerator: 10, denominator: 2},
        expectedResult: 5,
        invalidInput: {numerator: -10, denominator: 2},
        expectedError: {code: 'postcheck-failed'}
      },
      {
        name: 'enum validation',
        service: processor(serviceCalls.updateTheme, {input: {theme: z.enum(['light', 'dark', 'auto'])}}),
        validInput: {theme: 'dark'},
        expectedResult: {theme: 'dark', updated: true},
        invalidInput: {theme: 'blue'},
        expectedError: /Invalid option: expected one of "light"\|"dark"\|"auto"/
      },
      {
        name: 'regex pattern validation',
        service: processor(serviceCalls.validateUsername, {input: {username: z.string().regex(/^[a-zA-Z0-9_]{3,20}$/)}}),
        validInput: {username: 'valid_user123'},
        expectedResult: 'Valid: valid_user123',
        invalidInput: {username: 'no-dashes'},
        expectedError: /Invalid string: must match pattern/
      },
      {
        name: 'optional fields validation',
        service: processor(serviceCalls.createProfile, {input: {name: z.string(), bio: z.string().optional()}}),
        validInput: {name: 'John'},
        expectedResult: {name: 'John', bio: 'No bio'},
        invalidInput: null // No invalid case for this test
      },
      {
        name: 'URL validation',
        service: processor(serviceCalls.extract, {input: {url: z.string().url()}}),
        validInput: {url: 'https://example.com'},
        expectedResult: 'https://example.com',
        invalidInput: {url: 'not a url'},
        expectedError: /Invalid URL/
      }
    ]

    // Generate tests from data
    serviceValidationTests.forEach(testCase => {
      it(`should validate with ${testCase.name}`, async () => {
        // Test valid input
        const result = await runValidationTest(testCase.service, testCase.validInput)
        assert.deepStrictEqual(result, testCase.expectedResult)

        // Test invalid input if provided
        if (testCase.invalidInput) {
          await runValidationTest(testCase.service, testCase.invalidInput, testCase.expectedError)
        }
      })
    })

    it('should allow user-level validation to override service validation', async () => {
      const service = processor(serviceCalls.double, {input: {value: z.number()}})

      const config = {
        services: {testService: service},
        phases: {
          result: ['[testService]/process', {
            value: 5,
            precheck: {value: ['number', {min: 10, max: 20}]}
          }]
        }
      }

      // User's stricter validation should fail even though service validation would pass
      await assert.rejects(query(config), /Too small/)
    })

    it('should handle validation in chains', async () => {
      const step1 = processor(async (args) => args.value + 10)
      const step2 = processor(async (args) => args.value * 2, {input: {value: z.number().max(50)}})

      const config = {
        services: {step1, step2},
        phases: {
          chain: [
            ['[step1]/process', {value: 45}], // Returns 55
            ['[step2]/process', {value: '@'}] // Should fail validation
          ]
        }
      }

      await assert.rejects(query(config), /Too big: expected number to be <=50/)
    })

    it('should validate arrays with service validation', async () => {
      const service = processor(async (args) => args.items.map(i => i.toUpperCase()), {
        input: {items: z.array(z.string()).min(2).max(5)}
      })

      const config = {
        services: {testService: service},
        phases: {
          result: ['[testService]/process', {items: ['hello', 'world']}]
        }
      }

      const result = await query(config)
      assert.deepStrictEqual(result.result, ['HELLO', 'WORLD'])

      // Test failure cases
      const failConfig = {
        services: {testService: service},
        phases: {
          result: ['[testService]/process', {items: ['only-one']}]
        }
      }
      await assert.rejects(query(failConfig), /Too small/)
    })

    it('should handle complex nested validation', async () => {
      const service = processor(serviceCalls.createUser, {
        input: {
          userData: z.object({
            name: z.string(),
            age: z.number().positive(),
            address: z.object({
              street: z.string(),
              city: z.string(),
              zip: z.string().regex(/^\d{5}$/)
            }),
            tags: z.array(z.string()).max(5)
          })
        }
      })

      const validData = {
        userData: {
          name: 'John Doe',
          age: 30,
          address: {
            street: '123 Main St',
            city: 'Anytown',
            zip: '12345'
          },
          tags: ['user', 'premium']
        }
      }

      const config = {
        services: {testService: service},
        phases: {result: ['[testService]/process', validData]}
      }

      const result = await query(config)
      assert.strictEqual(result.result.name, 'John Doe')
      assert.strictEqual(result.result.age, 30)
    })

    it('should validate both precheck and postcheck in sequence', async () => {
      // Transform data that may fail postcheck
      const service = processor(async (args) => ({value: args.value, doubled: args.value * 2}), {
        input: {value: z.number().min(1).max(10)},
        output: z.object({doubled: z.number().max(15)})
      })

      const config1 = {
        services: {testService: service},
        phases: {result: ['[testService]/process', {value: 5}]}
      }
      const result = await query(config1)
      assert.deepStrictEqual(result.result, {value: 5, doubled: 10})

      // Should fail postcheck
      const config2 = {
        services: {testService: service},
        phases: {result: ['[testService]/process', {value: 9}]} // doubled = 18, exceeds max
      }
      await assert.rejects(query(config2), {code: 'postcheck-failed'})
    })

    it('should accept date with constraints', async () => {
      const service = processor(serviceCalls.echo, {input: {value: z.date().min(new Date('2020-01-01'))}})

      const config = {
        services: {testService: service},
        phases: {result: ['[testService]/process', {value: new Date('2023-01-01')}]}
      }

      const result = await query(config)
      assert.ok(result.result instanceof Date)
    })

    it('should accept URL string modifier', async () => {
      const service = processor(serviceCalls.scrape, {
        input: {
          url: z.string().url(),
          queries: z.object({}).optional(),
          validate: z.boolean().optional()
        }
      })

      const config = {
        services: {testService: service},
        phases: {
          result: ['[testService]/process', {
            url: 'https://example.com',
            queries: {limit: 10}
          }]
        }
      }

      const result = await query(config)
      assert.strictEqual(result.result.url, 'https://example.com')
      assert.deepStrictEqual(result.result.queries, {limit: 10})
    })

    it('should accept object with optional modifier', async () => {
      const service = processor(async (args) => ({required: args.required, optional: args.optional || 'default'}), {
        input: {required: z.string(), optional: z.object({}).optional()}
      })

      const config = {
        services: {testService: service},
        phases: {
          result: ['[testService]/process', {required: 'value'}]
        }
      }

      const result = await query(config)
      assert.strictEqual(result.result.required, 'value')
      assert.strictEqual(result.result.optional, 'default')
    })

    it('should accept array with constraints', async () => {
      const service = processor(async (args) => args.values, {input: {values: z.array(z.string()).min(1).max(3)}})

      const config = {
        services: {testService: service},
        phases: {
          result: ['[testService]/process', {values: ['one', 'two', 'three']}]
        }
      }

      const result = await query(config)
      assert.deepStrictEqual(result.result, ['one', 'two', 'three'])

      // Test constraint violation
      const failConfig = {
        services: {testService: service},
        phases: {
          result: ['[testService]/process', {values: ['one', 'two', 'three', 'four']}]
        }
      }
      await assert.rejects(query(failConfig), /Too big: expected array to have/)
    })
  })

  describe('Invalid validation syntax in user queries', () => {
    const testService = defineService({
      async '/test'(args) {
        return args.value
      }
    })

    // [description, the call's precheck, error]
    const malformed = [
      ['undefined schema descriptors', {value: undefined}, /Not a descriptor[\s\S]* at value/],
      ['null schema descriptors', {value: null}, /Not a descriptor[\s\S]* at value/],
      ['invalid array format - non-string first element', {value: [123, 'modifier']}, /A descriptor array starts with a type name[\s\S]* at value/],
      ['invalid array format - empty array', {value: []}, /A descriptor array starts with a type name[\s\S]* at value/],
      ['malformed enum - no values', {value: ['enum']}, /'enum' takes a list of values first/],
      ['malformed enum - empty values array', {value: ['enum', []]}, /'enum' takes a list of values first/]
    ]

    for (const [description, precheck, error] of malformed) {
      it(`should handle ${description} gracefully`, async () => {
        const config = {
          services: {testService},
          phases: {result: ['[testService]/test', {value: 'hello', precheck}]}
        }
        await assert.rejects(query(config), error)
      })
    }
  })

  describe('Invalid declarations in service definitions', () => {
    // [description, input declaration]
    const malformed = [
      ['an unknown zodly type', {value: ['notARealType']}],
      ['an unknown zodly modifier', {value: ['string', 'optinal']}],
      ['a type with no source', {value: ['type']}],
      ['an unknown tag', {value: ['string', {tags: ['notARealTag']}]}]
    ]

    for (const [description, input] of malformed) {
      it(`should fail compilation for ${description}`, async () => {
        const config = {
          services: {testService: defineService({'/test': {input, call: async (args) => args.value}})},
          phases: {result: ['[testService]/test', {value: 'hello'}]}
        }
        await assert.rejects(query(config), {code: 'malformed-declaration', key: '[testService]/test'})
      })
    }
  })

  describe('Edge cases in validation compilation', () => {
    it('should handle deeply nested validation schemas', async () => {
      const service = processor(async (args) => args, {input: {level1: {level2: {level3: {level4: {value: z.string()}}}}}})
      const deep = (value) => ({level1: {level2: {level3: {level4: {value}}}}})

      const config = {
        services: {testService: service},
        phases: {result: ['[testService]/process', deep('deep')]}
      }

      const result = await query(config)
      assert.strictEqual(result.result.level1.level2.level3.level4.value, 'deep')

      await assert.rejects(
        query({...config, phases: {result: ['[testService]/process', deep(5)]}}),
        /level1\.level2\.level3\.level4\.value: 5 => Invalid input: expected string, received number/
      )
    })

    it('should handle validation with all modifier types', async () => {
      const service = processor(async (args) => args, {
        input: {
          email: z.string().email(),
          url: z.string().url(),
          positive: z.number().positive(),
          integer: z.number().int(),
          finite: z.number().finite(),
          safe: z.number().safe()
        }
      })

      const config = {
        services: {testService: service},
        phases: {
          result: ['[testService]/process', {
            email: 'test@example.com',
            url: 'https://example.com',
            positive: 5,
            integer: 10,
            finite: 100,
            safe: 1000
          }]
        }
      }

      const result = await query(config)
      assert.strictEqual(result.result.email, 'test@example.com')
    })

    it('should handle validation with complex union types', async () => {
      const service = processor(serviceCalls.echo, {input: {value: z.union([z.string(), z.number(), z.boolean()])}})
      const run = (value) => query({services: {testService: service}, phases: {result: ['[testService]/process', {value}]}})

      assert.strictEqual((await run('hello')).result, 'hello')
      assert.strictEqual((await run(42)).result, 42)
      await assert.rejects(run({object: true}), /Invalid input/)
    })
  })

  describe('Validation sequencing (service-level + user-level)', () => {
    it('should apply service validation before user validation on precheck', async () => {
      // Service requires a number
      const service = processor(serviceCalls.echo, {input: {value: z.number()}})

      const config = {
        services: {testService: service},
        phases: {
          result: ['[testService]/process', {
            value: 'not-a-number', // Will fail service validation first
            precheck: {
              value: ['number', {min: 10}] // User validation won't even run
            }
          }]
        }
      }

      await assert.rejects(
        query(config),
        /expected number, received string/
      )
    })

    it('should apply user validation after service validation on postcheck', async () => {
      // Service validates output is positive
      const service = processor(async (args) => ({result: args.value * 2}), {
        output: z.object({result: z.number().positive()})
      })

      const config = {
        services: {testService: service},
        phases: {
          result: ['[testService]/process', {
            value: 10, // Will produce 20
            postcheck: {
              result: ['number', {max: 15}] // User validation should fail
            }
          }]
        }
      }

      await assert.rejects(
        query(config),
        {code: 'postcheck-failed'}
      )
    })

    it('should handle errors in nested service validation gracefully', async () => {
      const service = processor(async (args) => args, {input: {data: z.object({nested: z.object({value: z.string().email()})})}})

      const config = {
        services: {testService: service},
        phases: {
          result: ['[testService]/process', {
            data: {
              nested: {
                value: 'not-an-email'
              }
            }
          }]
        }
      }

      await assert.rejects(
        query(config),
        /Invalid email/
      )
    })
  })
})
