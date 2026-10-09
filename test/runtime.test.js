import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import query, {defaultRuntime, memoryStore} from '../index.js'

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
  const initCounting = () => {
    const service = {
      inits: [],
      init(runtime) { this.inits.push(runtime) },
      async '/run'({n}) { return n }
    }
    return service
  }

  it('is called once per runtime, on the services the plan uses', async () => {
    const used = initCounting()
    const unused = initCounting()
    const runtime = recordingRuntime()
    const config = {runtime, services: {used, unused}, phases: {a: ['GET [used]/run', {n: 1}]}}

    await query(config)
    await query(config)

    assert.deepEqual(used.inits, [runtime])
    assert.deepEqual(unused.inits, [])
  })

  it('runs before any call', async () => {
    const order = []
    const service = {
      init() { order.push('init') },
      async '/run'() { order.push('run') }
    }
    await query({runtime: recordingRuntime(), services: {service}, phases: {a: ['GET [service]/run', {}]}})
    assert.deepEqual(order, ['init', 'run'])
  })

  it('hands util the runtime for print and recordFailure', async () => {
    const runtime = recordingRuntime()
    await query({
      runtime,
      phases: {
        printed: ['GET [util]/print', {on: 'hello', color: 'blue'}],
        failed: ['GET [util]/eq', {
          l: 'x',
          r: 1,
          onError: ['@', 'GET [util]/recordFailure', {location: 'failures/eq'}],
          ignoreErrors: true,
          precheck: {r: ['string']}
        }]
      }
    })

    assert.deepEqual(runtime.printed, [{text: 'hello', color: 'blue'}])
    assert.equal(runtime.failures.length, 1)
    assert.equal(runtime.failures[0].location, 'failures/eq')
    assert.equal(runtime.failures[0].address, '$failed.@1')
    assert.equal(runtime.failures[0].key, 'GET [util]/eq')
  })

  it('works with the platform-free default runtime', async () => {
    const result = await query({given: {xs: [1, 2]}, phases: {n: ['GET [util]/length', {value: '$given.xs'}]}, select: '$n'})
    assert.equal(result, 2)
    assert.equal(typeof defaultRuntime.print, 'function')
  })
})

describe('$trigger', () => {
  const echo = {async '/echo'({on}) { return on }}

  it('holds the payload the host passes at start', async () => {
    const result = await query({
      trigger: {kind: 'webhook'},
      services: {echo},
      phases: {received: ['GET [echo]/echo', {on: '$trigger.body.name'}]},
      select: '$received'
    }, {trigger: {body: {name: 'Ada'}}})
    assert.equal(result, 'Ada')
  })

  it('gives Runs with different payloads different results', async () => {
    const runState = memoryStore()
    const config = {trigger: {kind: 'webhook'}, services: {echo}, phases: {received: ['GET [echo]/echo', {on: '$trigger.n'}]}, select: '$received'}
    assert.equal(await query(config, {runState, trigger: {n: 1}}), 1)
    assert.equal(await query(config, {runState, trigger: {n: 2}}), 2)
  })
})

describe('concurrency setting', () => {
  it('caps the calls in flight across the Run, without counting an each itself', async () => {
    let active = 0
    let peak = 0
    const slow = {
      async '/work'({n}) {
        active++
        peak = Math.max(peak, active)
        await new Promise(resolve => setTimeout(resolve, 5))
        active--
        return n
      }
    }

    const result = await query({
      given: {ns: [1, 2, 3, 4, 5, 6, 7, 8]},
      services: {slow},
      settings: {concurrency: 3},
      phases: {
        worked: ['$given.ns', 'GET [util]/each', {service: ['GET [slow]/work', {n: '@'}]}],
        other: ['GET [slow]/work', {n: 100}]
      },
      select: '$worked'
    })

    assert.deepEqual(result, [1, 2, 3, 4, 5, 6, 7, 8])
    assert.equal(peak, 3)
  })
})
