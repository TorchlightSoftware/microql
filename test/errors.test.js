import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import {isErrorData, toErrorData, fromErrorData} from '../errors.js'

// An Error labelled the way MicroQL labels the call that raised it.
const labelled = (message, fields, options) => Object.assign(new Error(message, options), fields)

describe('errors as data', () => {
  // [description, thrown, its data]
  const cases = [
    ['an Error, by name and message', new Error('broke'), {'@type': 'Error', name: 'Error', message: 'broke'}],
    ['a labelled Error, with its address, key and args',
      labelled('[$a.@1 - [x]/y] broke', {address: '$a.@1', key: '[x]/y', args: {id: 1}}),
      {'@type': 'Error', name: 'Error', message: '[$a.@1 - [x]/y] broke', address: '$a.@1', key: '[x]/y', args: {id: 1}}],
    ['an Error with fields of its own, any of them',
      Object.assign(new Error('broke'), {attempts: 3, status: 503}),
      {'@type': 'Error', name: 'Error', message: 'broke', attempts: 3, status: 503}],
    ['an Error\'s subclass, by its name', new TypeError('not a number'), {'@type': 'Error', name: 'TypeError', message: 'not a number'}],
    ['an Error with a cause, the cause as data too',
      new Error('outer', {cause: new Error('inner')}),
      {'@type': 'Error', name: 'Error', message: 'outer', cause: {'@type': 'Error', name: 'Error', message: 'inner'}}],
    ['anything else thrown, by its text', 'just a string', {'@type': 'Error', name: 'Error', message: 'just a string'}],
    ['error data, as it is', {'@type': 'Error', name: 'Error', message: 'already data'}, {'@type': 'Error', name: 'Error', message: 'already data'}]
  ]

  for (const [description, thrown, data] of cases) {
    it(`turns ${description}`, () => {
      assert.deepEqual(toErrorData(thrown), data)
    })
  }

  it('survives JSON, as the Run State and the Cache keep it', () => {
    const data = toErrorData(labelled('broke', {address: '$a.@1', key: '[x]/y', args: {id: 1}}, {cause: new Error('inner')}))
    assert.deepEqual(JSON.parse(JSON.stringify(data)), data)
  })

  it('turns back into an Error carrying the same fields and cause', () => {
    const error = fromErrorData(toErrorData(labelled('broke', {address: '$a.@1', key: '[x]/y', args: {id: 1}}, {cause: new Error('inner')})))
    assert.ok(error instanceof Error)
    assert.deepEqual({message: error.message, address: error.address, key: error.key, args: error.args, cause: error.cause.message},
      {message: 'broke', address: '$a.@1', key: '[x]/y', args: {id: 1}, cause: 'inner'})
  })

  // [value, whether it is error data]
  const recognised = [
    [{'@type': 'Error', name: 'Error', message: 'm'}, true],
    [{'@type': 'Error', name: 'Error', message: 'm', status: 503, '@id': 'urn:x'}, true],
    [{'@type': 'Error', message: 'm'}, false],
    [{'@type': ['Error'], name: 'Error', message: 'm'}, false],
    [{'@type': 'Organization', name: 'Acme', message: 'hello'}, false],
    [{name: 'Acme', message: 'hello'}, false],
    [new Error('live'), false],
    [null, false]
  ]

  for (const [value, expected] of recognised) {
    it(`${expected ? 'recognises' : 'doesn\'t take'} ${JSON.stringify(value) ?? String(value)} as error data`, () => {
      assert.equal(isErrorData(value), expected)
    })
  }
})
