import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import {ERRORS, errorOf, locate, reasonOf, isCatalogued} from '../src/common/error-catalog.js'

const HTTP_STATUSES = [400, 404, 405, 422, 500, 501, 502, 504]

describe('the error catalog', () => {
  for (const [code, {status}] of Object.entries(ERRORS)) {
    it(`gives ${code} an HTTP status`, () => assert.ok(HTTP_STATUSES.includes(status)))
  }
})

describe('errorOf', () => {
  // [code, details, where, what the error carries]
  const errors = [
    ['unknown-service',
      {service: 'nope'},
      undefined,
      {code: 'unknown-service', status: 404, service: 'nope', baseMessage: 'Service \'nope\' is not registered in this scope.', message: 'Service \'nope\' is not registered in this scope.'}],
    ['missing-run-state',
      {},
      'execute:',
      {code: 'missing-run-state', status: 500, baseMessage: 'execute: \'scope.run\' does not contain a valid RunState.', message: 'execute: \'scope.run\' does not contain a valid RunState.'}],
    ['retired-key',
      {retired: 'onError', replacement: 'Use catch:.'},
      '[$a.@1]',
      {code: 'retired-key', status: 400, retired: 'onError', replacement: 'Use catch:.', hint: 'Use catch:.', baseMessage: '[$a.@1] \'onError\' is retired.', message: '[$a.@1] \'onError\' is retired.\n\nUse catch:.'}]
  ]

  for (const [code, details, where, carries] of errors) {
    it(`makes ${code}${where ? ` at ${where}` : ''}`, () => {
      const error = errorOf(code, details, {where})
      assert.ok(error instanceof Error)
      assert.deepEqual({...error, message: error.message}, carries)
    })
  }

  it('keeps the error behind it as its cause, and gives that cause\'s hint when it has none of its own', () => {
    const cause = errorOf('multiple-targets', {paths: ['a', 'b']})
    const error = errorOf('malformed-declaration', {key: '[x]/y', reason: reasonOf(cause)}, {cause})
    assert.equal(error.cause, cause)
    assert.equal(error.message, 'The declaration of [x]/y is malformed: Fields \'a\', \'b\' are each tagged target.\n\nOnly one field can be the target.')
  })
})

describe('locate', () => {
  it('places a catalogued error, before its hint', () => {
    const error = locate(errorOf('misplaced-catch', {key: '[x]/y'}), '[$a.@1]')
    assert.equal(error.baseMessage, '[$a.@1] catch: handles failures of the calls a call holds, but [x]/y holds none.')
    assert.equal(error.message, `${error.baseMessage}\n\nTo catch a single call, hold it in [util]/try.`)
  })

  it('places an error MicroQL didn\'t raise, giving it a base message', () => {
    const error = locate(new Error('Service failed'), '[$a.@1 - [x]/y]')
    assert.deepEqual({message: error.message, baseMessage: error.baseMessage}, {message: '[$a.@1 - [x]/y] Service failed', baseMessage: '[$a.@1 - [x]/y] Service failed'})
  })
})

describe('isCatalogued', () => {
  // [error, whether MicroQL raised it]
  const errors = [
    [errorOf('timeout', {timeout: 5}), true],
    [new Error('Service failed'), false],
    [Object.assign(new Error('no such file'), {code: 'ENOENT'}), false],
    ['a string', false]
  ]

  for (const [error, catalogued] of errors) {
    it(`${catalogued ? 'knows' : 'doesn\'t know'} ${error.code ?? error.message ?? error}`, () => assert.equal(isCatalogued(error), catalogued))
  }
})
