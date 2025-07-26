/**
 * Integration Tests for Validation System
 * Tests validation through the query system with services
 */

import query from '../query.js'
import assert from 'node:assert/strict'
import {describe, it} from 'node:test'

describe('Validation Integration Tests', () => {
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

  /**
   * Helper to create a service with validators
   */
  function createService(name, validators) {
    const service = {...testServices[name]}
    if (validators) {
      service.process._validators = validators
    }
    return service
  }

  /**
   * Helper to run validation tests
   */
  async function runValidationTest(serviceName, validators, input, expectedError = null) {
    const service = createService(serviceName, validators)
    const config = {
      services: {testService: service},
      queries: {result: ['testService:process', input]}
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
      assert.strictEqual(result.result.name, 'John Doe')
      assert.strictEqual(result.result.age, 30)
    })

    it('should validate both precheck and postcheck in sequence', async () => {
      const service = {
        async process(args) {
          // Transform data that may fail postcheck
          return {value: args.value, doubled: args.value * 2}
        }
      }
      service.process._validators = {
        precheck: {value: ['number', {min: 1, max: 10}]},
        postcheck: {doubled: ['number', {max: 15}]}
      }

      const config1 = {
        services: {testService: service},
        queries: {result: ['testService:process', {value: 5}]}
      }
      const result = await query(config1)
      assert.deepStrictEqual(result.result, {value: 5, doubled: 10})

      // Should fail postcheck
      const config2 = {
        services: {testService: service},
        queries: {result: ['testService:process', {value: 9}]} // doubled = 18, exceeds max
      }
      await assert.rejects(query(config2), /postcheck validation failed/)
    })

    it('should accept date with constraints', async () => {
      const service = createService('echo', {
        precheck: {value: ['date', {min: new Date('2020-01-01')}]}
      })

      const config = {
        services: {testService: service},
        queries: {result: ['testService:process', {value: new Date('2023-01-01')}]}
      }

      const result = await query(config)
      assert.ok(result.result instanceof Date)
    })

    it('should accept URL string modifier', async () => {
      const service = createService('scrape', {
        precheck: {
          url: ['string', 'url'],
          queries: ['object', 'optional'],
          validate: ['boolean', 'optional']
        }
      })

      const config = {
        services: {testService: service},
        queries: {
          result: ['testService:process', {
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
      const service = {
        async process(args) {
          return {
            required: args.required,
            optional: args.optional || 'default'
          }
        }
      }
      service.process._validators = {
        precheck: {
          required: ['string'],
          optional: ['object', 'optional']
        }
      }

      const config = {
        services: {testService: service},
        queries: {
          result: ['testService:process', {required: 'value'}]
        }
      }

      const result = await query(config)
      assert.strictEqual(result.result.required, 'value')
      assert.strictEqual(result.result.optional, 'default')
    })

    it('should accept array with constraints', async () => {
      const service = {
        async process(args) {
          return args.values
        }
      }
      service.process._validators = {
        precheck: {
          values: ['array', ['string'], {min: 1, max: 3}]
        }
      }

      const config = {
        services: {testService: service},
        queries: {
          result: ['testService:process', {values: ['one', 'two', 'three']}]
        }
      }

      const result = await query(config)
      assert.deepStrictEqual(result.result, ['one', 'two', 'three'])

      // Test constraint violation
      const failConfig = {
        services: {testService: service},
        queries: {
          result: ['testService:process', {values: ['one', 'two', 'three', 'four']}]
        }
      }
      await assert.rejects(query(failConfig), /Too big: expected array to have/)
    })
  })

  describe('Invalid validation syntax in user queries', () => {
    it('should handle undefined schema descriptors gracefully', async () => {
      const testService = {
        async test(args) {
          return args.value
        }
      }

      const config = {
        services: {testService},
        queries: {
          result: ['testService:test', {
            value: 'hello',
            precheck: {
              value: undefined // Invalid: undefined schema
            }
          }]
        }
      }

      await assert.rejects(
        query(config),
        /Invalid option: expected one of/
      )
    })

    it('should handle null schema descriptors gracefully', async () => {
      const testService = {
        async test(args) {
          return args.value
        }
      }

      const config = {
        services: {testService},
        queries: {
          result: ['testService:test', {
            value: 'hello',
            precheck: {
              value: null // Invalid: null schema
            }
          }]
        }
      }

      await assert.rejects(
        query(config),
        /Invalid option: expected one of/
      )
    })

    it('should handle invalid array format - non-string first element', async () => {
      const testService = {
        async test(args) {
          return args.value
        }
      }

      const config = {
        services: {testService},
        queries: {
          result: ['testService:test', {
            value: 'hello',
            precheck: {
              value: [123, 'modifier'] // Invalid: first element must be string
            }
          }]
        }
      }

      await assert.rejects(
        query(config),
        /Invalid option: expected one of/
      )
    })

    it('should handle invalid array format - empty array', async () => {
      const testService = {
        async test(args) {
          return args.value
        }
      }

      const config = {
        services: {testService},
        queries: {
          result: ['testService:test', {
            value: 'hello',
            precheck: {
              value: [] // Invalid: empty array
            }
          }]
        }
      }

      await assert.rejects(
        query(config),
        /Invalid option: expected one of/
      )
    })

    it('should handle malformed enum - no values', async () => {
      const testService = {
        async test(args) {
          return args.value
        }
      }

      const config = {
        services: {testService},
        queries: {
          result: ['testService:test', {
            value: 'hello',
            precheck: {
              value: ['enum'] // Invalid: no enum values
            }
          }]
        }
      }

      await assert.rejects(
        query(config),
        /Enum must have an array of values/
      )
    })

    it('should handle malformed enum - empty values array', async () => {
      const testService = {
        async test(args) {
          return args.value
        }
      }

      const config = {
        services: {testService},
        queries: {
          result: ['testService:test', {
            value: 'hello',
            precheck: {
              value: ['enum', []] // Invalid: empty enum values
            }
          }]
        }
      }

      await assert.rejects(
        query(config),
        /Enum must have an array of values/
      )
    })
  })

  describe('Invalid validation syntax in service definitions', () => {
    it('should handle undefined in service validators', async () => {
      const service = {
        async test(args) {
          return args.value
        }
      }
      service.test._validators = {
        precheck: {
          value: undefined // Invalid: undefined schema
        }
      }

      const config = {
        services: {testService: service},
        queries: {
          result: ['testService:test', {value: 'hello'}]
        }
      }

      await assert.rejects(
        query(config),
        /Invalid option: expected one of/
      )
    })

    it('should handle null in service validators', async () => {
      const service = {
        async test(args) {
          return args.value
        }
      }
      service.test._validators = {
        precheck: {
          value: null // Invalid: null schema
        }
      }

      const config = {
        services: {testService: service},
        queries: {
          result: ['testService:test', {value: 'hello'}]
        }
      }

      await assert.rejects(
        query(config),
        /Invalid option: expected one of/
      )
    })

    it('should handle invalid type names in service validators', async () => {
      const service = {
        async test(args) {
          return args.value
        }
      }
      service.test._validators = {
        precheck: {
          value: ['notARealType'] // Invalid: unknown type
        }
      }

      const config = {
        services: {testService: service},
        queries: {
          result: ['testService:test', {value: 'hello'}]
        }
      }

      await assert.rejects(
        query(config),
        /Invalid option: expected one of/
      )
    })
  })

  describe('Edge cases in validation compilation', () => {
    it('should handle deeply nested validation schemas', async () => {
      const service = {
        async process(args) {
          return args
        }
      }
      service.process._validators = {
        precheck: {
          level1: {
            level2: {
              level3: {
                level4: {
                  value: ['string']
                }
              }
            }
          }
        }
      }

      const config = {
        services: {testService: service},
        queries: {
          result: ['testService:process', {
            level1: {
              level2: {
                level3: {
                  level4: {
                    value: 'deep'
                  }
                }
              }
            }
          }]
        }
      }

      const result = await query(config)
      assert.strictEqual(result.result.level1.level2.level3.level4.value, 'deep')
    })

    it('should handle validation with all modifier types', async () => {
      const service = {
        async process(args) {
          return args
        }
      }
      service.process._validators = {
        precheck: {
          email: ['string', 'email'],
          url: ['string', 'url'],
          positive: ['number', 'positive'],
          integer: ['number', 'int'],
          finite: ['number', 'finite'],
          safe: ['number', 'safe']
        }
      }

      const config = {
        services: {testService: service},
        queries: {
          result: ['testService:process', {
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
      const service = {
        async process(args) {
          return args.value
        }
      }
      service.process._validators = {
        precheck: {
          value: ['union', ['string'], ['number'], ['boolean']]
        }
      }

      // Test with string
      const config1 = {
        services: {testService: service},
        queries: {
          result: ['testService:process', {value: 'hello'}]
        }
      }
      const result1 = await query(config1)
      assert.strictEqual(result1.result, 'hello')

      // Test with number
      const config2 = {
        services: {testService: service},
        queries: {
          result: ['testService:process', {value: 42}]
        }
      }
      const result2 = await query(config2)
      assert.strictEqual(result2.result, 42)

      // Test with invalid type
      const config3 = {
        services: {testService: service},
        queries: {
          result: ['testService:process', {value: {object: true}}]
        }
      }
      await assert.rejects(query(config3), /Invalid input/)
    })
  })

  describe('Validation sequencing (service-level + user-level)', () => {
    it('should apply service validation before user validation on precheck', async () => {
      const service = {
        async process(args) {
          return args.value
        }
      }
      // Service requires a number
      service.process._validators = {
        precheck: {
          value: ['number']
        }
      }

      const config = {
        services: {testService: service},
        queries: {
          result: ['testService:process', {
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
      const service = {
        async process(args) {
          return {result: args.value * 2}
        }
      }
      // Service validates output is positive
      service.process._validators = {
        postcheck: {
          result: ['number', 'positive']
        }
      }

      const config = {
        services: {testService: service},
        queries: {
          result: ['testService:process', {
            value: 10, // Will produce 20
            postcheck: {
              result: ['number', {max: 15}] // User validation should fail
            }
          }]
        }
      }

      await assert.rejects(
        query(config),
        /postcheck validation failed/
      )
    })

    it('should handle errors in nested service validation gracefully', async () => {
      const service = {
        async process(args) {
          return args
        }
      }
      service.process._validators = {
        precheck: {
          data: {
            nested: {
              value: ['string', 'email']
            }
          }
        }
      }

      const config = {
        services: {testService: service},
        queries: {
          result: ['testService:process', {
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