/**
 * Zod-based Validation System Tests
 */

import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import {parseSchema, validate} from '../validation.js'

describe('Validation System Tests', () => {
  describe('Schema Parsing', () => {
    it('should parse primitive types', () => {
      const stringSchema = parseSchema(['string'])
      const numberSchema = parseSchema(['number'])

      // Test valid values
      assert.strictEqual(stringSchema.safeParse('hello').success, true)
      assert.strictEqual(numberSchema.safeParse(42).success, true)

      // Test invalid values
      assert.strictEqual(stringSchema.safeParse(123).success, false)
      assert.strictEqual(numberSchema.safeParse('hello').success, false)
    })

    it('should parse string with modifiers', () => {
      const emailSchema = parseSchema(['string', 'email'])

      assert.strictEqual(emailSchema.safeParse('test@example.com').success, true)
      assert.strictEqual(emailSchema.safeParse('invalid-email').success, false)
    })

    it('should parse number with modifiers', () => {
      const positiveIntSchema = parseSchema(['number', 'positive', 'integer'])

      assert.strictEqual(positiveIntSchema.safeParse(5).success, true)
      assert.strictEqual(positiveIntSchema.safeParse(-5).success, false)
      assert.strictEqual(positiveIntSchema.safeParse(5.5).success, false)
    })

    it('should parse object schemas', () => {
      const userSchema = parseSchema({
        name: ['string'],
        age: ['number', 'positive']
      })

      const validUser = {name: 'John', age: 25}
      const invalidUser = {name: 'John', age: -5}

      assert.strictEqual(userSchema.safeParse(validUser).success, true)
      assert.strictEqual(userSchema.safeParse(invalidUser).success, false)
    })

    it('should parse array schemas', () => {
      const stringArraySchema = parseSchema(['array', ['string']])

      assert.strictEqual(stringArraySchema.safeParse(['a', 'b', 'c']).success, true)
      assert.strictEqual(stringArraySchema.safeParse(['a', 123, 'c']).success, false)
    })

    it('should parse array with constraints', () => {
      const constrainedArraySchema = parseSchema(['array', ['string'], {min: 2, max: 5}])

      assert.strictEqual(constrainedArraySchema.safeParse(['a', 'b']).success, true)
      assert.strictEqual(constrainedArraySchema.safeParse(['a']).success, false) // too short
      assert.strictEqual(constrainedArraySchema.safeParse(['a', 'b', 'c', 'd', 'e', 'f']).success, false) // too long
    })

    it('should parse nullable and optional modifiers', () => {
      const nullableSchema = parseSchema(['nullable', ['string']])
      const optionalSchema = parseSchema(['string', 'optional'])

      assert.strictEqual(nullableSchema.safeParse('hello').success, true)
      assert.strictEqual(nullableSchema.safeParse(null).success, true)
      assert.strictEqual(nullableSchema.safeParse(undefined).success, false)

      assert.strictEqual(optionalSchema.safeParse('hello').success, true)
      assert.strictEqual(optionalSchema.safeParse(undefined).success, true)
      assert.strictEqual(optionalSchema.safeParse(null).success, false)
    })

    it('should parse enum types', () => {
      const themeSchema = parseSchema(['enum', ['light', 'dark', 'auto']])

      assert.strictEqual(themeSchema.safeParse('light').success, true)
      assert.strictEqual(themeSchema.safeParse('dark').success, true)
      assert.strictEqual(themeSchema.safeParse('auto').success, true)
      assert.strictEqual(themeSchema.safeParse('blue').success, false)
      assert.strictEqual(themeSchema.safeParse('').success, false)
    })

    it('should parse regex patterns', () => {
      // Using object modifier syntax
      const usernameSchema = parseSchema(['string', {regex: /^[a-zA-Z0-9_]{3,20}$/}])

      assert.strictEqual(usernameSchema.safeParse('valid_user123').success, true)
      assert.strictEqual(usernameSchema.safeParse('ab').success, false) // too short
      assert.strictEqual(usernameSchema.safeParse('invalid-user').success, false) // contains dash
      assert.strictEqual(usernameSchema.safeParse('this_username_is_way_too_long').success, false)
    })

    it('should parse date with min/max constraints', () => {
      const futureDate = new Date()
      futureDate.setDate(futureDate.getDate() + 1)

      const pastDate = new Date()
      pastDate.setDate(pastDate.getDate() - 1)

      // Date must be in the future
      const futureDateSchema = parseSchema(['date', {min: new Date()}])

      assert.strictEqual(futureDateSchema.safeParse(futureDate).success, true)
      assert.strictEqual(futureDateSchema.safeParse(pastDate).success, false)
    })
  })

  describe('Validation Function', () => {
    it('should validate successfully with valid data', () => {
      const schema = ['string', 'email']
      const validEmail = 'test@example.com'

      // Should not throw
      validate(schema, validEmail, 'precheck')
    })

    it('should throw validation error with invalid data', () => {
      const schema = ['string', 'email']
      const invalidEmail = 'not-an-email'

      assert.throws(() => {
        validate(schema, invalidEmail, 'precheck')
      }, /Precheck validation failed/)
    })

    it('should validate complex object schema', () => {
      const schema = {
        name: ['string'],
        age: ['number', 'positive', 'integer'],
        email: ['string', 'email']
      }

      const validUser = {
        name: 'John Doe',
        age: 25,
        email: 'john@example.com'
      }

      const invalidUser = {
        name: 'John Doe',
        age: -25, // negative age
        email: 'invalid-email'
      }

      // Should not throw
      validate(schema, validUser, 'precheck')

      // Should throw
      assert.throws(() => {
        validate(schema, invalidUser, 'precheck')
      }, /Precheck validation failed/)
    })
  })

  describe('Integration Tests - Service and User Level Validation', () => {
    it('should validate with service-level precheck', async () => {
      const query = (await import('../index.js')).default

      // Create a test service with validation
      const testService = {
        async validateInput(args) {
          return args.value * 2
        }
      }

      // Add service-level validation
      testService.validateInput._validators = {
        precheck: {
          value: ['number', 'positive']
        }
      }

      const config = {
        services: {testService},
        queries: {
          test: ['testService:validateInput', {value: 10}]
        }
      }

      // Should succeed with valid input
      const result = await query(config)
      assert.strictEqual(result.test, 20)
    })

    it('should fail with invalid service-level precheck', async () => {
      const query = (await import('../index.js')).default

      const testService = {
        async validateInput(args) {
          return args.value * 2
        }
      }

      testService.validateInput._validators = {
        precheck: {
          value: ['number', 'positive']
        }
      }

      const config = {
        services: {testService},
        queries: {
          test: ['testService:validateInput', {value: -5}]
        }
      }

      // Should fail with negative value
      await assert.rejects(
        query(config),
        /Precheck validation failed/
      )
    })

    it('should validate with service-level postcheck', async () => {
      const query = (await import('../index.js')).default

      const testService = {
        async processData(args) {
          return {
            result: args.input.toUpperCase(),
            length: args.input.length
          }
        }
      }

      // Add service-level postcheck validation
      testService.processData._validators = {
        postcheck: {
          result: ['string'],
          length: ['number', 'positive']
        }
      }

      const config = {
        services: {testService},
        queries: {
          test: ['testService:processData', {input: 'hello'}]
        }
      }

      const result = await query(config)
      assert.deepStrictEqual(result.test, {result: 'HELLO', length: 5})
    })

    it('should validate with user-level precheck overriding service validation', async () => {
      const query = (await import('../index.js')).default

      const testService = {
        async processNumber(args) {
          return args.num * 3
        }
      }

      // Service allows any number
      testService.processNumber._validators = {
        precheck: {
          num: ['number']
        }
      }

      // User adds additional constraint
      const config = {
        services: {testService},
        queries: {
          test: ['testService:processNumber', {
            num: 15,
            precheck: {
              num: ['number', {min: 10, max: 20}]
            }
          }]
        }
      }

      const result = await query(config)
      assert.strictEqual(result.test, 45)
    })

    it('should fail when user precheck is more restrictive', async () => {
      const query = (await import('../index.js')).default

      const testService = {
        async processNumber(args) {
          return args.num * 3
        }
      }

      testService.processNumber._validators = {
        precheck: {
          num: ['number']
        }
      }

      const config = {
        services: {testService},
        queries: {
          test: ['testService:processNumber', {
            num: 25, // Outside user's range
            precheck: {
              num: ['number', {min: 10, max: 20}]
            }
          }]
        }
      }

      await assert.rejects(
        query(config),
        /Precheck validation failed/
      )
    })

    it('should validate arrays with both service and user validation', async () => {
      const query = (await import('../index.js')).default

      const testService = {
        async processArray(args) {
          return args.items.map(item => item.toUpperCase())
        }
      }

      // Service validates it's an array
      testService.processArray._validators = {
        precheck: {
          items: ['array', ['string']]
        }
      }

      // User adds length constraints
      const config = {
        services: {testService},
        queries: {
          test: ['testService:processArray', {
            items: ['hello', 'world'],
            precheck: {
              items: ['array', ['string'], {min: 2, max: 5}]
            }
          }]
        }
      }

      const result = await query(config)
      assert.deepStrictEqual(result.test, ['HELLO', 'WORLD'])
    })

    it('should handle complex nested validation', async () => {
      const query = (await import('../index.js')).default

      const testService = {
        async createUser(args) {
          return {
            id: Math.floor(Math.random() * 1000),
            ...args.userData,
            createdAt: new Date().toISOString()
          }
        }
      }

      // Service-level validation
      testService.createUser._validators = {
        precheck: {
          userData: {
            name: ['string'],
            email: ['string', 'email']
          }
        },
        postcheck: {
          id: ['number', 'positive'],
          name: ['string'],
          email: ['string', 'email'],
          createdAt: ['string']
        }
      }

      // User adds age validation
      const config = {
        services: {testService},
        queries: {
          newUser: ['testService:createUser', {
            userData: {
              name: 'John Doe',
              email: 'john@example.com',
              age: 25
            },
            precheck: {
              userData: {
                age: ['number', 'positive', {min: 18}]
              }
            }
          }]
        }
      }

      const result = await query(config)
      assert.strictEqual(result.newUser.name, 'John Doe')
      assert.strictEqual(result.newUser.email, 'john@example.com')
      assert.strictEqual(result.newUser.age, 25)
      assert.strictEqual(typeof result.newUser.id, 'number')
      assert.strictEqual(typeof result.newUser.createdAt, 'string')
    })

    it('should validate both precheck and postcheck in sequence', async () => {
      const query = (await import('../index.js')).default

      const testService = {
        async transform(args) {
          // Transform string to object
          return {
            original: args.input,
            uppercase: args.input.toUpperCase(),
            length: args.input.length
          }
        }
      }

      // Service validates input and output
      testService.transform._validators = {
        precheck: {
          input: ['string', {min: 3}]
        },
        postcheck: {
          original: ['string'],
          uppercase: ['string'],
          length: ['number', 'positive']
        }
      }

      const config = {
        services: {testService},
        queries: {
          result: ['testService:transform', {input: 'test'}]
        }
      }

      const result = await query(config)
      assert.deepStrictEqual(result.result, {
        original: 'test',
        uppercase: 'TEST',
        length: 4
      })
    })

    it('should handle validation errors in chains', async () => {
      const query = (await import('../index.js')).default

      const testService = {
        async step1(args) {
          return args.value + 10
        },
        async step2(args) {
          return args.value * 2
        }
      }

      // Add validation to step2
      testService.step2._validators = {
        precheck: {
          value: ['number', {max: 50}] // Will fail if step1 result > 50
        }
      }

      const config = {
        services: {testService},
        queries: {
          chain: [
            ['testService:step1', {value: 45}], // Returns 55
            ['testService:step2', {value: '@'}] // Should fail validation
          ]
        }
      }

      await assert.rejects(
        query(config),
        /Precheck validation failed/
      )
    })

    it('should validate with optional fields', async () => {
      const query = (await import('../index.js')).default

      const testService = {
        async createProfile(args) {
          const profile = {name: args.name}
          if (args.bio) profile.bio = args.bio
          if (args.age) profile.age = args.age
          return profile
        }
      }

      // Service validation with optional fields
      testService.createProfile._validators = {
        precheck: {
          name: ['string'],
          bio: ['string', 'optional'],
          age: ['number', 'positive', 'optional']
        }
      }

      // Test with only required field
      const config1 = {
        services: {testService},
        queries: {
          profile: ['testService:createProfile', {name: 'Alice'}]
        }
      }

      const result1 = await query(config1)
      assert.deepStrictEqual(result1.profile, {name: 'Alice'})

      // Test with all fields
      const config2 = {
        services: {testService},
        queries: {
          profile: ['testService:createProfile', {
            name: 'Bob',
            bio: 'Developer',
            age: 30
          }]
        }
      }

      const result2 = await query(config2)
      assert.deepStrictEqual(result2.profile, {
        name: 'Bob',
        bio: 'Developer',
        age: 30
      })
    })

    it('should validate with enum types', async () => {
      const query = (await import('../index.js')).default

      const settingsService = {
        async updateTheme(args) {
          return {
            theme: args.theme,
            updated: true
          }
        }
      }

      // Service validation with enum
      settingsService.updateTheme._validators = {
        precheck: {
          theme: ['enum', ['light', 'dark', 'auto']]
        }
      }

      const config = {
        services: {settingsService},
        queries: {
          result: ['settingsService:updateTheme', {theme: 'dark'}]
        }
      }

      const result = await query(config)
      assert.deepStrictEqual(result.result, {theme: 'dark', updated: true})

      // Test invalid enum value
      const invalidConfig = {
        services: {settingsService},
        queries: {
          result: ['settingsService:updateTheme', {theme: 'blue'}]
        }
      }

      await assert.rejects(
        query(invalidConfig),
        /Precheck validation failed/
      )
    })

    it('should validate with regex patterns', async () => {
      const query = (await import('../index.js')).default

      const userService = {
        async validateUsername(args) {
          return {username: args.username, valid: true}
        }
      }

      // Service validation with regex
      userService.validateUsername._validators = {
        precheck: {
          username: ['string', {regex: /^[a-zA-Z0-9_]{3,20}$/}]
        }
      }

      const config = {
        services: {userService},
        queries: {
          result: ['userService:validateUsername', {username: 'valid_user123'}]
        }
      }

      const result = await query(config)
      assert.deepStrictEqual(result.result, {username: 'valid_user123', valid: true})

      // Test invalid username
      const invalidConfig = {
        services: {userService},
        queries: {
          result: ['userService:validateUsername', {username: 'no-dashes'}]
        }
      }

      await assert.rejects(
        query(invalidConfig),
        /Precheck validation failed/
      )
    })

    it('should validate date constraints', async () => {
      const query = (await import('../index.js')).default

      const eventService = {
        async scheduleEvent(args) {
          return {
            scheduled: true,
            date: args.eventDate.toISOString()
          }
        }
      }

      // Service validation requiring future dates
      const minDate = new Date()
      eventService.scheduleEvent._validators = {
        precheck: {
          eventDate: ['date', {min: minDate}]
        }
      }

      const futureDate = new Date()
      futureDate.setDate(futureDate.getDate() + 7)

      const config = {
        services: {eventService},
        queries: {
          result: ['eventService:scheduleEvent', {eventDate: futureDate}]
        }
      }

      const result = await query(config)
      assert.strictEqual(result.result.scheduled, true)

      // Test past date
      const pastDate = new Date()
      pastDate.setDate(pastDate.getDate() - 1)

      const invalidConfig = {
        services: {eventService},
        queries: {
          result: ['eventService:scheduleEvent', {eventDate: pastDate}]
        }
      }

      await assert.rejects(
        query(invalidConfig),
        /Precheck validation failed/
      )
    })
  })
})
