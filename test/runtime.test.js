import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import coreQuery, {memoryStore, defineService, serviceRegistry} from '../core.js'
import query from '../index.js'

// Core, as a platform calls it: its own runtime, a fresh Run State.
const runCore = (config, options) => coreQuery(config, {runState: memoryStore(), ...options})

// A runtime that keeps what it logs, and its service instances.
const recordingRuntime = () => {
  const logged = []
  return {
    logged,
    log: (text, options) => logged.push({text, ...options}),
    cache: memoryStore(),
    ...serviceRegistry()
  }
}

// A service, and the runtimes its init has received.
const initCounting = () => {
  const inits = []
  const service = defineService({
    init(runtime) { inits.push(runtime) },
    async '/run'({n}) { return n }
  })
  return {service, inits}
}

describe('init', () => {
  it('is the runtime\'s: core asks it for instances of the services a Run uses', async () => {
    const asked = []
    const used = initCounting()
    const recording = recordingRuntime()
    const runtime = {...recording, init(services) { asked.push(Object.keys(services)); return recording.init.call(this, services) }}
    await runCore({runtime, services: {used: used.service, unused: initCounting().service}, phases: {a: ['[used]/run', {n: 1}]}})
    assert.deepEqual(asked, [['used']])
  })

  it('runs before any call', async () => {
    const order = []
    const service = defineService({
      init() { order.push('init') },
      async '/run'() { order.push('run') }
    })
    await runCore({runtime: recordingRuntime(), services: {service}, phases: {a: ['[service]/run', {}]}})
    assert.deepEqual(order, ['init', 'run'])
  })

  it('hands util the runtime\'s log, for inspect and log', async () => {
    const runtime = recordingRuntime()
    await runCore({
      runtime,
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

describe('serviceRegistry', () => {
  const config = (runtime, service) => ({runtime, services: {service}, phases: {a: ['[service]/run', {n: 1}]}})

  it('makes one instance of a service per runtime, however many Runs use it', async () => {
    const counted = initCounting()
    const runtime = recordingRuntime()
    await runCore(config(runtime, counted.service))
    await runCore(config(runtime, counted.service))
    assert.equal(counted.inits.length, 1)
    assert.equal(counted.inits[0].log, runtime.log)
  })

  it('makes one instance for Runs that start together', async () => {
    const counted = initCounting()
    const runtime = recordingRuntime()
    await Promise.all([runCore(config(runtime, counted.service)), runCore(config(runtime, counted.service))])
    assert.equal(counted.inits.length, 1)
  })

  it('keeps each runtime its own instances, as a runtime scoped to each tenant would', async () => {
    const counted = initCounting()
    const shared = recordingRuntime()
    const tenants = [{...shared, tenant: 'one'}, {...shared, tenant: 'other'}]
    await Promise.all(tenants.map(tenant => runCore(config(tenant, counted.service))))
    assert.deepEqual(counted.inits.map(runtime => runtime.tenant).sort(), ['one', 'other'])
  })

  it('tears down each instance once, and makes fresh ones for the next Run', async () => {
    let tearDowns = 0
    const counted = initCounting()
    const service = defineService({init: counted.service.init, async tearDown() { tearDowns++ }, async '/run'({n}) { return n }})
    const runtime = recordingRuntime()
    await runCore(config(runtime, service))
    await runtime.tearDown()
    await runtime.tearDown()
    assert.equal(tearDowns, 1)
    await runCore(config(runtime, service))
    assert.equal(counted.inits.length, 2)
  })

  it('gives each instance the config filed under its service\'s name, and an instance for each name', async () => {
    const account = defineService({init(runtime) { this.config = runtime.config }, async '/whoami'() { return this.config }})
    const runtime = {...recordingRuntime(), config: {mine: {token: 'a'}, work: {token: 'b'}}}
    const result = await runCore({runtime, services: {mine: account, work: account}, phases: {a: ['[mine]/whoami', {}], b: ['[work]/whoami', {}]}, select: ['$a', '$b']})
    assert.deepEqual(result, {a: {token: 'a'}, b: {token: 'b'}})
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
    const runtime = recordingRuntime()
    const whoami = {runtime, services: {service}, phases: {a: ['[service]/whoami', {}]}, select: '$a'}
    assert.deepEqual(await Promise.all([runCore(whoami), runCore(whoami)]), ['token 1', 'token 1'])
    assert.equal(logins, 1)
  })

  it('tries again after an init that fails', async () => {
    let attempts = 0
    const service = defineService({init() { if (++attempts === 1) throw new Error('not yet') }, async '/run'({n}) { return n }})
    const runtime = recordingRuntime()
    await assert.rejects(runCore(config(runtime, service)), /not yet/)
    assert.equal(await runCore({...config(runtime, service), select: '$a'}), 1)
  })
})

describe('what core requires of its caller', () => {
  const config = {given: {xs: [1, 2]}, phases: {n: ['[util]/length', {value: '$given.xs'}]}, select: '$n'}

  it('runs with a runtime and a Run State', async () => {
    assert.equal(await runCore({...config, runtime: recordingRuntime()}), 2)
  })

  // [missing, options, error]
  const missing = [
    ['a runtime', {}, {runState: memoryStore()}, /needs a runtime/],
    ['a Run State', {runtime: recordingRuntime()}, {}, /needs a runState/],
    ['a runtime that makes service instances', {runtime: {log() {}, cache: memoryStore()}}, {runState: memoryStore()}, /needs a runtime with init\(services\)/]
  ]

  for (const [what, extra, options, error] of missing) {
    it(`refuses to run without ${what}`, async () => {
      await assert.rejects(coreQuery({...config, ...extra}, options), error)
    })
  }

  describe('a service\'s config declaration', () => {
    const vault = defineService({config: {vault: ['string', {min: 1}]}, init(runtime) { this.vault = runtime.config.vault }, async '/where'() { return this.vault }})
    const where = (runtime) => runCore({runtime, services: {vault}, phases: {a: ['[vault]/where', {}]}, select: '$a'})

    it('lets a Run start when runtime.config fits it', async () => {
      assert.equal(await where({...recordingRuntime(), config: {vault: {vault: 'notes'}, other: {vault: 'not this one'}}}), 'notes')
    })

    // [description, runtime.config]
    const misfits = [
      ['config that doesn\'t fit it', {vault: {vault: ''}}],
      ['no config filed under its name', {other: {vault: 'notes'}}]
    ]

    for (const [description, config] of misfits) {
      it(`refuses a Run whose runtime has ${description}, before any call`, async () => {
        await assert.rejects(where({...recordingRuntime(), config}), {
          code: 'invalid-config',
          address: '$a.@1',
          message: /^\[\$a\.@1\] Service 'vault' can't use this runtime's config:\n/
        })
      })
    }

    it('refuses a Run whose runtime has config of the wrong type, before any call', async () => {
      await assert.rejects(where({...recordingRuntime(), config: {vault: {vault: 1}}}), {
        code: 'invalid-config',
        address: '$a.@1',
        message: /^\[\$a\.@1\] Service 'vault' can't use this runtime's config:\n/
      })
    })

    it('requires runtime.config', async () => {
      await assert.rejects(where(recordingRuntime()), {code: 'missing-capability', message: /requires runtime\.config/})
    })

    it('refuses a declaration that is malformed', async () => {
      const broken = defineService({config: {vault: ['nope']}, async '/where'() {}})
      await assert.rejects(runCore({runtime: {...recordingRuntime(), config: {}}, services: {broken}, phases: {a: ['[broken]/where', {}]}}), {
        code: 'invalid-config',
        message: /Service 'broken' has a malformed config declaration: Unknown type name 'nope'/
      })
    })
  })

  it('refuses to run a service that requires a key the runtime lacks', async () => {
    const mailer = defineService({requires: ['send'], async '/mail'() { return 'sent' }})
    await assert.rejects(runCore({runtime: recordingRuntime(), services: {mailer}, phases: {a: ['[mailer]/mail', {}]}}), {
      code: 'missing-capability',
      address: '$a.@1',
      message: '[$a.@1] Service \'mailer\' requires runtime.send, which this runtime doesn\'t provide'
    })
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
    const runState = memoryStore()
    const config = {services: {echo}, phases: {received: ['[echo]/echo', {on: '$trigger.n'}]}, select: '$received'}
    assert.equal(await query(config, {runState, trigger: {n: 1}}), 1)
    assert.equal(await query(config, {runState, trigger: {n: 2}}), 2)
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
      const counted = {...greeting, services: {echo: defineService({async '/echo'({on}) { calls++; return on }})}}
      await assert.rejects(query(counted, {trigger: payload}), /\$trigger validation failed/)
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
