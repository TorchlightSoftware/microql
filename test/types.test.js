import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import {z} from 'zod'
import {any, isAny, schemaOfValue, schemaAtPath, elementOf, valueOf, compare, describeSchema, union, difference, literalOf, isLiteral, valueOfLiteral, describedBy, pick, merge} from '../types.js'
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
    [z.string().default('x'), 'string'],
    [z.tuple([z.literal('a'), z.number()]), '[literal "a", number]'],
    [z.array(z.union([z.string(), z.number()])), 'array of (string | number)']
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
    ['a loose object not listing a required field, which it may have', z.object({a: z.string()}), z.looseObject({}), at('type-narrowing', 'a')],
    ['an object open to fields of a type, not listing one of it', z.object({a: z.string()}), z.object({}).catchall(z.string()), at('maybe-missing', 'a')],
    ['an object open to fields of another type, not listing one', z.object({a: z.string()}), z.object({}).catchall(z.number()), [{code: 'maybe-missing', path: ['a']}, {code: 'type-mismatch', path: ['a']}]],
    ['a strict object lacking a required field', z.object({a: z.string()}), z.strictObject({}), at('type-mismatch', 'a')],
    ['an object whose field may be missing', z.object({a: z.string()}), z.object({a: z.string().optional()}), at('maybe-missing', 'a')],
    ['nested objects', z.object({a: z.object({b: z.string()})}), z.object({a: z.object({b: z.number()})}), at('type-mismatch', 'a', 'b')],
    ['a record, into an object', z.object({a: z.string()}), z.record(z.string(), z.string()), at('maybe-missing', 'a')],
    ['a record of unknown values, into an object', z.object({a: z.string()}), z.record(z.string(), z.any()), at('type-narrowing', 'a')],
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

describe('union', () => {
  // [description, one, other, the union described]
  const cases = [
    ['joins two schemas', z.string(), z.number(), 'string | number'],
    ['flattens unions into one', z.union([z.string(), z.number()]), errorSchema, 'string | number | error'],
    ['names a type once', z.number(), z.union([z.number(), z.string()]), 'number | string'],
    ['adds nothing for never, what a call that always throws returns', z.string(), z.never(), 'string'],
    ['is never when both are', z.never(), z.never(), 'never']
  ]

  for (const [description, one, other, joined] of cases) {
    it(description, () => {
      assert.equal(describeSchema(union(one, other)), joined)
    })
  }
})

describe('difference', () => {
  // [description, schema, removed, what's left]
  const cases = [
    ['removes the members that fit', z.union([z.string(), errorSchema]), errorSchema, 'string'],
    ['removes members fitting any member of a union', z.union([z.string(), z.null(), errorSchema]), z.union([z.null(), errorSchema]), 'string'],
    ['keeps a schema with nothing that fits', z.string(), errorSchema, 'string'],
    ['keeps any, which might be anything', z.union([any, errorSchema]), errorSchema, 'any'],
    ['is never when everything fits', errorSchema, errorSchema, 'never'],
    ['keeps the schema when nothing is removed (never)', z.string(), z.never(), 'string'],
    ['keeps the schema when what is removed is unknown (any)', z.union([z.string(), errorSchema]), any, 'string | error']
  ]

  for (const [description, schema, removed, left] of cases) {
    it(description, () => {
      assert.equal(describeSchema(difference(schema, removed)), left)
    })
  }
})

describe('literals', () => {
  // [description, value, its literal type described]
  const cases = [
    ['a string', 'name', 'literal "name"'],
    ['a number', 3, 'literal 3'],
    ['null', null, 'literal null'],
    ['nothing', undefined, 'undefined'],
    ['a list, item by item', ['name', 'url'], '[literal "name", literal "url"]'],
    ['an object, field by field', {min: 1}, '{min: literal 1}'],
    ['a value with no literal type, as any', /x/, 'any']
  ]

  for (const [description, value, described] of cases) {
    it(`types ${description}`, () => {
      assert.equal(describeSchema(literalOf(value)), described)
    })
  }

  // [description, value]
  const roundTrips = [
    ['a zodly descriptor', ['union', ['error'], ['null']]],
    ['a descriptor with options', ['array', ['string'], {min: 1}]],
    ['an object descriptor', {name: ['string', 'optional']}]
  ]

  for (const [description, value] of roundTrips) {
    it(`reads back ${description} from its literal type`, () => {
      assert.deepEqual(valueOfLiteral(literalOf(value)), value)
    })
  }

  it('reads back no value from a type that isn\'t a literal', () => {
    assert.equal(isLiteral(z.tuple([z.literal('a'), z.string()])), false)
  })
})

describe('describedBy', () => {
  // [description, literal type, the schema it describes]
  const cases = [
    ['a zodly descriptor\'s schema', literalOf(['error']), 'error'],
    ['nothing, for no descriptor', literalOf(undefined), 'never'],
    ['any, for a descriptor not known before the Run', any, 'any']
  ]

  for (const [description, type, described] of cases) {
    it(`is ${description}`, () => {
      assert.equal(describeSchema(describedBy(type)), described)
    })
  }
})

describe('pick', () => {
  const person = z.object({name: z.string(), age: z.number().optional(), url: z.string()})
  // [description, schema, keys, what's picked]
  const cases = [
    ['keeps the named fields', person, literalOf(['name', 'age']), '{name: string, age?: number}'],
    ['leaves out names the object doesn\'t have', person, literalOf(['name', 'nope']), '{name: string}'],
    ['takes keys as a union of literals, as TypeScript\'s Pick does', person, z.union([z.literal('url'), z.literal('name')]), '{url: string, name: string}'],
    ['picks from each member of a union', z.union([person, z.object({name: z.number()})]), literalOf(['name']), '{name: string} | {name: number}'],
    ['keeps the schema when the keys aren\'t known before the Run', person, z.array(z.string()), '{name: string, age?: number, url: string}'],
    ['keeps any', any, literalOf(['name']), 'any'],
    ['takes a name a loose object may have as unknown, and maybe absent', z.looseObject({name: z.string()}), literalOf(['name', 'href']), '{name: string, href?: unknown}']
  ]

  for (const [description, schema, keys, picked] of cases) {
    it(description, () => {
      assert.equal(describeSchema(pick(schema, keys)), picked)
    })
  }
})

describe('merge', () => {
  // [description, on, with, merged]: what [util]/merge returns, as a type
  const cases = [
    ['adds fields', z.object({a: z.string()}), z.object({b: z.number()}), '{a: string, b: number}'],
    ['merges objects field by field, deeply', z.object({p: z.object({a: z.string()})}), z.object({p: z.object({b: z.number()})}), '{p: {a: string, b: number}}'],
    ['joins lists as a list of either item', z.object({tags: z.array(z.string())}), z.object({tags: z.array(z.number())}), '{tags: array of (string | number)}'],
    ['lets any other value of with win', z.object({a: z.string()}), z.object({a: z.number()}), '{a: number}'],
    ['keeps on\'s value where with\'s may be undefined', z.object({a: z.string()}), z.object({a: z.number().optional()}), '{a: number | string}'],
    ['is on when with is nothing', z.object({a: z.string()}), z.undefined(), '{a: string}'],
    ['is any when on is and with is an object: on may have fields with doesn\'t', any, z.object({a: z.string()}), 'any'],
    ['is with when on is any and with is a value, which wins', any, z.number(), 'number'],
    ['is any when with is', z.object({a: z.string()}), any, 'any'],
    ['keeps on loose, so it may still have fields neither lists', z.looseObject({a: z.string()}), z.object({b: z.number()}), '{a: string, b: number, ...unknown}']
  ]

  for (const [description, on, withSchema, merged] of cases) {
    it(description, () => {
      assert.equal(describeSchema(merge(on, withSchema)), merged)
    })
  }
})
