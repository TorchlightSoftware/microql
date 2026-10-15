import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import coreQuery, {memoryStore, defineService} from '../core.js'
import query from '../index.js'

// Core, as a platform calls it: its own runtime, a fresh Run State.
const runCore = (config, options) => coreQuery(config, {runState: memoryStore(), ...options})

// A runtime that keeps what it logs.
const recordingRuntime = () => {
  const logged = []
  return {
    logged,
    log: (text, options) => logged.push({text, ...options}),
    cache: memoryStore()
  }
}

describe('init', () => {
  // A service, and the runtimes its init has received.
  const initCounting = () => {
    const inits = []
    const service = defineService({
      init(runtime) { inits.push(runtime) },
      async '/run'({n}) { return n }
    })
    return {service, inits}
  }

  it('is called once per runtime, on the services the plan uses', async () => {
    const used = initCounting()
    const unused = initCounting()
    const runtime = recordingRuntime()
    const config = {runtime, services: {used: used.service, unused: unused.service}, phases: {a: ['[used]/run', {n: 1}]}}

    await runCore(config)
    await runCore(config)

    assert.deepEqual(used.inits, [runtime])
    assert.deepEqual(unused.inits, [])
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

describe('what core requires of its caller', () => {
  const config = {given: {xs: [1, 2]}, phases: {n: ['[util]/length', {value: '$given.xs'}]}, select: '$n'}

  it('runs with a runtime and a Run State', async () => {
    assert.equal(await runCore({...config, runtime: recordingRuntime()}), 2)
  })

  // [missing, options, error]
  const missing = [
    ['a runtime', {}, {runState: memoryStore()}, /needs a runtime/],
    ['a Run State', {runtime: recordingRuntime()}, {}, /needs a runState/]
  ]

  for (const [what, extra, options, error] of missing) {
    it(`refuses to run without ${what}`, async () => {
      await assert.rejects(coreQuery({...config, ...extra}, options), error)
    })
  }

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
