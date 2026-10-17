import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import {defineService} from '../define-service.js'

// A service key's fields, as core hands them to a service.
const keyOf = (method, resource, confined = false) => ({method, service: 'shop', resource, confined})

describe('defineService', () => {
  const shop = defineService({
    '/total': {description: 'Sum the prices', input: {on: ['any', 'optional', {tags: ['target']}]}, call: async ({on}) => on.reduce((a, b) => a + b, 0)},
    '/ping': async () => 'pong',
    '/orders': {
      GET: async () => ['o1'],
      POST: {description: 'Place an order', call: async ({item}) => `placed ${item}`}
    }
  })

  // [description, key, fields, what call() returns]
  const answered = [
    ['a service call with no method', keyOf(null, '/total'), {on: [1, 2]}, 3],
    ['a bare function, as a service call with no declaration', keyOf(null, '/ping'), {}, 'pong'],
    ['one method of a resource', keyOf('GET', '/orders'), {}, ['o1']],
    ['another method of the same resource', keyOf('POST', '/orders'), {item: 'tea'}, 'placed tea']
  ]

  for (const [description, key, fields, expected] of answered) {
    it(`calls ${description}`, async () => {
      const instance = await shop.init({})
      assert.deepEqual(await instance.call({...key, fields}), expected)
    })
  }

  // [description, key, its declaration]
  const declared = [
    ['a declared service call', keyOf(null, '/total'), {description: 'Sum the prices', input: {on: ['any', 'optional', {tags: ['target']}]}}],
    ['a bare function, as an empty declaration', keyOf(null, '/ping'), {}],
    ['one method of a resource', keyOf('POST', '/orders'), {description: 'Place an order'}]
  ]

  for (const [description, key, declaration] of declared) {
    it(`looks up ${description}`, () => {
      assert.deepEqual(shop.lookup(key), declaration)
    })
  }

  // [description, key, the refusal]
  const refused = [
    ['a resource it lacks', keyOf(null, '/missing'), /\[shop\]\/missing is not a resource of this service/],
    ['a method on a service call that takes none', keyOf('GET', '/total'), /\[shop\]\/total takes no method; got GET/],
    ['no method on a resource that needs one', keyOf(null, '/orders'), /\[shop\]\/orders needs a method: GET, POST/],
    ['a method the resource lacks', keyOf('DELETE', '/orders'), /\[shop\]\/orders doesn't answer DELETE \(answers GET, POST\)/],
    ['a confined key, on a service that isn\'t confined', keyOf(null, '/total', true), /\[@shop\]\/total is confined, and this service answers no confined calls/]
  ]

  for (const [description, key, error] of refused) {
    it(`refuses to look up ${description}`, () => {
      assert.throws(() => shop.lookup(key), error)
    })

    it(`refuses to call ${description}`, async () => {
      const instance = await shop.init({})
      await assert.rejects(instance.call({...key, fields: {}}), error)
    })
  }

  describe('a confined service', () => {
    const vault = defineService({confined: true, '/secret': async () => 'kept'})

    it('answers a confined key', async () => {
      const instance = await vault.init({})
      assert.equal(await instance.call({...keyOf(null, '/secret', true), fields: {}}), 'kept')
    })

    it('refuses a key that isn\'t confined', () => {
      assert.throws(() => vault.lookup(keyOf(null, '/secret')), /\[shop\]\/secret isn't confined, and this service answers only confined calls: \[@shop\]\/secret/)
    })
  })

  it('carries the definition\'s config declaration and requires', () => {
    const configured = defineService({config: {vault: ['string']}, requires: ['log'], async '/x'() {}})
    assert.deepEqual([configured.config, configured.requires], [{vault: ['string']}, ['log']])
  })

  it('lists every supported call with its resource, method and declaration, and no call', () => {
    assert.deepEqual(shop.supportedCalls(), [
      {method: null, resource: '/total', description: 'Sum the prices', input: {on: ['any', 'optional', {tags: ['target']}]}},
      {method: null, resource: '/ping'},
      {method: 'GET', resource: '/orders'},
      {method: 'POST', resource: '/orders', description: 'Place an order'}
    ])
  })

  describe('instances', () => {
    // A definition whose instances keep the runtime they were made with.
    const serviceDefinition = {
      init(runtime) { this.runtime = runtime },
      async tearDown() { this.closed = true },
      async '/whoami'() { return this.runtime.name },
      async '/closed'() { return Boolean(this.closed) }
    }
    const service = defineService(serviceDefinition)
    const whoami = {...keyOf(null, '/whoami'), fields: {}}

    it('makes service calls and runs the definition\'s hooks with the instance as this', async () => {
      const instance = await service.init({name: 'node'})
      assert.equal(await instance.call(whoami), 'node')
      await instance.tearDown()
      assert.equal(await instance.call({...keyOf(null, '/closed'), fields: {}}), true)
    })

    it('keeps each instance to the runtime it was made with, leaving the definition untouched', async () => {
      const [one, other] = await Promise.all([service.init({name: 'one'}), service.init({name: 'other'})])
      assert.deepEqual([await one.call(whoami), await other.call(whoami)], ['one', 'other'])
      assert.equal(Object.hasOwn(serviceDefinition, 'runtime'), false)
    })

    it('gives an instance no tearDown when the definition has none', async () => {
      const instance = await shop.init({})
      assert.equal(instance.tearDown, undefined)
    })
  })
})
