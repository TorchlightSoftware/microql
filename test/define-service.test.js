import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import {defineService} from '../define-service.js'

const parts = (method, resource) => ({method, service: 'shop', resource, local: false})

describe('defineService', () => {
  const shop = defineService({
    '/total': {description: 'Sum the prices', input: {on: ['target']}, call: async ({on}) => on.reduce((a, b) => a + b, 0)},
    '/ping': async () => 'pong',
    '/orders': {
      GET: async () => ['o1'],
      POST: {description: 'Place an order', call: async ({item}) => `placed ${item}`}
    }
  })

  // [description, key parts, what call() returns]
  const answered = [
    ['a verbless operation', parts(null, '/total'), [[1, 2]], 3],
    ['a bare function, as an operation with no declaration', parts(null, '/ping'), [{}], 'pong'],
    ['one verb of a resource', parts('GET', '/orders'), [{}], ['o1']],
    ['another verb of the same resource', parts('POST', '/orders'), [{item: 'tea'}], 'placed tea']
  ]

  for (const [description, keyParts, [args], expected] of answered) {
    it(`looks up ${description}`, async () => {
      const operation = shop.lookup(keyParts)
      assert.deepEqual(await operation.call(Array.isArray(args) ? {on: args} : args), expected)
    })
  }

  it('answers nothing for a resource it lacks', () => {
    assert.equal(shop.lookup(parts(null, '/missing')), undefined)
  })

  // [description, key parts, error]
  const refused = [
    ['a verb on a verbless operation', parts('GET', '/total'), /\[shop\]\/total takes no verb; got GET/],
    ['no verb on a resource that needs one', parts(null, '/orders'), /\[shop\]\/orders needs a verb: GET, POST/],
    ['a verb the resource lacks', parts('DELETE', '/orders'), /\[shop\]\/orders doesn't answer DELETE \(answers GET, POST\)/]
  ]

  for (const [description, keyParts, error] of refused) {
    it(`refuses ${description}`, () => {
      assert.throws(() => shop.lookup(keyParts), error)
    })
  }

  it('lists every operation with its resource and verb', () => {
    const listed = shop.operations().map(({resource, method, description}) => ({resource, method, description}))
    assert.deepEqual(listed, [
      {resource: '/total', method: null, description: 'Sum the prices'},
      {resource: '/ping', method: null, description: undefined},
      {resource: '/orders', method: 'GET', description: undefined},
      {resource: '/orders', method: 'POST', description: 'Place an order'}
    ])
  })

  it('returns the same operation on every lookup', () => {
    assert.equal(shop.lookup(parts(null, '/total')), shop.lookup(parts(null, '/total')))
  })

  it('calls operations and lifecycle hooks with the service definition as this', async () => {
    const serviceDefinition = {
      init(runtime) { this.runtime = runtime },
      async tearDown() { this.closed = true },
      async '/whoami'() { return this.runtime.name }
    }
    const service = defineService(serviceDefinition)
    await service.init({name: 'node'})
    assert.equal(await service.lookup(parts(null, '/whoami')).call({}), 'node')
    await service.tearDown()
    assert.equal(serviceDefinition.closed, true)
  })

  it('has no lifecycle hooks the service definition lacks', () => {
    assert.equal(shop.init, undefined)
    assert.equal(shop.tearDown, undefined)
  })
})
