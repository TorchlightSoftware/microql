import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import {ServiceRegistry, defineService, util} from '../core.js'

const t1 = {tenantId: 't1'}
const t2 = {tenantId: 't2'}
const byTenant = () => new ServiceRegistry({tenantId: ['string']})

// A service, and how many of its instances have been made and torn down.
const counted = () => {
  const counts = {inits: 0, tearDowns: 0}
  counts.service = defineService({
    init() { counts.inits++ },
    async tearDown() { counts.tearDowns++ },
    async '/run'() { return 'ran' }
  })
  return counts
}

// Makes an instance as a runtime would, with an empty env.
const make = (service) => service.init({})

describe('ServiceRegistry', () => {
  describe('services', () => {
    const github = defineService({async '/repos'() { return [] }})

    it('keeps a service by scope and name', () => {
      const services = byTenant()
      services.register(t1, 'github', github)
      assert.equal(services.get(t1, 'github'), github)
      assert.equal(services.get(t2, 'github'), undefined)
    })

    it('has util in every scope, unless another service is registered in its place', () => {
      const services = byTenant()
      services.register(t1, 'util', github)
      assert.deepEqual([services.get(t1, 'util'), services.get(t2, 'util')], [github, util])
    })

    it('lists a scope\'s services by name, util among them', () => {
      const services = byTenant()
      services.register(t1, 'github', github)
      assert.deepEqual(services.list(t1), {util, github})
      assert.deepEqual(services.list(t2), {util})
    })

    it('unregisters a service', () => {
      const services = byTenant()
      services.register(t1, 'github', github)
      services.unregister(t1, 'github')
      assert.equal(services.get(t1, 'github'), undefined)
    })
  })

  describe('instances', () => {
    it('makes one instance per scope and name, on first use, and keeps it', async () => {
      const shop = counted()
      const services = byTenant()
      services.register(t1, 'shop', shop.service)
      services.register(t2, 'shop', shop.service)
      const first = await services.instanceOf(t1, 'shop', make)
      assert.equal(await services.instanceOf(t1, 'shop', make), first)
      await services.instanceOf(t2, 'shop', make)
      assert.equal(shop.inits, 2)
    })

    it('makes one instance for uses that start together', async () => {
      const shop = counted()
      const services = byTenant()
      services.register(t1, 'shop', shop.service)
      await Promise.all([services.instanceOf(t1, 'shop', make), services.instanceOf(t1, 'shop', make)])
      assert.equal(shop.inits, 1)
    })

    it('keeps the instance when the same service is registered again', async () => {
      const shop = counted()
      const services = byTenant()
      services.register(t1, 'shop', shop.service)
      const first = await services.instanceOf(t1, 'shop', make)
      services.register(t1, 'shop', shop.service)
      assert.equal(await services.instanceOf(t1, 'shop', make), first)
    })

    it('releases the instance of a service another has replaced, and makes one of the new service', async () => {
      const [before, after] = [counted(), counted()]
      const services = byTenant()
      services.register(t1, 'shop', before.service)
      await services.instanceOf(t1, 'shop', make)
      services.register(t1, 'shop', after.service)
      await services.instanceOf(t1, 'shop', make)
      assert.deepEqual([before.tearDowns, after.inits], [1, 1])
    })

    it('tries again after a make that fails', async () => {
      const shop = counted()
      const services = byTenant()
      services.register(t1, 'shop', shop.service)
      await assert.rejects(services.instanceOf(t1, 'shop', async () => { throw new Error('not yet') }), /not yet/)
      await services.instanceOf(t1, 'shop', make)
      assert.equal(shop.inits, 1)
    })

    it('refuses an instance of a service the scope doesn\'t have', async () => {
      await assert.rejects(byTenant().instanceOf(t1, 'missing', make), /No service 'missing' in this scope/)
    })

    // [description, what tearDown is given, tearDowns of t1's shop, t1's notes, t2's shop]
    const tearDowns = [
      ['one name\'s instance in a scope', [t1, 'shop'], [1, 0, 0]],
      ['a scope\'s instances', [t1], [1, 1, 0]],
      ['every instance', [], [1, 1, 1]]
    ]

    for (const [description, given, expected] of tearDowns) {
      it(`tears down ${description}, once, and makes fresh ones on next use`, async () => {
        const held = [[t1, 'shop', counted()], [t1, 'notes', counted()], [t2, 'shop', counted()]]
        const services = byTenant()
        for (const [scope, name, {service}] of held) services.register(scope, name, service)
        for (const [scope, name] of held) await services.instanceOf(scope, name, make)
        await services.tearDown(...given)
        await services.tearDown(...given)
        assert.deepEqual(held.map(([, , counts]) => counts.tearDowns), expected)
        await services.instanceOf(t1, 'shop', make)
        assert.equal(held[0][2].inits, 2)
      })
    }
  })
})
