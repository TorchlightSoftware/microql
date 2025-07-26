/**
 * Unit Tests for Validation System
 * Tests the validation.js functions directly without the query system
 */

import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
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
})