/**
 * Unit Tests for Validation System
 * Tests the validation.js functions directly without the query system
 */

import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import {z} from 'zod'
import {parseSchema, validate} from '../validation.js'

describe('Validation Unit Tests', () => {
  describe('Schema Parsing', () => {
    // Data-driven tests for schema parsing
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
          {schema: ['number', 'int'], valid: 5, invalid: 5.5},
          {schema: ['number', {min: 0, max: 100}], valid: 50, invalid: 150}
        ]
      },
      {
        name: 'flat modifier syntax',
        tests: [
          {schema: ['string', 'optional'], valid: undefined, invalid: 123},
          {schema: ['string', 'nullable'], valid: null, invalid: 123},
          {schema: ['string', 'optional', 'nullable'], valid: undefined, invalid: 123},
          {schema: ['string', 'optional', 'nullable'], valid: null, invalid: 123},
          {schema: ['string', 'optional', 'nullable'], valid: 'test', invalid: 123},
          {schema: ['number', 'positive', 'optional'], valid: undefined, invalid: -5},
          {schema: ['number', 'positive', 'optional'], valid: 5, invalid: -5},
          {schema: ['number', 'int', 'nullable'], valid: null, invalid: 5.5},
          {schema: ['number', 'int', 'nullable'], valid: 5, invalid: 5.5}
        ]
      },
      {
        name: 'structural wrappers',
        tests: [
          {schema: ['array', ['string']], valid: ['a', 'b'], invalid: [1, 2]},
          {schema: ['enum', ['red', 'blue', 'green']], valid: 'red', invalid: 'yellow'},
          {schema: ['union', ['string'], ['number']], valid: 'hello', invalid: true},
          {schema: ['union', ['string'], ['number']], valid: 42, invalid: true},
          {schema: ['tuple', ['string'], ['number']], valid: ['hello', 42], invalid: [42, 'hello']}
        ]
      },
      {
        name: 'structural wrappers with modifiers',
        tests: [
          {schema: ['array', ['string'], 'optional'], valid: undefined, invalid: 'not-array'},
          {schema: ['array', ['string'], 'optional'], valid: ['test'], invalid: 'not-array'},
          {schema: ['array', ['string'], 'nullable'], valid: null, invalid: 'not-array'},
          {schema: ['array', ['string'], 'nullable'], valid: ['test'], invalid: 'not-array'},
          {schema: ['object', {name: ['string']}, 'optional'], valid: undefined, invalid: 'not-object'},
          {schema: ['object', {name: ['string']}, 'nullable'], valid: null, invalid: 'not-object'},
          {schema: ['enum', ['red', 'green', 'blue'], 'optional'], valid: undefined, invalid: 'yellow'},
          {schema: ['union', ['string'], ['number'], 'nullable'], valid: null, invalid: true}
        ]
      },
      {
        name: 'array constraint flexibility',
        tests: [
          {schema: ['array', ['string'], {min: 2}], valid: ['a', 'b'], invalid: ['a']},
          {schema: ['array', ['string'], 'optional', {min: 2}], valid: undefined, invalid: ['a']},
          {schema: ['array', ['string'], 'optional', {min: 2}], valid: ['a', 'b'], invalid: ['a']},
          {schema: ['array', ['string'], {min: 2}, 'optional'], valid: undefined, invalid: ['a']},
          {schema: ['array', ['string'], {min: 2}, 'optional'], valid: ['a', 'b'], invalid: ['a']},
          {schema: ['array', ['string'], 'optional', {min: 2}, 'nullable'], valid: undefined, invalid: ['a']},
          {schema: ['array', ['string'], 'optional', {min: 2}, 'nullable'], valid: null, invalid: ['a']},
          {schema: ['array', ['string'], 'optional', {min: 2}, 'nullable'], valid: ['a', 'b'], invalid: ['a']}
        ]
      },
      {
        name: 'comprehensive array constraints',
        tests: [
          {schema: ['array', ['string'], {max: 3}], valid: ['a', 'b'], invalid: ['a', 'b', 'c', 'd']},
          {schema: ['array', ['string'], {length: 2}], valid: ['a', 'b'], invalid: ['a']},
          {schema: ['array', ['string'], {min: 1, max: 3}], valid: ['a', 'b'], invalid: []},
          {schema: ['array', ['string'], {nonempty: true}], valid: ['a'], invalid: []}
        ]
      },
      {
        name: 'nested structural types',
        tests: [
          {schema: ['array', ['object', {name: ['string']}]], valid: [{name: 'test'}], invalid: [{}]},
          {schema: ['object', {items: ['array', ['string']]}], valid: {items: ['a', 'b']}, invalid: {items: [1, 2]}},
          {schema: ['union', ['array', ['string']], ['string']], valid: ['a'], invalid: 123},
          {schema: ['union', ['array', ['string']], ['string']], valid: 'hello', invalid: 123}
        ]
      },
      {
        name: 'direct zod schemas',
        tests: [
          {schema: z.string().min(5), valid: 'hello', invalid: 'hi'},
          {schema: {name: ['string'], email: z.string().email()}, valid: {name: 'John', email: 'test@example.com'}, invalid: {name: 'John', email: 'invalid'}}
        ]
      }
    ]

    schemaTests.forEach(category => {
      describe(category.name, () => {
        category.tests.forEach(test => {
          it(`should parse ${JSON.stringify(test.schema)}`, () => {
            const schema = parseSchema(test.schema)

            // Test valid input
            const validResult = schema.safeParse(test.valid)
            assert.strictEqual(validResult.success, true)

            // Test invalid input
            const invalidResult = schema.safeParse(test.invalid)
            assert.strictEqual(invalidResult.success, false)
          })
        })
      })
    })

    it('should parse object schemas', () => {
      const schema = parseSchema({
        name: ['string'],
        age: ['number', 'positive']
      })

      const validResult = schema.safeParse({name: 'John', age: 25})
      assert.strictEqual(validResult.success, true)

      const invalidResult = schema.safeParse({name: 'John', age: -5})
      assert.strictEqual(invalidResult.success, false)
    })

    it('should parse tuple types', () => {
      const schema = parseSchema(['tuple', ['string'], ['number']])

      const validResult = schema.safeParse(['hello', 42])
      assert.strictEqual(validResult.success, true)

      const invalidResult = schema.safeParse([42, 'hello'])
      assert.strictEqual(invalidResult.success, false)
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
          error: /Invalid email/
        }
      }
    ]

    validationTests.forEach(test => {
      it(`should handle ${test.name}`, () => {
        const schema = parseSchema(test.schema)

        // Should not throw for valid data
        assert.doesNotThrow(() => validate(schema, test.valid))

        // Should throw for invalid data
        assert.throws(
          () => validate(schema, test.invalid.value),
          test.invalid.error
        )
      })
    })
  })

  describe('Error Path Validation', () => {
    it('should reject enum with empty array when validateDescriptor=true', () => {
      assert.throws(
        () => parseSchema(['enum', []]),
        /Enum must have an array of values|Invalid option: expected one of/
      )
    })

    it('should reject unknown type when validateDescriptor=true', () => {
      assert.throws(
        () => parseSchema(['unknowntype']),
        /Invalid option: expected one of/
      )
    })

    it('should handle unknown type when validateDescriptor=false', () => {
      assert.throws(
        () => parseSchema(['unknowntype'], false),
        /Did you turn off schema validation\? Unknown type: unknowntype/
      )
    })

    it('should handle valid enum with validateDescriptor=false', () => {
      const schema = parseSchema(['enum', ['red', 'blue']], false)
      const validResult = schema.safeParse('red')
      assert.strictEqual(validResult.success, true)

      const invalidResult = schema.safeParse('yellow')
      assert.strictEqual(invalidResult.success, false)
    })

    it('should handle valid primitive type with validateDescriptor=false', () => {
      const schema = parseSchema(['string'], false)
      const validResult = schema.safeParse('hello')
      assert.strictEqual(validResult.success, true)

      const invalidResult = schema.safeParse(123)
      assert.strictEqual(invalidResult.success, false)
    })
  })
})
