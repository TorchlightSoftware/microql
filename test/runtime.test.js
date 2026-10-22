import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {describe, it} from 'node:test'
import coreQuery, {defineService, Runtime} from '../core.js'
import query from '../index.js'
import {ownRun} from './test-services.js'

const t1 = {tenantId: 't1'}
const t2 = {tenantId: 't2'}

// A runtime scoped by tenant and Run, which keeps what it logs and the calls
// core makes through it.
class RecordingRuntime extends Runtime {
  logged = []
  calls = []

  constructor() {
    super({scopeSchema: {tenantId: ['string'], runId: ['string']}, runKeys: ['runId']})
    this.env = {log: (text, options) => this.logged.push({text, ...options})}
  }

  async call(scope, key, fields) {
    this.calls.push({scope, key, fields})
    return super.call(scope, key, fields)
  }
}

// A tenant's scope for one Run: a Run of its own, unless one is named.
const runIn = (tenant, runId = randomUUID()) => ({...tenant, runId})

// Core, as a platform calls it: the Query in the scope of a Run.
const runCore = (runtime, scope, config, options) => coreQuery({...config, scope: runtime.scopeOf(scope)}, options)

// A runtime with services registered for a tenant.
const runtimeWith = (tenant, services) => {
  const runtime = new RecordingRuntime()
  for (const [name, service] of Object.entries(services)) runtime.services.register(tenant, name, service)
  return runtime
}

// A service, and the envs its instances have been made with and how many have been torn down.
const counted = () => {
  const counts = {inits: [], tearDowns: 0}
  counts.service = defineService({
    init(env) { counts.inits.push(env) },
    async tearDown() { counts.tearDowns++ },
    async '/run'({n}) { return n }
  })
  return counts
}

const runOf = (runtime, scope, n = 1) => runCore(runtime, scope, {phases: {a: ['[service]/run', {n}]}, select: '$a'})

describe('core in a scope', () => {
  const shop = defineService({async '/total'({on}) { return on.length }})

  it('makes each service call through runtime.call, with the whole scope it runs in and the call\'s key and fields', async () => {
    const runtime = runtimeWith(t1, {shop})
    const scope = runIn(t1)
    await runCore(runtime, scope, {phases: {a: ['[shop]/total', {on: [1, 2]}]}})
    assert.deepEqual(runtime.calls, [{scope, key: {method: null, service: 'shop', resource: '/total', confined: false}, fields: {on: [1, 2]}}])
  })

  it('looks each key\'s service up among its tenant\'s', async () => {
    const runtime = runtimeWith(t1, {shop})
    await assert.rejects(runCore(runtime, runIn(t2), {phases: {a: ['[shop]/total', {on: []}]}}), {code: 'unknown-service', address: '$a.@1'})
  })

  it('refuses a scope that doesn\'t fit the runtime\'s scope schema', async () => {
    await assert.rejects(runCore(runtimeWith(t1, {shop}), {tenant: 't1', runId: 'r1'}, {phases: {a: ['[shop]/total', {on: []}]}}), {code: 'invalid-scope'})
  })

  it('refuses a service that requires a key env lacks, while compiling', async () => {
    const mailer = defineService({requires: ['send'], async '/mail'() { return 'sent' }})
    const runtime = runtimeWith(t1, {mailer})
    await assert.rejects(runCore(runtime, runIn(t1), {phases: {a: ['[mailer]/mail', {}]}}), {
      code: 'missing-capability',
      address: '$a.@1',
      message: '[$a.@1] Service \'mailer\' requires env.send, which this runtime doesn\'t provide.'
    })
    assert.deepEqual(runtime.calls, [])
  })

  it('hands util the env\'s log, for inspect and log', async () => {
    const runtime = new RecordingRuntime()
    await runCore(runtime, runIn(t1), {
      phases: {
        shown: ['[util]/inspect', {on: 'hello', color: 'blue'}],
        failed: ['[util]/try', {
          service: ['[util]/eq', {l: 'x', r: 1, precheck: {r: ['string']}}],
          catch: ['@err', '[util]/log', {to: 'failures/eq'}]
        }]
      }
    })

    const shown = runtime.logged.find(entry => !entry.to)
    const failed = runtime.logged.find(entry => entry.to)
    assert.deepEqual(shown, {text: 'hello', color: 'blue', to: undefined})
    assert.equal(failed.to, 'failures/eq')
    assert.match(failed.text, /^Error: \[\$failed\.@1a1 - \[util\]\/eq\] Service Call Validation precheck failed/)
  })
})

describe('Runtime', () => {
  it('makes a service\'s instance on its first call, with env and the config filed for its tenant', async () => {
    const vault = defineService({config: {vault: ['string']}, init(env) { this.env = env }, async '/where'() { return this.env }})
    const runtime = runtimeWith(t1, {vault})
    await runtime.config.set(t1, 'vault', {vault: 'notes'})
    const env = await runCore(runtime, runIn(t1), {phases: {a: ['[vault]/where', {}]}, select: '$a'})
    assert.equal(env.log, runtime.env.log)
    assert.deepEqual(env.config, {vault: 'notes'})
  })

  it('keeps an instance for every call of its Run, and makes another for another Run', async () => {
    const {service, inits} = counted()
    const runtime = runtimeWith(t1, {service})
    const run = runIn(t1)
    await runCore(runtime, run, {phases: {a: ['[service]/run', {n: 1}], b: ['[service]/run', {n: 2}]}})
    await runOf(runtime, run, 3)
    assert.equal(inits.length, 1)
    await runOf(runtime, runIn(t1))
    assert.equal(inits.length, 2)
  })

  it('waits for an async init, once, before the calls of a Run that start together', async () => {
    let logins = 0
    const service = defineService({
      async init() {
        await new Promise(resolve => setTimeout(resolve, 5))
        this.token = `token ${++logins}`
      },
      async '/whoami'({who}) { return `${who}: ${this.token}` }
    })
    const runtime = runtimeWith(t1, {service})
    const whoami = {phases: {a: ['[service]/whoami', {who: 'a'}], b: ['[service]/whoami', {who: 'b'}]}}
    assert.deepEqual(await runCore(runtime, runIn(t1), whoami), {a: 'a: token 1', b: 'b: token 1'})
    assert.equal(logins, 1)
  })

  it('tries again after an init that fails', async () => {
    let attempts = 0
    const service = defineService({init() { if (++attempts === 1) throw new Error('not yet') }, async '/run'({n}) { return n }})
    const runtime = runtimeWith(t1, {service})
    const run = runIn(t1)
    await assert.rejects(runOf(runtime, run), /not yet/)
    assert.equal(await runOf(runtime, run), 1)
  })

  it('releases the instances of every Run of a tenant once its config changes', async () => {
    let tearDowns = 0
    const vault = defineService({
      config: {vault: ['string']},
      init(env) { this.vault = env.config.vault },
      async tearDown() { tearDowns++ },
      async '/where'() { return this.vault }
    })
    const runtime = runtimeWith(t1, {vault})
    const run = runIn(t1)
    const where = (scope) => runCore(runtime, scope, {phases: {a: ['[vault]/where', {}]}, select: '$a'})
    await runtime.config.set(t1, 'vault', {vault: 'a'})
    assert.equal(await where(run), 'a')
    await runtime.config.set(t1, 'vault', {vault: 'b'})
    assert.equal(tearDowns, 1)
    assert.equal(await where(runIn(t1)), 'b')
  })

  it('fails a service\'s first call, with missing-config, when nothing is filed for a service that declares config', async () => {
    const vault = defineService({config: {vault: ['string']}, async '/where'() {}})
    await assert.rejects(runCore(runtimeWith(t1, {vault}), runIn(t1), {phases: {a: ['[vault]/where', {}]}}), {
      code: 'missing-config',
      address: '$a.@1',
      message: /Service 'vault' declares config, and none is filed for it in this scope/
    })
  })

  // [description, what tearDown is given, tearDowns of t1's instances (two Runs) and t2's (one Run)]
  const tearDowns = [
    ['a Run\'s instances', [runIn(t1, 'r1')], [1, 0]],
    ['a tenant\'s instances, in every Run', [t1], [2, 0]],
    ['every scope\'s instances', [], [2, 1]]
  ]

  for (const [description, given, expected] of tearDowns) {
    it(`tears down ${description}, which the next call makes afresh`, async () => {
      const [one, other] = [counted(), counted()]
      const runtime = new RecordingRuntime()
      runtime.services.register(t1, 'service', one.service)
      runtime.services.register(t2, 'service', other.service)
      for (const scope of [runIn(t1, 'r1'), runIn(t1, 'r2'), runIn(t2, 'r1')]) await runOf(runtime, scope)
      await runtime.tearDown(...given)
      assert.deepEqual([one.tearDowns, other.tearDowns], expected)
      await runOf(runtime, runIn(t1, 'r1'), 2)
      assert.equal(one.inits.length, 3)
    })
  }

  // A service that counts its calls.
  const tally = () => {
    const counts = {calls: 0}
    counts.service = defineService({async '/run'() { return ++counts.calls }})
    return counts
  }

  it('keeps a Run\'s results for that Run alone: running it again reuses them, another Run doesn\'t', async () => {
    const counts = tally()
    const runtime = runtimeWith(t1, {service: counts.service})
    const run = runIn(t1)
    assert.equal(await runOf(runtime, run), 1)
    assert.equal(await runOf(runtime, run), 1)
    assert.equal(await runOf(runtime, runIn(t1)), 2)
    assert.equal(counts.calls, 2)
  })

  it('keeps the Cache by tenant: another Run reuses a cached result, another tenant doesn\'t', async () => {
    const counts = tally()
    const runtime = runtimeWith(t1, {service: counts.service})
    runtime.services.register(t2, 'service', counts.service)
    const cached = {phases: {a: ['[service]/run', {cache: true}]}, select: '$a'}
    assert.equal(await runCore(runtime, runIn(t1), cached), 1)
    assert.equal(await runCore(runtime, runIn(t1), cached), 1)
    assert.equal(await runCore(runtime, runIn(t2), cached), 2)
  })

  it('gives a scope without its run keys no Run State: one to plan in, not to run in', () => {
    const runtime = new RecordingRuntime()
    assert.equal(runtime.scopeOf(t1).run, undefined)
    assert.equal(typeof runtime.scopeOf(runIn(t1)).run.get, 'function')
  })
})

describe('what core requires of its caller', () => {
  const config = {given: {xs: [1, 2]}, phases: {n: ['[util]/length', {value: '$given.xs'}]}, select: '$n'}

  it('runs in a scope with its run keys', async () => {
    assert.equal(await runCore(new RecordingRuntime(), runIn(t1), config), 2)
  })

  it('refuses to compile without a scope', async () => {
    await assert.rejects(coreQuery(config), {code: 'missing-scope', message: /^compile: 'scope' is missing\./})
  })

  it('refuses to run in a scope without a Run State', async () => {
    await assert.rejects(runCore(new RecordingRuntime(), t1, config), /execute: 'scope.run' does not contain a valid RunState/)
  })
})

describe('$trigger', () => {
  const echo = defineService({async '/echo'({on}) { return on }})

  it('holds the payload the host passes at start', async () => {
    const result = await query({
      services: {echo},
      phases: {received: ['[echo]/echo', {on: '$trigger.body.name'}]},
      select: '$received'
    }, {trigger: {body: {name: 'Ada'}}})
    assert.equal(result, 'Ada')
  })

  it('gives Runs with different payloads different results', async () => {
    const run = ownRun()
    const config = {services: {echo}, phases: {received: ['[echo]/echo', {on: '$trigger.n'}]}, select: '$received'}
    assert.equal(await query(config, {runId: run.id, trigger: {n: 1}}), 1)
    assert.equal(await query(config, {runId: run.id, trigger: {n: 2}}), 2)
  })

  // the platform may keep its own trigger configuration beside the schema
  const greeting = {
    trigger: {schema: {name: ['string']}, kind: 'webhook', path: '/hooks/greet'},
    services: {echo},
    phases: {greeted: ['[echo]/echo', {on: '$trigger.name'}]},
    select: '$greeted'
  }

  it('accepts a payload that fits trigger.schema, ignoring the block\'s other fields', async () => {
    assert.equal(await query(greeting, {trigger: {name: 'Ada'}}), 'Ada')
  })

  // [payload, why it is refused]
  const refused = [
    [{name: 5}, 'a field of the wrong type'],
    [undefined, 'no payload at all']
  ]

  for (const [payload, why] of refused) {
    it(`refuses a payload with ${why}, before any call runs`, async () => {
      let calls = 0
      const counting = {...greeting, services: {echo: defineService({async '/echo'({on}) { calls++; return on }})}}
      await assert.rejects(query(counting, {trigger: payload}), {code: 'invalid-trigger', message: /^execute: The trigger payload doesn't fit the trigger schema/})
      assert.equal(calls, 0)
    })
  }
})

describe('concurrency setting', () => {
  it('caps the calls in flight across the Run, without counting an each itself', async () => {
    let active = 0
    let peak = 0
    const slow = defineService({
      async '/work'({n}) {
        active++
        peak = Math.max(peak, active)
        await new Promise(resolve => setTimeout(resolve, 5))
        active--
        return n
      }
    })

    const result = await query({
      given: {ns: [1, 2, 3, 4, 5, 6, 7, 8]},
      services: {slow},
      settings: {concurrency: 3},
      phases: {
        worked: ['$given.ns', '[util]/each', {service: ['[slow]/work', {n: '@'}]}],
        other: ['[slow]/work', {n: 100}]
      },
      select: '$worked'
    })

    assert.deepEqual(result, [1, 2, 3, 4, 5, 6, 7, 8])
    assert.equal(peak, 3)
  })
})
