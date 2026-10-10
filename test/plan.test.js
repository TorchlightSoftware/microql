import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import {plan, addressToPath, pathToAddress} from '../index.js'

// A service whose resource takes two services, to exercise field lettering.
const branch = {
  async '/choose'({on, pass, fail}) { return on ? pass(on) : fail(on) },
  async '/extract'({url}) { return {url} }
}
branch['/choose']._argtypes = {on: {argOrder: 0}, pass: {type: 'service'}, fail: {type: 'service'}}
branch['/extract']._validators = {
  precheck: {url: ['string']},
  postcheck: {url: ['string'], images: ['array', {src: ['string']}, 'optional']}
}

const query = {
  given: {baseUrl: 'https://a.example', ids: [1, 2]},
  trigger: {kind: 'schedule', schema: {at: ['string']}},
  services: {branch},
  settings: {onError: ['GET [util]/template', {failed: true}]},
  phases: {
    categories: ['GET [branch]/extract', {url: '$given.baseUrl'}],
    listings: [
      ['$given.ids', 'GET [util]/each', {
        as: 'id',
        service: [
          ['GET [branch]/extract', {url: '$given.baseUrl', '@type': 'Listing'}],
          ['@', 'GET [branch]/choose', {
            pass: ['GET [util]/template', {id: '@id'}],
            fail: ['GET [util]/template', {missing: '@id'}],
            onError: ['GET [util]/template', {error: '@.message'}]
          }]
        ]
      }],
      ['GET [util]/length', {value: '$categories'}]
    ]
  }
}

describe('plan()', () => {
  it('returns phases, dependencies, columns and root nodes', () => {
    const planned = plan(query, {trigger: {at: 'noon'}})
    assert.deepEqual(planned.columns, [['categories'], ['listings']])
    assert.deepEqual(planned.phases.map(p => [p.name, p.dependencies]), [['categories', []], ['listings', ['categories']]])
    assert.deepEqual(planned.roots.map(r => r.name), ['given', 'trigger'])
    assert.deepEqual(Object.keys(planned.roots[0].type.fields), ['baseUrl', 'ids'])
    assert.match(planned.query, /^[0-9a-f]{64}$/)
  })

  // [description, Query trigger block, payload, trigger type]
  const triggerTypes = [
    ['the payload\'s own type when one is given', {schema: {at: ['string']}}, {at: 12}, {type: 'object', fields: {at: {type: 'number'}}}],
    ['the schema\'s type when no payload is given', {schema: {at: ['string']}}, undefined, {type: 'object', fields: {at: {type: 'text'}}}],
    ['mixed with neither', undefined, undefined, {type: 'mixed'}]
  ]

  for (const [description, trigger, payload, type] of triggerTypes) {
    it(`types $trigger as ${description}`, () => {
      const {roots} = plan({...query, trigger}, {trigger: payload})
      assert.deepEqual(roots.find(r => r.name === 'trigger').type, type)
    })
  }

  it('assigns every call an address, a path and a form hash', () => {
    const {calls} = plan(query)
    const addresses = calls.map(call => call.address).sort()
    assert.deepEqual(addresses, [
      '$categories.@1',
      '$listings.@1',
      '$listings.@1a1',
      '$listings.@1a2',
      '$listings.@1a2a1', // fail: letters follow sorted key order
      '$listings.@1a2b1', // onError
      '$listings.@1a2c1', // pass
      '$listings.@2',
      'settings.onError.@1'
    ])
    for (const call of calls) assert.match(call.formHash, /^[0-9a-f]{64}$/)
  })

  it('shows identical calls as two addresses with one form hash', () => {
    const {calls} = plan(query)
    const hashOf = (address) => calls.find(c => c.address === address).formHash
    assert.equal(hashOf('$categories.@1') === hashOf('$listings.@1a1'), false, '@type makes them differ')

    const twin = plan({...query, phases: {a: query.phases.categories, b: query.phases.categories}})
    assert.equal(twin.calls[0].formHash, twin.calls[1].formHash)
  })
})

describe('Service Call Addresses ↔ JSON paths', () => {
  // [address, JSON path within the Query]
  const cases = [
    ['$categories.@1', ['phases', 'categories']],
    ['$categories.@1.url', ['phases', 'categories', 1, 'url']],
    ['$listings.@1', ['phases', 'listings', 0]],
    ['$listings.@1.on', ['phases', 'listings', 0, 0]],
    ['$listings.@1.as', ['phases', 'listings', 0, 2, 'as']],
    ['$listings.@1a1', ['phases', 'listings', 0, 2, 'service', 0]],
    ['$listings.@1a1.@type', ['phases', 'listings', 0, 2, 'service', 0, 1, '@type']],
    ['$listings.@1a2', ['phases', 'listings', 0, 2, 'service', 1]],
    ['$listings.@1a2a1', ['phases', 'listings', 0, 2, 'service', 1, 2, 'fail']],
    ['$listings.@1a2b1.error', ['phases', 'listings', 0, 2, 'service', 1, 2, 'onError', 1, 'error']],
    ['$listings.@1a2c1.id', ['phases', 'listings', 0, 2, 'service', 1, 2, 'pass', 1, 'id']],
    ['$listings.@2.value', ['phases', 'listings', 1, 1, 'value']],
    ['settings.onError.@1.failed', ['settings', 'onError', 1, 'failed']]
  ]

  for (const [address, path] of cases) {
    it(`${address} ↔ ${path.join('/')}`, () => {
      const planned = plan(query)
      assert.deepEqual(addressToPath(planned, address), path)
      assert.equal(pathToAddress(planned, path), address)
    })
  }

  it('finds nothing outside the Query\'s calls', () => {
    const planned = plan(query)
    assert.equal(addressToPath(planned, '$nope.@1'), undefined)
    assert.equal(pathToAddress(planned, ['given', 'baseUrl']), undefined)
  })
})

describe('type inference', () => {
  const typesOf = (q, address) => plan(q).calls.find(c => c.address === address).types

  it('gives each argument its expected and actual type', () => {
    const types = typesOf(query, '$categories.@1')
    assert.deepEqual(types.args.url, {expected: {type: 'text'}, actual: {type: 'text'}})
    assert.deepEqual(types.returns.fields.url, {type: 'text'})
  })

  it('types @ as the item of the iterated list, and paths walk into types', () => {
    const types = typesOf(query, '$listings.@1a2c1')
    assert.deepEqual(types.args.id.actual, {type: 'number'})
  })

  it('types a chain step\'s @ as the previous call\'s return', () => {
    const types = typesOf(query, '$listings.@1a2')
    assert.equal(types.args.on.actual.type, 'object')
    assert.deepEqual(types.args.on.actual.fields.url, {type: 'text'})
  })

  it('types onError\'s @ as an error', () => {
    const types = typesOf(query, '$listings.@1a2b1')
    assert.deepEqual(types.args.error.actual, {type: 'text'})
  })

  it('reports a mismatch as an error, kept apart from compile warnings', () => {
    const mismatched = {...query, phases: {a: ['GET [branch]/extract', {url: '$given.ids'}]}}
    const {errors, warnings} = plan(mismatched)
    assert.deepEqual(errors, [{address: '$a.@1.url', message: '$a.@1.url expects text but receives list of number'}])
    assert.deepEqual(warnings, [])
  })

  it('checks a service position against the return type its argument needs', () => {
    const {errors} = plan({
      given: {xs: ['a']},
      services: {branch},
      phases: {kept: ['$given.xs', 'GET [util]/filter', {service: ['GET [branch]/extract', {url: '@'}]}]}
    })
    assert.deepEqual(errors, [{address: '$kept.@1.service', message: '$kept.@1.service expects boolean but receives object'}])
  })

  // [description, the call's own postcheck, return type]
  const returnTypes = [
    ['the service\'s output schema', undefined, {type: 'object', fields: {url: {type: 'text'}, images: {type: 'list', element: {type: 'object', fields: {src: {type: 'text'}}}, optional: true}}}],
    ['the call\'s own postcheck, when it has one', {url: ['string']}, {type: 'object', fields: {url: {type: 'text'}}}]
  ]

  for (const [description, postcheck, returns] of returnTypes) {
    it(`takes a call's return type from ${description}`, () => {
      const {phases} = plan({given: {u: 'x'}, services: {branch}, phases: {a: ['GET [branch]/extract', {url: '$given.u', postcheck}]}})
      assert.deepEqual(phases[0].returns, returns)
    })
  }

  it('is mixed where nothing is declared', () => {
    const types = typesOf(query, '$listings.@1a2')
    assert.deepEqual(types.returns, {type: 'mixed'})
  })
})
