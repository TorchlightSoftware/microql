import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import {z} from 'zod'
import {plan, addressToPath, pathToAddress, serviceFromTable} from '../core.js'
import {describeSchema} from '../types.js'

// A service whose resource takes two calls, to exercise field lettering.
const branch = serviceFromTable({
  '/choose': {
    input: {on: ['target'], pass: [['call', {fromField: 'on'}]], fail: [['call', {fromField: 'on'}]]},
    call: async ({on, pass, fail}) => on ? pass(on) : fail(on)
  },
  '/extract': {
    input: {url: [['type', {fromZod: z.string()}]]},
    output: [['type', {fromZod: z.object({url: z.string(), images: z.array(z.object({src: z.string()})).optional()})}]],
    call: async ({url}) => ({url})
  }
})

const query = {
  given: {baseUrl: 'https://a.example', ids: [1, 2]},
  trigger: {kind: 'schedule', schema: {at: ['string']}},
  services: {branch},
  settings: {catch: ['[util]/template', {failed: true}]},
  phases: {
    categories: ['[branch]/extract', {url: '$given.baseUrl'}],
    listings: [
      ['$given.ids', '[util]/each', {
        as: 'id',
        service: [
          ['[branch]/extract', {url: '$given.baseUrl', '@type': 'Listing'}],
          ['@', '[branch]/choose', {
            pass: ['[util]/template', {id: '@id'}],
            fail: ['[util]/template', {missing: '@id'}],
            catch: ['[util]/template', {error: '@.message'}]
          }]
        ]
      }],
      ['[util]/length', {value: '$categories'}]
    ]
  }
}

describe('plan()', () => {
  it('returns phases, dependencies, columns and root nodes', () => {
    const planned = plan(query, {trigger: {at: 'noon'}})
    assert.deepEqual(planned.columns, [['categories'], ['listings']])
    assert.deepEqual(planned.phases.map(p => [p.name, p.dependencies]), [['categories', []], ['listings', ['categories']]])
    assert.deepEqual(planned.roots.map(r => r.name), ['given', 'trigger'])
    assert.equal(describeSchema(planned.roots[0].type), '{baseUrl: string, ids: array of number}')
    assert.match(planned.queryHash, /^[0-9a-f]{64}$/)
  })

  // [description, Query trigger block, payload, trigger type]
  const triggerTypes = [
    ['the payload\'s own type when one is given', {schema: {at: ['string']}}, {at: 12}, '{at: number}'],
    ['the schema\'s type when no payload is given', {schema: {at: ['string']}}, undefined, '{at: string}'],
    ['any with neither', undefined, undefined, 'any']
  ]

  for (const [description, trigger, payload, type] of triggerTypes) {
    it(`types $trigger as ${description}`, () => {
      const {roots} = plan({...query, trigger}, {trigger: payload})
      assert.equal(describeSchema(roots.find(r => r.name === 'trigger').type), type)
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
      '$listings.@1a2b1', // pass
      '$listings.@1a2e1', // catch: always e
      '$listings.@2',
      'settings.catch.@1'
    ])
    for (const call of calls) assert.match(call.formHash, /^[0-9a-f]{64}$/)
  })

  it('letters catch e, so adding one moves no other address', () => {
    const addresses = (fields) => plan({services: {branch}, phases: {a: ['[branch]/choose', {on: true, ...fields}]}}).calls.map(c => c.address).sort()
    const withoutCatch = {pass: ['[util]/template', {}], fail: ['[util]/template', {}]}
    assert.deepEqual(addresses(withoutCatch), ['$a.@1', '$a.@1a1', '$a.@1b1'])
    assert.deepEqual(addresses({...withoutCatch, catch: ['[util]/template', {}]}), ['$a.@1', '$a.@1a1', '$a.@1b1', '$a.@1e1'])
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
    ['$listings.@1a2b1.id', ['phases', 'listings', 0, 2, 'service', 1, 2, 'pass', 1, 'id']],
    ['$listings.@1a2e1.error', ['phases', 'listings', 0, 2, 'service', 1, 2, 'catch', 1, 'error']],
    ['$listings.@2.value', ['phases', 'listings', 1, 1, 'value']],
    ['settings.catch.@1.failed', ['settings', 'catch', 1, 'failed']]
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
  const described = (types) => mapDescribed(types)

  it('gives each argument its expected and actual type', () => {
    const types = typesOf(query, '$categories.@1')
    assert.deepEqual(described(types.args.url), {expected: 'string', actual: 'string'})
    assert.equal(describeSchema(types.returns), '{url: string, images?: array of {src: string}}')
  })

  it('types @ inside each as one item of the list it iterates (fromList)', () => {
    const types = typesOf(query, '$listings.@1a2b1')
    assert.equal(describeSchema(types.args.id.actual), 'number')
  })

  it('types @ inside choose as all of its target (fromField)', () => {
    const {calls} = plan({
      given: {xs: [1, 2]},
      services: {branch},
      phases: {a: ['$given.xs', '[branch]/choose', {pass: ['[util]/template', {value: '@'}], fail: ['[util]/template', {}]}]}
    })
    assert.equal(describeSchema(calls.find(c => c.address === '$a.@1b1').types.args.value.actual), 'array of number')
  })

  it('types @ as any inside a call field that declares nothing it receives', () => {
    const tally = serviceFromTable({'/reduce': {input: {on: ['target'], service: ['call']}, call: async () => 0}})
    const {calls} = plan({
      given: {xs: [1, 2]},
      services: {branch, tally},
      phases: {a: ['$given.xs', '[tally]/reduce', {service: ['[branch]/extract', {url: '@'}]}]}
    })
    assert.equal(describeSchema(calls.find(c => c.address === '$a.@1a1').types.args.url.actual), 'any')
  })

  it('takes a nested call\'s own declared return type, whatever its input', () => {
    const types = typesOf(query, '$listings.@1a1')
    assert.equal(describeSchema(types.returns), '{url: string, images?: array of {src: string}}')
  })

  it('types a chain step\'s @ as the previous call\'s return', () => {
    const types = typesOf(query, '$listings.@1a2')
    assert.equal(describeSchema(types.args.on.actual), '{url: string, images?: array of {src: string}}')
  })

  it('types catch\'s @ as error data', () => {
    const types = typesOf(query, '$listings.@1a2e1')
    assert.equal(describeSchema(types.args.error.actual), 'string')
  })

  it('types a declared field a call doesn\'t supply as absent: fine when optional, a mismatch when required', () => {
    const {errors} = plan({services: {branch}, phases: {a: ['[branch]/extract', {}], b: ['[util]/filter', {on: ['x'], service: ['[util]/exists', {value: '@'}]}]}})
    assert.deepEqual(errors.map(({address, code}) => ({address, code})), [{address: '$a.@1.url', code: 'type-mismatch'}])
  })

  it('reports a mismatch as an error, kept apart from compile warnings', () => {
    const mismatched = {...query, phases: {a: ['[branch]/extract', {url: '$given.ids'}]}}
    const {errors, warnings} = plan(mismatched)
    assert.deepEqual(errors.map(({address, code, message}) => ({address, code, message})),
      [{address: '$a.@1.url', code: 'type-mismatch', message: '$a.@1.url expects string but receives array of number'}])
    assert.equal(describeSchema(errors[0].expected), 'string')
    assert.equal(describeSchema(errors[0].actual), 'array of number')
    assert.deepEqual(warnings, [])
  })

  it('checks a call field against the return type it declares', () => {
    const {errors} = plan({
      given: {xs: ['a']},
      services: {branch},
      phases: {kept: ['$given.xs', '[util]/filter', {service: ['[branch]/extract', {url: '@'}]}]}
    })
    assert.deepEqual(errors.map(({address, code, message}) => ({address, code, message})),
      [{address: '$kept.@1.service', code: 'type-mismatch', message: '$kept.@1.service expects boolean but receives {url: string, images?: array of {src: string}}'}])
  })

  // [description, phase, its return type]
  const relationships = [
    ['each returns a list of what its call returns (toList)',
      ['$given.urls', '[util]/each', {service: ['[branch]/extract', {url: '@'}]}],
      'array of {url: string, images?: array of {src: string}}'],
    ['flattenEach returns what its call returns, flattened into one list',
      ['$given.groups', '[util]/flattenEach', {service: ['@', '[util]/filter', {service: ['[util]/exists', {value: '@'}]}]}],
      'array of string'],
    ['filter returns the list it was given (fromField)',
      ['$given.urls', '[util]/filter', {service: ['[util]/exists', {value: '@'}]}],
      'array of string'],
    ['a call\'s own postcheck over its declared output',
      ['[branch]/extract', {url: '$given.u', postcheck: {url: ['string']}}],
      '{url: string}'],
    ['each returns what its catch does in place of a failed item',
      ['$given.urls', '[util]/each', {service: ['[branch]/extract', {url: '@'}], catch: ['@err', '[util]/log']}],
      'array of {url: string, images?: array of {src: string}} | error'],
    ['each leaves out the members of its items\' type that fit skip',
      ['$given.urls', '[util]/each', {service: ['[branch]/extract', {url: '@'}], catch: ['@err', '[util]/log'], skip: ['error']}],
      'array of {url: string, images?: array of {src: string}}'],
    ['try returns what its call returns',
      ['$given.u', '[util]/try', {service: ['[branch]/extract', {url: '@'}], catch: ['@err', '[util]/log']}],
      '{url: string, images?: array of {src: string}} | error'],
    ['any where nothing is declared',
      ['[util]/when', {test: true, then: 1, otherwise: 2}],
      'any']
  ]

  for (const [description, phase, returns] of relationships) {
    it(`knows ${description}`, () => {
      const {phases, errors} = plan({given: {u: 'x', urls: ['a', 'b'], groups: [['a'], ['b']]}, services: {branch}, phases: {a: phase}})
      assert.deepEqual(errors, [])
      assert.equal(describeSchema(phases[0].returns), returns)
    })
  }

  it('types the as: name inside a catch as the item whose call failed', () => {
    const {calls} = plan({
      given: {urls: ['a']},
      services: {branch},
      phases: {a: ['$given.urls', '[util]/each', {as: 'url', service: ['[branch]/extract', {url: '@url'}], catch: ['[util]/template', {failed: '@url'}]}]}
    })
    assert.equal(describeSchema(calls.find(c => c.address === '$a.@1e1').types.args.failed.actual), 'string')
  })

  it('types each phase as its steps\' return or the Query catch\'s', () => {
    const {phases} = plan({given: {u: 'x'}, services: {branch}, settings: {catch: ['@err', '[util]/log']}, phases: {a: ['[branch]/extract', {url: '$given.u'}]}})
    assert.equal(describeSchema(phases[0].returns), '{url: string, images?: array of {src: string}} | error')
  })

  it('requires the calls flattenEach holds to return lists', () => {
    const {errors} = plan({given: {urls: ['a']}, services: {branch}, phases: {a: ['$given.urls', '[util]/flattenEach', {service: ['[branch]/extract', {url: '@'}]}]}})
    assert.deepEqual(errors.map(e => e.address), ['$a.@1.service'])
    assert.match(errors[0].message, /expects array of any but receives \{url: string/)
  })

  it('composes sources: an object of the items of a list (toObject of fromList)', () => {
    const index = serviceFromTable({
      '/byId': {input: {on: ['target']}, output: [['type', {toObject: {fromList: 'on'}}]], call: async () => ({})}
    })
    const {phases} = plan({given: {rows: [{id: 'a'}]}, services: {index}, phases: {a: ['$given.rows', '[index]/byId']}})
    assert.equal(describeSchema(phases[0].returns), 'record of {id: string}')
  })

  it('reads a value of an object field (fromObject)', () => {
    const first = serviceFromTable({
      '/any': {input: {on: ['target']}, output: [['type', {fromObject: 'on'}]], call: async ({on}) => Object.values(on)[0]}
    })
    const {phases} = plan({given: {prices: {tea: 2, cake: 3}}, services: {first}, phases: {a: ['$given.prices', '[first]/any']}})
    assert.equal(describeSchema(phases[0].returns), 'number')
  })

  it('falls back to a field\'s declared type when nothing known flows in', () => {
    const names = serviceFromTable({
      '/each': {
        input: {on: ['target', ['type', {fromZod: z.array(z.string())}]], service: [['call', {fromList: 'on'}]]},
        call: async ({on, service}) => Promise.all(on.map(service))
      }
    })
    const {calls} = plan({
      services: {names},
      phases: {a: ['[names]/each', {on: '$trigger.items', service: ['[util]/template', {name: '@'}]}]}
    })
    assert.equal(describeSchema(calls.find(c => c.address === '$a.@1a1').types.args.name.actual), 'string')
  })
})

function mapDescribed({expected, actual}) {
  return {expected: describeSchema(expected), actual: describeSchema(actual)}
}
