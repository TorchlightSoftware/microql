import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import coreQuery, {memoryStore, serviceFromTable} from '../core.js'
import query from '../index.js'

// Core, as a platform calls it: its own runtime, a fresh Run State.
const runCore = (config, options) => coreQuery(config, {runState: memoryStore(), ...options})

// A runtime that keeps what it prints and records.
const recordingRuntime = () => {
  const printed = []
  const failures = []
  return {
    printed,
    failures,
    print: (text, {color} = {}) => printed.push({text, color}),
    inspect: (value) => JSON.stringify(value),
    recordFailure: async (location, record) => failures.push({location, ...record}),
    cache: memoryStore()
  }
}

describe('init', () => {
  // A service, and the runtimes its init has received.
  const initCounting = () => {
    const inits = []
    const service = serviceFromTable({
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
    const service = serviceFromTable({
      init() { order.push('init') },
      async '/run'() { order.push('run') }
    })
    await runCore({runtime: recordingRuntime(), services: {service}, phases: {a: ['[service]/run', {}]}})
    assert.deepEqual(order, ['init', 'run'])
  })

  it('hands util the runtime for print and recordFailure', async () => {
    const runtime = recordingRuntime()
    await runCore({
      runtime,
      phases: {
        printed: ['[util]/print', {on: 'hello', color: 'blue'}],
        failed: ['[util]/eq', {
          l: 'x',
          r: 1,
          onError: ['@', '[util]/recordFailure', {location: 'failures/eq'}],
          ignoreErrors: true,
          precheck: {r: ['string']}
        }]
      }
    })

    assert.deepEqual(runtime.printed, [{text: 'hello', color: 'blue'}])
    assert.equal(runtime.failures.length, 1)
    assert.equal(runtime.failures[0].location, 'failures/eq')
    assert.equal(runtime.failures[0].address, '$failed.@1')
    assert.equal(runtime.failures[0].key, '[util]/eq')
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
})

describe('$trigger', () => {
  const echo = serviceFromTable({async '/echo'({on}) { return on }})

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
      const counted = {...greeting, services: {echo: serviceFromTable({async '/echo'({on}) { calls++; return on }})}}
      await assert.rejects(query(counted, {trigger: payload}), /\$trigger validation failed/)
      assert.equal(calls, 0)
    })
  }
})

describe('concurrency setting', () => {
  it('caps the calls in flight across the Run, without counting an each itself', async () => {
    let active = 0
    let peak = 0
    const slow = serviceFromTable({
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
