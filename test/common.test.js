import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import {isPlainObject, mapValues, pick, omit, filterObject, getIn, defaults} from '../common.js'

describe('isPlainObject', () => {
  // [value, is plain]
  const cases = [
    [{}, true],
    [{a: 1}, true],
    [Object.create(null), true],
    [JSON.parse('{"a":1}'), true],
    [[], false],
    [null, false],
    ['text', false],
    [new Date(0), false],
    [new Map(), false],
    [new (class Holder {})(), false],
    [Object.create({inherited: true}), false]
  ]

  for (const [value, expected] of cases) {
    it(`${expected ? 'accepts' : 'rejects'} ${Object.prototype.toString.call(value)} ${JSON.stringify(value) ?? ''}`, () => {
      assert.equal(isPlainObject(value), expected)
    })
  }
})

describe('object helpers', () => {
  const source = {a: 1, b: 2, c: undefined}

  // [description, call, expected]
  const cases = [
    ['mapValues maps values with their keys', () => mapValues({a: 1, b: 2}, (v, k) => `${k}${v}`), {a: 'a1', b: 'b2'}],
    ['pick keeps the named keys, in the order named', () => Object.keys(pick(source, ['b', 'a', 'missing'])), ['b', 'a']],
    ['pick keeps a key whose value is undefined', () => 'c' in pick(source, ['c']), true],
    ['omit drops the named keys', () => omit(source, ['a', 'c']), {b: 2}],
    ['filterObject keeps what the test accepts', () => filterObject(source, (v, k) => k !== 'a' && v !== undefined), {b: 2}],
    ['getIn walks a path', () => getIn({a: [{b: 'x'}]}, ['a', '0', 'b']), 'x'],
    ['getIn of an empty path is the value', () => getIn(source, []), source],
    ['getIn through null is undefined', () => getIn({a: null}, ['a', 'b']), undefined],
    ['getIn reads properties of primitives', () => getIn({s: 'abc'}, ['s', 'length']), 3],
    ['defaults: the first defined value wins', () => defaults({a: undefined, b: 1}, {a: 2, b: 3}, {c: 4}), {a: 2, b: 1, c: 4}],
    ['defaults skips missing sources', () => defaults(undefined, {a: 1}, null), {a: 1}]
  ]

  for (const [description, call, expected] of cases) {
    it(description, () => {
      assert.deepEqual(call(), expected)
    })
  }

  it('helpers never mutate their input', () => {
    const input = {a: {nested: 1}, b: 2}
    pick(input, ['a'])
    omit(input, ['a'])
    defaults(input, {c: 3})
    assert.deepEqual(input, {a: {nested: 1}, b: 2})
  })
})
