import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import {z} from 'zod'
import {any, isAny, schemaOfValue, schemaAtPath, elementOf, valueOf, compare, describeSchema, eitherOf, without} from '../types.js'
import {errorSchema} from '../errors.js'

describe('describeSchema', () => {
  // [schema, description]
  const cases = [
    [z.string(), 'string'],
    [z.string().email(), 'string'],
    [z.enum(['a', 'b']), 'enum (a | b)'],
    [z.literal('x'), 'literal "x"'],
    [z.number().int(), 'number'],
    [z.literal(3), 'literal 3'],
    [z.boolean(), 'boolean'],
    [z.date(), 'date'],
    [z.any(), 'any'],
    [z.unknown(), 'unknown'],
    [z.union([z.string(), z.number()]), 'string | number'],
    [z.array(z.number()), 'array of number'],
    [z.object({a: z.string(), b: z.number().optional()}), '{a: string, b?: number}'],
    [z.record(z.string(), z.number()), 'record of number'],
    [z.string().optional(), 'string (optional)'],
    [z.string().nullable(), 'string (nullable)'],
    [z.string().default('x'), 'string']
  ]

  for (const [schema, description] of cases) {
    it(`${schema.def.type} → ${description}`, () => {
      assert.equal(describeSchema(schema), description)
    })
  }
})

describe('schemaOfValue', () => {
  // [value, description of its schema]
  const cases = [
    ['hi', 'string'],
    [3, 'number'],
    [false, 'boolean'],
    [new Date(), 'date'],
    [[1, 2], 'array of number'],
    [[{a: 1}, {a: 2}], 'array of {a: number}'],
    [[1, 'a'], 'array of any'],
    [[], 'array of any'],
    [{a: 1, b: ['x']}, '{a: number, b: array of string}'],
    [null, 'any'],
    [undefined, 'any']
  ]

  for (const [value, description] of cases) {
    it(`${JSON.stringify(value)} → ${description}`, () => {
      assert.equal(describeSchema(schemaOfValue(value)), description)
    })
  }

  it('checks what it describes', () => {
    assert.equal(schemaOfValue({a: [1]}).safeParse({a: [2]}).success, true)
    assert.equal(schemaOfValue({a: [1]}).safeParse({a: ['x']}).success, false)
  })
})

describe('walking into schemas', () => {
  const listing = z.object({images: z.array(z.object({src: z.string().url()})).optional(), tags: z.record(z.string(), z.boolean())})

  // [description, walk, the schema found]
  const cases = [
    ['the root', () => schemaAtPath(listing, []), listing],
    ['through an optional list to a field', () => schemaAtPath(listing, ['images', '0', 'src']), listing.shape.images.unwrap().element.shape.src],
    ['into a record', () => schemaAtPath(listing, ['tags', 'new']), listing.shape.tags.def.valueType],
    ['to a missing field', () => schemaAtPath(listing, ['missing']), any],
    ['into a scalar', () => schemaAtPath(z.string(), ['length']), any],
    ['a list\'s item', () => elementOf(listing.shape.images), listing.shape.images.unwrap().element],
    ['the item of something that isn\'t a list', () => elementOf(z.string()), any],
    ['a record\'s value', () => valueOf(listing.shape.tags), listing.shape.tags.def.valueType]
  ]

  for (const [description, walk, expected] of cases) {
    it(`finds ${description}`, () => {
      assert.equal(walk(), expected)
    })
  }

  it('takes an object\'s value as the type all its fields share', () => {
    assert.equal(describeSchema(valueOf(z.object({a: z.number(), b: z.number()}))), 'number')
  })

  it('takes a union\'s path as any', () => {
    assert.equal(schemaAtPath(z.union([z.object({a: z.string()}), z.number()]), ['a']), any)
  })

  it('takes an object\'s value as any of its fields\' types when they differ', () => {
    const value = valueOf(z.object({a: z.number(), b: z.string()}))
    assert.equal(value.safeParse(1).success && value.safeParse('x').success && !value.safeParse(true).success, true)
  })
})

describe('isAny', () => {
  for (const [schema, expected] of [[any, true], [z.unknown(), true], [z.any().optional(), true], [z.string(), false]]) {
    it(`${describeSchema(schema)} is ${expected ? '' : 'not '}any`, () => {
      assert.equal(isAny(schema), expected)
    })
  }
})

// How an actual type fits an expected one: the issues, each with its code and
// the path inside the value where it is. No issues means it fits.
describe('compare', () => {
  const fits = []
  const at = (code, ...path) => [{code, path}]

  // [description, expected, actual, issues]
  const cases = [
    ['the same type', z.string(), z.string(), fits],
    ['a refinement of it', z.string(), z.string().email(), fits],
    ['different types', z.string(), z.number(), at('type-mismatch')],
    ['anything, into any', z.any(), z.number(), fits],
    ['anything, into unknown', z.unknown(), z.number(), fits],
    ['any, into a type', z.number(), z.any(), at('type-narrowing')],
    ['an optional value, into a required field', z.string(), z.string().optional(), at('maybe-missing')],
    ['a nullable value, into a required field', z.string(), z.string().nullable(), at('maybe-missing')],
    ['a required value, into an optional field', z.string().optional(), z.string(), fits],
    ['a literal, into its base type', z.number(), z.literal(3), fits],
    ['an enum, into string', z.string(), z.enum(['a']), fits],
    ['a narrower enum, into an enum', z.enum(['a', 'b']), z.enum(['a']), fits],
    ['a wider enum, into an enum', z.enum(['a']), z.enum(['a', 'b']), at('type-mismatch')],
    ['a string, into an enum', z.enum(['a']), z.string(), at('type-narrowing')],
    ['a literal in the enum', z.enum(['a', 'b']), z.literal('a'), fits],
    ['arrays of the same items', z.array(z.string()), z.array(z.string()), fits],
    ['arrays of different items', z.array(z.string()), z.array(z.number()), at('type-mismatch', '*')],
    ['a scalar, into an array', z.array(z.string()), z.string(), at('type-mismatch')],
    ['an object with the expected fields, and more', z.object({a: z.string()}), z.object({a: z.string(), b: z.number()}), fits],
    ['an object with a field of the wrong type', z.object({a: z.string()}), z.object({a: z.number()}), at('type-mismatch', 'a')],
    ['an object lacking a required field', z.object({a: z.string()}), z.object({}), at('type-mismatch', 'a')],
    ['an object lacking an optional field', z.object({a: z.string().optional()}), z.object({}), fits],
    ['an object whose field may be missing', z.object({a: z.string()}), z.object({a: z.string().optional()}), at('maybe-missing', 'a')],
    ['nested objects', z.object({a: z.object({b: z.string()})}), z.object({a: z.object({b: z.number()})}), at('type-mismatch', 'a', 'b')],
    ['a record, into an object', z.object({a: z.string()}), z.record(z.string(), z.string()), at('maybe-missing', 'a')],
    ['an object, into a record', z.record(z.string(), z.number()), z.object({a: z.number(), b: z.string()}), at('type-mismatch', 'b')],
    ['records of the same values', z.record(z.string(), z.number()), z.record(z.string(), z.number()), fits],
    ['what fits one member, into a union', z.union([z.string(), z.number()]), z.number(), fits],
    ['what fits no member, into a union', z.union([z.string(), z.number()]), z.boolean(), at('type-mismatch')],
    ['a union whose members all fit', z.string(), z.union([z.literal('a'), z.literal('b')]), fits],
    ['a union with a member that doesn\'t fit', z.string(), z.union([z.string(), z.number()]), at('type-mismatch')],
    ['dates', z.date(), z.date(), fits],
    ['nothing, into an optional field', z.string().optional(), z.undefined(), fits],
    ['nothing, into a required field', z.string(), z.undefined(), at('type-mismatch')]
  ]

  for (const [description, expected, actual, issues] of cases) {
    it(`${description}: ${issues.length ? issues.map(i => i.code).join(', ') : 'fits'}`, () => {
      assert.deepEqual(compare(expected, actual).map(({code, path}) => ({code, path})), issues)
    })
  }

  it('gives each issue the expected and actual types where it is', () => {
    const [issue] = compare(z.object({a: z.string()}), z.object({a: z.number()}))
    assert.equal(describeSchema(issue.expected), 'string')
    assert.equal(describeSchema(issue.actual), 'number')
  })
})

describe('eitherOf', () => {
  // [description, one, other, the union described]
  const cases = [
    ['joins two schemas', z.string(), z.number(), 'string | number'],
    ['flattens unions into one', z.union([z.string(), z.number()]), errorSchema, 'string | number | error'],
    ['adds nothing for never, what a call that always throws returns', z.string(), z.never(), 'string'],
    ['is never when both are', z.never(), z.never(), 'never']
  ]

  for (const [description, one, other, union] of cases) {
    it(description, () => {
      assert.equal(describeSchema(eitherOf(one, other)), union)
    })
  }
})

describe('without', () => {
  // [description, schema, removed, what's left]
  const cases = [
    ['removes the members that fit', z.union([z.string(), errorSchema]), errorSchema, 'string'],
    ['removes members fitting any member of a union', z.union([z.string(), z.null(), errorSchema]), z.union([z.null(), errorSchema]), 'string'],
    ['keeps a schema with nothing that fits', z.string(), errorSchema, 'string'],
    ['keeps any, which might be anything', z.union([any, errorSchema]), errorSchema, 'any'],
    ['is never when everything fits', errorSchema, errorSchema, 'never'],
    ['keeps the schema when nothing is removed', z.string(), undefined, 'string']
  ]

  for (const [description, schema, removed, left] of cases) {
    it(description, () => {
      assert.equal(describeSchema(without(schema, removed)), left)
    })
  }
})
