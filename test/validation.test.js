/**
 * Data-driven Validation System Tests
 */

import query from '../query.js'
import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import {parseSchema, validate} from '../validation.js'

describe('Validation System Tests', () => {
  // Reusable test services
  const testServices = {
    echo: {
      async process(args) { return args.value }
    },
    double: {
      async process(args) { return args.value * 2 }
    },
    transform: {
      async process(args) { return {...args, processed: true} }
    },
    divide: {
      async process(args) { return args.numerator / args.denominator }
    },
    createUser: {
      async process(args) { return {id: 123, ...args.userData} }
    },
    updateTheme: {
      async process(args) { return {theme: args.theme, updated: true} }
    },
    validateUsername: {
      async process(args) { return `Valid: ${args.username}` }
    },
    createProfile: {
      async process(args) { return {name: args.name, bio: args.bio || 'No bio'} }
    },
    extract: {
      async process(args) { return args.url }
    },
    scrape: {
      async process(args) {
        return {
          url: args.url,
          queries: args.queries || {},
          validate: args.validate || null
        }
      }
    }
  }

  // Helper to create a service with validators
  function createService(serviceName, validators) {
    const service = {
      process: testServices[serviceName].process
    }
    if (validators) {
      service.process._validators = validators
    }
    return service
  }

  // Helper to run validation test
  async function runValidationTest(serviceName, validators, input, expectedError) {
    const service = createService(serviceName, validators)

    const config = {
      services: {testService: service},
      queries: {
        result: ['testService:process', input]
      }
    }

    if (expectedError) {
      await assert.rejects(query(config), expectedError)
    } else {
      const result = await query(config)
      return result.result
    }
  }

  describe('Schema Parsing', () => {
    // Data for schema parsing tests
    const schemaTests = [
      {
        name: 'primitive types',
        tests: [
          {schema: ['string'], valid: 'hello', invalid: 123},
          {schema: ['number'], valid: 42, invalid: 'hello'},
          {schema: ['boolean'], valid: true, invalid: 'true'}
        ]
      },
      {
        name: 'string modifiers',
        tests: [
          {schema: ['string', 'email'], valid: 'test@example.com', invalid: 'invalid-email'},
          {schema: ['string', 'url'], valid: 'https://example.com', invalid: 'not-a-url'},
          {schema: ['string', {min: 3, max: 10}], valid: 'hello', invalid: 'ab'}
        ]
      },
      {
        name: 'number modifiers',
        tests: [
          {schema: ['number', 'positive'], valid: 5, invalid: -5},
          {schema: ['number', 'integer'], valid: 5, invalid: 5.5},
          {schema: ['number', {min: 0, max: 100}], valid: 50, invalid: 150}
        ]
      },
      {
        name: 'complex types',
        tests: [
          {schema: ['array', ['string']], valid: ['a', 'b'], invalid: [1, 2]},
          {schema: ['nullable', ['string']], valid: null, invalid: 123},
          {schema: ['optional', ['string']], valid: undefined, invalid: 123},
          {schema: ['enum', ['red', 'blue', 'green']], valid: 'red', invalid: 'yellow'}
        ]
      }
    ]

    schemaTests.forEach(group => {
      it(`should parse ${group.name}`, () => {
        group.tests.forEach(test => {
          const schema = parseSchema(test.schema)
          assert.strictEqual(schema.safeParse(test.valid).success, true,
            `Expected ${JSON.stringify(test.valid)} to be valid for ${JSON.stringify(test.schema)}`)
          assert.strictEqual(schema.safeParse(test.invalid).success, false,
            `Expected ${JSON.stringify(test.invalid)} to be invalid for ${JSON.stringify(test.schema)}`)
        })
      })
    })

    it('should parse object schemas', () => {
      const schema = parseSchema({
        name: ['string'],
        age: ['number', 'positive'],
        email: ['string', 'email', 'optional']
      })

      assert.strictEqual(schema.safeParse({name: 'John', age: 25}).success, true)
      assert.strictEqual(schema.safeParse({name: 'John', age: -5}).success, false)
      assert.strictEqual(schema.safeParse({name: 'John', age: 25, email: 'bad'}).success, false)
    })

    it('should parse tuple types', () => {
      const schema = parseSchema(['tuple', ['string'], ['number'], ['boolean']])
      assert.strictEqual(schema.safeParse(['hello', 42, true]).success, true)
      assert.strictEqual(schema.safeParse(['hello', '42', true]).success, false)
    })
  })

  describe('Validation Function', () => {
    const validationTests = [
      {
        name: 'basic validation',
        schema: ['string'],
        valid: 'hello',
        invalid: {value: 123, error: /expected string, received number/}
      },
      {
        name: 'complex object validation',
        schema: {
          name: ['string'],
          age: ['number', 'positive'],
          email: ['string', 'email']
        },
        valid: {name: 'John Doe', age: 25, email: 'john@example.com'},
        invalid: {
          value: {name: 'John Doe', age: -25, email: 'invalid-email'},
          error: /Invalid email address/
        }
      }
    ]

    validationTests.forEach(test => {
      it(`should handle ${test.name}`, () => {
        const schema = parseSchema(test.schema)

        // Should not throw for valid data
        assert.doesNotThrow(() => validate(schema, test.valid))

        // Should throw for invalid data
        if (test.invalid) {
          assert.throws(() => validate(schema, test.invalid.value), test.invalid.error)
        }
      })
    })
  })

  describe('Integration Tests - Service and User Level Validation', () => {
    // Test cases for service validation
    const serviceValidationTests = [
      {
        name: 'service-level precheck validation',
        service: 'double',
        validators: {precheck: {value: ['number', 'positive']}},
        validInput: {value: 10},
        expectedResult: 20,
        invalidInput: {value: -5},
        expectedError: /Too small: expected number to be >0/
      },
      {
        name: 'service-level postcheck validation',
        service: 'divide',
        validators: {
          precheck: {numerator: ['number'], denominator: ['number']},
          postcheck: ['number', 'positive']
        },
        validInput: {numerator: 10, denominator: 2},
        expectedResult: 5,
        invalidInput: {numerator: -10, denominator: 2},
        expectedError: /postcheck validation failed/
      },
      {
        name: 'enum validation',
        service: 'updateTheme',
        validators: {precheck: {theme: ['enum', ['light', 'dark', 'auto']]}},
        validInput: {theme: 'dark'},
        expectedResult: {theme: 'dark', updated: true},
        invalidInput: {theme: 'blue'},
        expectedError: /Invalid option: expected one of "light"\|"dark"\|"auto"/
      },
      {
        name: 'regex pattern validation',
        service: 'validateUsername',
        validators: {precheck: {username: ['string', {regex: /^[a-zA-Z0-9_]{3,20}$/}]}},
        validInput: {username: 'valid_user123'},
        expectedResult: 'Valid: valid_user123',
        invalidInput: {username: 'no-dashes'},
        expectedError: /Invalid string: must match pattern/
      },
      {
        name: 'optional fields validation',
        service: 'createProfile',
        validators: {
          precheck: {
            name: ['string'],
            bio: ['string', 'optional']
          }
        },
        validInput: {name: 'John'},
        expectedResult: {name: 'John', bio: 'No bio'},
        invalidInput: null // No invalid case for this test
      },
      {
        name: 'URL validation',
        service: 'extract',
        validators: {precheck: {url: ['string', 'url']}},
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
        const result = await runValidationTest(
          testCase.service,
          testCase.validators,
          testCase.validInput
        )
        assert.deepStrictEqual(result, testCase.expectedResult)

        // Test invalid input if provided
        if (testCase.invalidInput) {
          await runValidationTest(
            testCase.service,
            testCase.validators,
            testCase.invalidInput,
            testCase.expectedError
          )
        }
      })
    })

    it('should fail compilation with invalid schema descriptor', async () => {
      const service = {async test(args) { return args.value }}
      service.test._validators = {precheck: {value: ['invalidType']}}

      const config = {
        services: {testService: service},
        queries: {result: ['testService:test', {value: 'hello'}]}
      }

      await assert.rejects(
        query(config),
        /Invalid option: expected one of "string"\|"number"\|"boolean"/
      )
    })

    it('should allow user-level validation to override service validation', async () => {
      const service = createService('double', {
        precheck: {value: ['number']}
      })

      const config = {
        services: {testService: service},
        queries: {
          result: ['testService:process', {
            value: 5,
            precheck: {value: ['number', {min: 10, max: 20}]}
          }]
        }
      }

      // User's stricter validation should fail even though service validation would pass
      await assert.rejects(query(config), /Too small/)
    })

    it('should handle validation in chains', async () => {
      const step1 = {async process(args) { return args.value + 10 }}
      const step2 = {async process(args) { return args.value * 2 }}
      step2.process._validators = {
        precheck: {value: ['number', {max: 50}]}
      }

      const config = {
        services: {step1, step2},
        queries: {
          chain: [
            ['step1:process', {value: 45}], // Returns 55
            ['step2:process', {value: '@'}] // Should fail validation
          ]
        }
      }

      await assert.rejects(query(config), /Too big: expected number to be <=50/)
    })

    it('should validate arrays with service validation', async () => {
      const service = {async process(args) { return args.items.map(i => i.toUpperCase()) }}
      service.process._validators = {
        precheck: {items: ['array', ['string'], {min: 2, max: 5}]}
      }

      const config = {
        services: {testService: service},
        queries: {
          result: ['testService:process', {items: ['hello', 'world']}]
        }
      }

      const result = await query(config)
      assert.deepStrictEqual(result.result, ['HELLO', 'WORLD'])

      // Test failure cases
      const failConfig = {
        services: {testService: service},
        queries: {
          result: ['testService:process', {items: ['only-one']}]
        }
      }
      await assert.rejects(query(failConfig), /Too small/)
    })

    it('should handle complex nested validation', async () => {
      const service = createService('createUser', {
        precheck: {
          userData: {
            name: ['string'],
            age: ['number', 'positive'],
            address: {
              street: ['string'],
              city: ['string'],
              zip: ['string', {regex: /^\d{5}$/}]
            },
            tags: ['array', ['string'], {max: 5}]
          }
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
        queries: {result: ['testService:process', validData]}
      }

      const result = await query(config)
      assert.strictEqual(result.result.id, 123)
      assert.strictEqual(result.result.name, 'John Doe')
    })

    it('should validate both precheck and postcheck in sequence', async () => {
      const service = {
        async process(args) {
          if (args.fail) throw new Error('Service error')
          return {value: args.value * 2, status: 'success'}
        }
      }

      service.process._validators = {
        precheck: {value: ['number', 'positive']},
        postcheck: {
          value: ['number', {max: 100}],
          status: ['enum', ['success', 'pending', 'failed']]
        }
      }

      // Valid case
      const config = {
        services: {testService: service},
        queries: {result: ['testService:process', {value: 10}]}
      }
      const result = await query(config)
      assert.deepStrictEqual(result.result, {value: 20, status: 'success'})

      // Postcheck failure
      const failConfig = {
        services: {testService: service},
        queries: {result: ['testService:process', {value: 60}]} // 60 * 2 = 120 > 100
      }
      await assert.rejects(query(failConfig), /postcheck validation failed/)
    })

    // Test for constraint objects and modifiers
    const modifierTests = [
      {
        name: 'date with constraints',
        validators: {precheck: {value: ['date', {min: new Date('2023-01-01')}]}},
        service: 'echo',
        validInput: {value: new Date('2024-01-01')},
        invalidInput: {value: new Date('2022-01-01')},
        expectedError: /Too small/
      },
      {
        name: 'URL string modifier',
        validators: {precheck: {value: ['string', 'url']}},
        service: 'echo',
        validInput: {value: 'https://example.com'},
        invalidInput: {value: 'not-a-url'},
        expectedError: /Invalid URL/
      },
      {
        name: 'object with optional modifier',
        validators: {precheck: {value: ['object', 'optional']}},
        service: 'echo',
        validInput: {value: {name: 'test'}},
        invalidInput: {value: 'not an object'},
        expectedError: /Invalid input: expected object/
      },
      {
        name: 'array with constraints',
        validators: {precheck: {value: ['array', ['string'], {min: 1, max: 10}]}},
        service: 'echo',
        validInput: {value: ['one', 'two', 'three']},
        invalidInput: {value: []},
        expectedError: /Too small/
      }
    ]

    modifierTests.forEach(test => {
      it(`should accept ${test.name}`, async () => {
        await runValidationTest(test.service, test.validators, test.validInput)
        if (test.invalidInput) {
          await runValidationTest(test.service, test.validators, test.invalidInput, test.expectedError)
        }
      })
    })
  })
})
