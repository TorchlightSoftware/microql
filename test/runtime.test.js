import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {describe, it} from 'node:test'
import coreQuery, {defineService, Runtime} from '../core.js'
import query from '../index.js'
import {ownRun} from './test-services.js'

// Core, as a platform calls it: a Run of its own.
const runCore = (config, options) => coreQuery(config, {runId: randomUUID(), ...options})

const t1 = {tenantId: 't1'}
const t2 = {tenantId: 't2'}

// A runtime scoped by tenant, which keeps what it logs and the calls core
// makes through it.
class RecordingRuntime extends Runtime {
  logged = []
  calls = []

  constructor() {
    super({tenantId: ['string']})
    this.env = {log: (text, options) => this.logged.push({text, ...options})}
  }

  async call(scope, key, fields) {
    this.calls.push({scope, key, fields})
    return super.call(scope, key, fields)
  }
}

// A runtime with services registered in a scope.
const runtimeWith = (scope, services) => {
  const runtime = new RecordingRuntime()
  for (const [name, service] of Object.entries(services)) runtime.services.register(scope, name, service)
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

const runOf = (scope, runtime) => runCore({runtime, scope, phases: {a: ['[service]/run', {n: 1}]}, select: '$a'})

describe('core on a runtime', () => {
  const shop = defineService({async '/total'({on}) { return on.length }})

  it('makes each service call through runtime.call, with the scope the Query runs in and the call\'s key and fields', async () => {
    const runtime = runtimeWith(t1, {shop})
    await runCore({runtime, scope: t1, phases: {a: ['[shop]/total', {on: [1, 2]}]}})
    assert.deepEqual(runtime.calls, [{scope: t1, key: {method: null, service: 'shop', resource: '/total', confined: false}, fields: {on: [1, 2]}}])
  })

  it('looks each key\'s service up in the scope the Query runs in', async () => {
    const runtime = runtimeWith(t1, {shop})
    await assert.rejects(runCore({runtime, scope: t2, phases: {a: ['[shop]/total', {on: []}]}}), {code: 'unknown-service', address: '$a.@1'})
  })

  it('refuses a scope that doesn\'t fit the runtime\'s scope schema', async () => {
    await assert.rejects(runCore({runtime: runtimeWith(t1, {shop}), scope: {tenant: 't1'}, phases: {a: ['[shop]/total', {on: []}]}}), /Invalid scope/)
  })

  it('refuses a service that requires a key env lacks, while compiling', async () => {
    const mailer = defineService({requires: ['send'], async '/mail'() { return 'sent' }})
    const runtime = runtimeWith(t1, {mailer})
    await assert.rejects(runCore({runtime, scope: t1, phases: {a: ['[mailer]/mail', {}]}}), {
      code: 'missing-capability',
      address: '$a.@1',
      message: '[$a.@1] Service \'mailer\' requires env.send, which this runtime doesn\'t provide'
    })
    assert.deepEqual(runtime.calls, [])
  })

  it('hands util the env\'s log, for inspect and log', async () => {
    const runtime = new RecordingRuntime()
    await runCore({
      runtime,
      scope: t1,
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
  it('makes a service\'s instance on its first call, with env and the config filed for it', async () => {
    const vault = defineService({config: {vault: ['string']}, init(env) { this.env = env }, async '/where'() { return this.env }})
    const runtime = runtimeWith(t1, {vault})
    await runtime.config.set(t1, 'vault', {vault: 'notes'})
    const env = await runCore({runtime, scope: t1, phases: {a: ['[vault]/where', {}]}, select: '$a'})
    assert.equal(env.log, runtime.env.log)
    assert.deepEqual(env.config, {vault: 'notes'})
  })

  it('keeps the instance for later Runs in its scope, and makes another for another scope', async () => {
    const {service, inits} = counted()
    const runtime = new RecordingRuntime()
    for (const scope of [t1, t2]) runtime.services.register(scope, 'service', service)
    await runOf(t1, runtime)
    await runOf(t1, runtime)
    await runOf(t2, runtime)
    assert.equal(inits.length, 2)
  })

  it('makes one instance for Runs that start together', async () => {
    const {service, inits} = counted()
    const runtime = runtimeWith(t1, {service})
    await Promise.all([runOf(t1, runtime), runOf(t1, runtime)])
    assert.equal(inits.length, 1)
  })

  it('waits for an async init, once, before the calls of Runs that start together', async () => {
    let logins = 0
    const service = defineService({
      async init() {
        await new Promise(resolve => setTimeout(resolve, 5))
        this.token = `token ${++logins}`
      },
      async '/whoami'() { return this.token }
    })
    const runtime = runtimeWith(t1, {service})
    const whoami = {runtime, scope: t1, phases: {a: ['[service]/whoami', {}]}, select: '$a'}
    assert.deepEqual(await Promise.all([runCore(whoami), runCore(whoami)]), ['token 1', 'token 1'])
    assert.equal(logins, 1)
  })

  it('tries again after an init that fails', async () => {
    let attempts = 0
    const service = defineService({init() { if (++attempts === 1) throw new Error('not yet') }, async '/run'({n}) { return n }})
    const runtime = runtimeWith(t1, {service})
    await assert.rejects(runOf(t1, runtime), /not yet/)
    assert.equal(await runOf(t1, runtime), 1)
  })

  it('makes a fresh instance once a service\'s config changes, releasing the old one', async () => {
    let tearDowns = 0
    const vault = defineService({
      config: {vault: ['string']},
      init(env) { this.vault = env.config.vault },
      async tearDown() { tearDowns++ },
      async '/where'() { return this.vault }
    })
    const runtime = runtimeWith(t1, {vault})
    const where = () => runCore({runtime, scope: t1, phases: {a: ['[vault]/where', {}]}, select: '$a'})
    await runtime.config.set(t1, 'vault', {vault: 'a'})
    assert.equal(await where(), 'a')
    await runtime.config.set(t1, 'vault', {vault: 'b'})
    assert.equal(await where(), 'b')
    assert.equal(tearDowns, 1)
  })

  it('fails a service\'s first call, with invalid-config, when nothing is filed for a service that declares config', async () => {
    const vault = defineService({config: {vault: ['string']}, async '/where'() {}})
    await assert.rejects(runCore({runtime: runtimeWith(t1, {vault}), scope: t1, phases: {a: ['[vault]/where', {}]}}), {
      code: 'invalid-config',
      address: '$a.@1',
      message: /No config is filed for 'vault', whose service declares config/
    })
  })

  // [description, what tearDown is given, tearDowns of t1's instance and t2's]
  const tearDowns = [
    ['a scope\'s instances', [t1], [1, 0]],
    ['every scope\'s instances', [], [1, 1]]
  ]

  for (const [description, given, expected] of tearDowns) {
    it(`tears down ${description}, which the next Run makes afresh`, async () => {
      const [one, other] = [counted(), counted()]
      const runtime = new RecordingRuntime()
      runtime.services.register(t1, 'service', one.service)
      runtime.services.register(t2, 'service', other.service)
      await runOf(t1, runtime)
      await runOf(t2, runtime)
      await runtime.tearDown(...given)
      assert.deepEqual([one.tearDowns, other.tearDowns], expected)
      await runOf(t1, runtime)
      assert.equal(one.inits.length, 2)
    })
  }
})

describe('what core requires of its caller', () => {
  const config = {given: {xs: [1, 2]}, phases: {n: ['[util]/length', {value: '$given.xs'}]}, select: '$n'}

  it('runs with a runtime and a Run id', async () => {
    assert.equal(await runCore({...config, runtime: new RecordingRuntime(), scope: t1}), 2)
  })

  // [missing, the Query's additions, options, error]
  const missing = [
    ['a runtime', {}, {runId: 'run'}, /needs a runtime/],
    ['a Run id', {runtime: new RecordingRuntime(), scope: t1}, {}, /needs a runId/]
  ]

  for (const [what, extra, options, error] of missing) {
    it(`refuses to run without ${what}`, async () => {
      await assert.rejects(coreQuery({...config, ...extra}, options), error)
    })
  }
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
      await assert.rejects(query(counting, {trigger: payload}), /\$trigger validation failed/)
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
