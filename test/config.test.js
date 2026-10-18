import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import {configSchemaOf, ConfigRegistry, ServiceRegistry, defineService} from '../core.js'
import {tagsOf} from '@tlsft/zodly'

const GITHUB_OAUTH = {authorizeUrl: 'https://github.com/login/oauth/authorize', tokenUrl: 'https://github.com/login/oauth/access_token', scopes: ['repo']}

describe('configSchemaOf', () => {
  it('reads a config declaration as zodly', () => {
    const schema = configSchemaOf({vault: ['string', {min: 1}]})
    assert.equal(schema.safeParse({vault: 'notes'}).success, true)
    assert.equal(schema.safeParse({vault: ''}).success, false)
  })

  describe('the oauth type', () => {
    const schema = configSchemaOf({github: ['oauth', GITHUB_OAUTH]})
    const github = schema.def.shape.github

    it('is tagged oauth, and carries the provider\'s details', () => {
      assert.deepEqual(tagsOf(github), ['oauth'])
      assert.deepEqual(github.meta().oauth, GITHUB_OAUTH)
    })

    it('holds the client and refresh token the runtime files, each tagged internal', () => {
      for (const field of ['clientId', 'clientSecret', 'refreshToken']) {
        assert.deepEqual(tagsOf(github.def.shape[field]), ['internal'], field)
      }
    })

    // [description, value, fits]
    const values = [
      ['nothing yet, before the OAuth flow has run', {github: {}}, true],
      ['what the runtime files after it', {github: {clientId: 'id', clientSecret: 'secret', refreshToken: 'refresh'}}, true],
      ['a refresh token that isn\'t a string', {github: {refreshToken: 1}}, false]
    ]

    for (const [description, value, fits] of values) {
      it(`${fits ? 'accepts' : 'refuses'} ${description}`, () => {
        assert.equal(schema.safeParse(value).success, fits)
      })
    }

    // [description, params, error]
    const malformed = [
      ['no token URL', {authorizeUrl: GITHUB_OAUTH.authorizeUrl}, /tokenUrl/],
      ['a URL that isn\'t one', {...GITHUB_OAUTH, authorizeUrl: 'nope'}, /authorizeUrl/],
      ['no details at all', undefined, /oauth takes \{authorizeUrl, tokenUrl, scopes\}/]
    ]

    for (const [description, params, error] of malformed) {
      it(`refuses an oauth type with ${description}`, () => {
        assert.throws(() => configSchemaOf({github: params === undefined ? ['oauth'] : ['oauth', params]}), error)
      })
    }
  })
})

describe('ConfigRegistry', () => {
  const scope = {tenantId: 't1'}

  // A service whose config declaration takes a vault, and how many of its
  // instances have been made and torn down.
  const vaults = () => {
    const counts = {inits: 0, tearDowns: 0}
    counts.service = defineService({
      config: {vault: ['string', {min: 1}]},
      init() { counts.inits++ },
      async tearDown() { counts.tearDowns++ },
      async '/where'() {}
    })
    return counts
  }

  // A service registry with a vault service registered as 'notes', and a
  // config registry keyed the same.
  function registries(Registry = ConfigRegistry) {
    const notes = vaults()
    const services = new ServiceRegistry({tenantId: ['string']})
    services.register(scope, 'notes', notes.service)
    return {notes, services, config: new Registry(services)}
  }

  const make = (service) => service.init({})

  it('files config that fits its service\'s declaration', async () => {
    const {config} = registries()
    await config.set(scope, 'notes', {vault: '/home/notes'})
    assert.deepEqual(await config.get(scope, 'notes'), {vault: '/home/notes'})
  })

  // [description, name, value, error]
  const refused = [
    ['config that doesn\'t fit', 'notes', {vault: ''}, /Service 'notes' can't use this config:\n/],
    ['config for a service the scope doesn\'t have', 'github', {token: 'a'}, /No service 'github' in this scope to configure/]
  ]

  for (const [description, name, value, error] of refused) {
    it(`refuses ${description}, filing nothing`, async () => {
      const {config} = registries()
      await assert.rejects(config.set(scope, name, value), (thrown) => {
        assert.match(thrown.message, error)
        assert.equal(thrown.code, 'invalid-config')
        return true
      })
      assert.equal(await config.get(scope, name), undefined)
    })
  }

  it('refuses config for a service with a malformed config declaration', async () => {
    const {services, config} = registries()
    services.register(scope, 'broken', defineService({config: {vault: ['nope']}, async '/x'() {}}))
    await assert.rejects(config.set(scope, 'broken', {}), {code: 'invalid-config', message: /Service 'broken' has a malformed config declaration: Unknown type name 'nope'/})
  })

  it('releases the service\'s instance when its config changes, so its next use makes one with the new config', async () => {
    const {notes, services, config} = registries()
    await config.set(scope, 'notes', {vault: 'a'})
    await services.instanceOf(scope, 'notes', make)
    await config.set(scope, 'notes', {vault: 'a'})
    assert.equal(notes.tearDowns, 0, 'the same config again changes nothing')
    await config.set(scope, 'notes', {vault: 'b'})
    await services.instanceOf(scope, 'notes', make)
    assert.deepEqual([notes.tearDowns, notes.inits], [1, 2])
  })

  it('deletes config, releasing the service\'s instance', async () => {
    const {notes, services, config} = registries()
    await config.set(scope, 'notes', {vault: 'a'})
    await services.instanceOf(scope, 'notes', make)
    await config.delete(scope, 'notes')
    assert.equal(await config.get(scope, 'notes'), undefined)
    assert.equal(notes.tearDowns, 1)
  })

  it('keeps config wherever a runtime extending it stores it, checking it as it does in memory', async () => {
    // config kept in a Map of its own, as a runtime would keep it in a database
    class StoredConfig extends ConfigRegistry {
      stored = new Map()
      async get({tenantId}, name) { return this.stored.get(`${tenantId}/${name}`) }
      async write({tenantId}, name, value) { this.stored.set(`${tenantId}/${name}`, value) }
      async erase({tenantId}, name) { this.stored.delete(`${tenantId}/${name}`) }
    }
    const {config} = registries(StoredConfig)
    await config.set(scope, 'notes', {vault: 'a'})
    assert.deepEqual(config.stored.get('t1/notes'), {vault: 'a'})
    await assert.rejects(config.set(scope, 'notes', {vault: ''}), {code: 'invalid-config'})
    await config.delete(scope, 'notes')
    assert.equal(config.stored.size, 0)
  })
})
