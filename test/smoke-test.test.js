import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import {serviceSmokeTests, defineService, util} from '../core.js'

// What a service's init receives from its runtime.
const env = {log() {}}

// The smoke tests a service fails, as "describe: it".
async function failuresOf(service, options = {env}) {
  const failed = []
  for (const row of serviceSmokeTests(service, options)) {
    try {
      await row.test()
    } catch {
      failed.push(`${row.describe}: ${row.it}`)
    }
  }
  return failed
}

const shop = defineService({
  requires: ['log'],
  '/total': {description: 'Sum the prices', input: {on: ['array', {tags: ['target']}]}, call: async ({on}) => on.length},
  '/orders': {GET: async () => [], POST: async () => 'placed'}
})

describe('serviceSmokeTests', () => {
  it('is a table of tests, each named by what it describes and what it checks', () => {
    for (const row of serviceSmokeTests(shop, {env})) {
      assert.deepEqual(Object.keys(row), ['describe', 'it', 'test'])
      assert.equal(typeof row.test, 'function')
    }
  })

  // [description, service, options]
  const passing = [
    ['util', util, {env}],
    ['a defined service', shop, {env}],
    ['a confined service', defineService({confined: true, '/secret': async () => 'kept'}), {env, confined: true}],
    ['a configured service, with its own config', defineService({config: {vault: ['string']}, init(env) { if (env.config.vault !== 'notes') throw new Error('not its config') }, async '/where'() {}}), {env, config: {vault: 'notes'}}]
  ]

  for (const [description, service, options] of passing) {
    it(`passes ${description}`, async () => {
      assert.deepEqual(await failuresOf(service, options), [])
    })
  }

  // A service that answers as defineService would, but with one thing changed.
  const changed = (change) => ({...shop, ...change})

  // [description, service, the smoke tests it fails]
  const failing = [
    ['a service with no init', changed({init: undefined}), [
      'service: provides lookup, supportedCalls and init',
      'init: makes an instance that answers call',
      'init: makes a fresh instance each time',
      'call: refuses a resource the service lacks',
      'tearDown: can run twice'
    ]],
    ['a lookup that answers nothing for any resource it lacks', changed({lookup: (key) => key.resource.startsWith('/microql-smoke-test') ? undefined : shop.lookup(key)}), [
      'lookup: refuses a resource the service lacks'
    ]],
    ['a listing that carries its calls', changed({supportedCalls: () => [{method: null, resource: '/total', description: 'Sum the prices', call: () => 1}]}), [
      'supportedCalls: lists each call by resource and method, with no functions'
    ]],
    ['a listing of a call lookup refuses', changed({supportedCalls: () => [...shop.supportedCalls(), {method: null, resource: '/gone'}]}), [
      'lookup: answers [smoke]/gone with its declaration'
    ]],
    ['an init that shares one instance', (() => {
      const shared = {call: async () => 1}
      return changed({init: async () => shared})
    })(), [
      'init: makes a fresh instance each time',
      'call: refuses a resource the service lacks'
    ]],
    ['an env without what the service requires', shop, [
      'service: can be made with env and config: env has every key it requires, and its config declaration accepts config'
    ], {env: {}}],
    ['config the service doesn\'t accept', defineService({config: {vault: ['string']}, async '/where'() {}}), [
      'service: can be made with env and config: env has every key it requires, and its config declaration accepts config'
    ], {env, config: {vault: 1}}],
    ['a confined service checked as one that isn\'t', defineService({confined: true, '/secret': async () => 'kept'}), [
      'lookup: answers [smoke]/secret with its declaration',
      'lookup: refuses a key whose custody the service doesn\'t answer'
    ]]
  ]

  for (const [description, service, failures, options] of failing) {
    it(`fails ${description}`, async () => {
      assert.deepEqual(await failuresOf(service, options), failures)
    })
  }
})
