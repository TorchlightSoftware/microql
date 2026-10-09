import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import {z} from 'zod'
import {typeOfSchema, typeOfValue, typeAtPath, satisfies} from '../types.js'

const text = {type: 'text'}
const number = {type: 'number'}
const boolean = {type: 'boolean'}
const mixed = {type: 'mixed'}

describe('typeOfSchema', () => {
  // [schema, seven-type form]
  const cases = [
    [z.string(), text],
    [z.string().email(), text],
    [z.number().int(), number],
    [z.boolean(), boolean],
    [z.date(), {type: 'datetime'}],
    [z.array(z.string()), {type: 'list', element: text}],
    [z.array(z.array(z.number())), {type: 'list', element: {type: 'list', element: number}}],
    [z.object({a: z.string()}), {type: 'object', fields: {a: text}}],
    [z.string().optional(), {type: 'text', optional: true}],
    [z.string().nullable(), {type: 'text', optional: true}],
    [z.string().default('x'), text],
    [z.union([z.string(), z.number()]), mixed],
    [z.any(), mixed],
    [z.unknown(), mixed],
    [z.enum(['a', 'b']), text],
    [z.literal(3), number],
    [undefined, mixed]
  ]

  for (const [schema, expected] of cases) {
    it(`${schema?.def.type ?? 'no schema'} → ${JSON.stringify(expected)}`, () => {
      assert.deepEqual(typeOfSchema(schema), expected)
    })
  }
})

describe('typeOfValue', () => {
  const cases = [
    ['hi', text],
    [3, number],
    [false, boolean],
    [new Date(), {type: 'datetime'}],
    [[1, 2], {type: 'list', element: number}],
    [[1, 'a'], {type: 'list', element: mixed}],
    [[], {type: 'list', element: mixed}],
    [{a: 1}, {type: 'object', fields: {a: number}}],
    [null, {type: 'mixed', optional: true}]
  ]

  for (const [value, expected] of cases) {
    it(`${JSON.stringify(value)} → ${JSON.stringify(expected)}`, () => {
      assert.deepEqual(typeOfValue(value), expected)
    })
  }
})

describe('typeAtPath', () => {
  const listing = {type: 'object', fields: {images: {type: 'list', element: {type: 'object', fields: {src: text}}}}}
  const cases = [
    [listing, [], listing],
    [listing, ['images', '0', 'src'], text],
    [listing, ['missing'], mixed],
    [mixed, ['anything'], mixed],
    [text, ['length'], mixed]
  ]

  for (const [type, path, expected] of cases) {
    it(`walks ${path.join('.') || '(root)'}`, () => {
      assert.deepEqual(typeAtPath(type, path), expected)
    })
  }
})

describe('satisfies', () => {
  // [expected, actual, satisfied]
  const cases = [
    [text, text, true],
    [text, number, false],
    [mixed, number, true],
    [number, mixed, true],
    [{type: 'list', element: text}, {type: 'list', element: text}, true],
    [{type: 'list', element: text}, {type: 'list', element: number}, false],
    [{type: 'list', element: mixed}, {type: 'list', element: number}, true],
    [{type: 'list', element: text}, text, false],
    [{type: 'object', fields: {}}, {type: 'object', fields: {a: text}}, true],
    [{type: 'text', optional: true}, text, true]
  ]

  for (const [expected, actual, satisfied] of cases) {
    it(`${JSON.stringify(actual)} ${satisfied ? 'satisfies' : 'does not satisfy'} ${JSON.stringify(expected)}`, () => {
      assert.equal(satisfies(expected, actual), satisfied)
    })
  }
})
