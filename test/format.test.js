import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import {format} from '../format.js'

describe('format', () => {
  // [description, value, options, text]
  const cases = [
    ['a string on its own, as it is', 'hello', {}, 'hello'],
    ['a string inside a structure, quoted', {name: 'Ada'}, {}, '{name: "Ada"}'],
    ['a number, a boolean, null and undefined', [1, true, null, undefined], {}, '[1, true, null, undefined]'],
    ['a date, as ISO', new Date('2026-10-12T00:00:00Z'), {}, '2026-10-12T00:00:00.000Z'],
    ['a key that isn\'t an identifier, quoted', {'build-status': 'scraped'}, {}, '{"build-status": "scraped"}'],
    ['hidden fields left out', {name: 'Ada', _secret: 'x'}, {}, '{name: "Ada"}'],
    ['a function, by kind', {run: () => 1}, {}, '{run: [Function]}'],
    ['nesting past depth, by kind', {a: {b: {c: {d: 1}}}}, {depth: 1}, '{a: {b: [Object]}}'],
    ['a list past maxArrayLength, with a count', [1, 2, 3], {maxArrayLength: 2}, '[1, 2, ... 1 more items]'],
    ['a string past maxStringLength, with a count', 'abcdef', {maxStringLength: 3}, 'abc... 3 more characters'],
    ['a long structure, one entry per line',
      {first: 'a'.repeat(40), second: 'b'.repeat(40)},
      {},
      `{\n  first: "${'a'.repeat(40)}",\n  second: "${'b'.repeat(40)}"\n}`],
    ['error data, as name: message, then its args and cause',
      {'@type': 'Error', name: 'Error', message: 'outer', args: {id: 1}, cause: {'@type': 'Error', name: 'TypeError', message: 'inner'}},
      {},
      'Error: outer\n  args: {id: 1}\n  cause: TypeError: inner'],
    ['a thrown Error, as its data', new Error('live'), {}, 'Error: live'],
    ['options left undefined, as the defaults', {a: {b: {c: {d: 1}}}}, {depth: undefined}, '{a: {b: {c: [Object]}}}']
  ]

  for (const [description, value, options, text] of cases) {
    it(`shows ${description}`, () => {
      assert.equal(format(value, options), text)
    })
  }
})
