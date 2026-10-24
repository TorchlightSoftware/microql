/**
 * Handles: fields that name a resource outside the Query, of a kind the
 * runtime offers. A handle is its service, kind and name, whatever field
 * holds it. One belongs to one phase, since a phase replays as a whole;
 * calls on one run one at a time, with a warning when they had to wait; such
 * a call is never reused within a Run. A call asks the scope for its handle,
 * and is given what the runtime answers in place of its name.
 *
 * The runtime here offers handles of kind queue, with nothing behind them.
 */
import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import query, {compile, defineService, plan, Runtime} from '../index.js'
import {QueueRuntime} from './test-services.js'

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

// A service working on queues: each call takes a moment, and the service
// keeps how many of its calls were in flight at most, and the handles it was
// given. /meet waits, a while, for as many calls as it's told to meet.
const jobs = () => {
  const state = {running: 0, most: 0, calls: 0, given: [], arrived: 0}
  state.together = new Promise(resolve => { state.allArrived = () => resolve('together') })
  const service = defineService({
    '/work': {
      input: {queue: ['handle', 'queue', {default: 'jobs'}], item: ['any', 'optional'], after: ['any', 'optional']},
      async call({queue, item}) {
        state.calls++
        state.given.push(queue)
        state.most = Math.max(state.most, ++state.running)
        await sleep(5)
        state.running--
        return {queue: queue.name, item}
      }
    },
    '/other': {
      input: {inbox: ['handle', 'queue']},
      async call({inbox}) {
        return inbox.name
      }
    },
    '/meet': {
      input: {queue: ['handle', 'queue'], of: ['number']},
      async call({of}) {
        if (++state.arrived === of) state.allArrived()
        return Promise.race([state.together, sleep(2000).then(() => 'alone')])
      }
    }
  })
  return {state, service}
}

describe('A handle\'s kind', () => {
  it('is one the runtime offers, or a call naming it doesn\'t compile', () => {
    assert.throws(() => compile({runtime: new Runtime(), services: {jobs: jobs().service}, phases: {a: ['[jobs]/work', {}]}}),
      {code: 'missing-capability', service: 'jobs', capability: 'queue'})
  })
})

describe('A handle belongs to one phase', () => {
  // [description, phases, the error]
  const refused = [
    ['one name in two phases',
      {a: ['[jobs]/work', {queue: 'jobs'}], b: ['[jobs]/work', {queue: 'jobs'}]},
      {code: 'shared-handle', address: '$b.@1', field: 'queue', value: 'jobs', phases: ['$a', '$b']}],
    ['one name by default in two phases',
      {a: ['[jobs]/work', {}], b: ['[jobs]/work', {item: 2}]},
      {code: 'shared-handle', address: '$b.@1', value: 'jobs'}],
    ['one name of one kind in two phases, held by different fields',
      {a: ['[jobs]/work', {queue: 'jobs'}], b: ['[jobs]/other', {inbox: 'jobs'}]},
      {code: 'shared-handle', address: '$b.@1', field: 'inbox', value: 'jobs', phases: ['$a', '$b']}],
    ['one name in a phase and in the Query\'s catch',
      {a: ['[jobs]/work', {queue: 'jobs'}]},
      {code: 'shared-handle', value: 'jobs'},
      {catch: ['[jobs]/work', {queue: 'jobs'}]}]
  ]

  for (const [description, phases, error, settings] of refused) {
    it(`refuses ${description} when it compiles`, () => {
      assert.throws(() => compile({runtime: new QueueRuntime(), services: {jobs: jobs().service}, phases, settings}), error)
    })
  }

  // [description, phases]
  const accepted = [
    ['different names in different phases', {a: ['[jobs]/work', {queue: 'jobs'}], b: ['[jobs]/work', {queue: 'mail'}]}],
    ['one name used twice in one phase', {a: [['[jobs]/work', {item: 1}], ['[jobs]/work', {item: 2}]]}]
  ]

  for (const [description, phases] of accepted) {
    it(`accepts ${description}`, () => {
      assert.doesNotThrow(() => compile({runtime: new QueueRuntime(), services: {jobs: jobs().service}, phases}))
    })
  }

  it('refuses a name built from data, when a second phase reaches it as it runs', async () => {
    await assert.rejects(query({
      runtime: new QueueRuntime(),
      given: {name: 'jobs'},
      services: {jobs: jobs().service},
      phases: {
        a: ['[jobs]/work', {queue: '$given.name'}],
        b: ['[jobs]/work', {queue: '$given.name', after: '$a'}]
      }
    }), {code: 'shared-handle', address: '$b.@1', value: 'jobs', phases: ['$a', '$b']})
  })

  it('is in the plan, with its phase, when its name is written', () => {
    const planned = plan({
      runtime: new QueueRuntime(),
      given: {name: 'built'},
      services: {jobs: jobs().service},
      phases: {
        a: [['[jobs]/work', {}], ['[jobs]/work', {item: 2}]],
        b: ['[jobs]/other', {inbox: 'mail'}],
        c: ['[jobs]/work', {queue: '$given.name'}]
      },
      settings: {catch: ['[jobs]/other', {inbox: 'errors'}]}
    })
    assert.deepEqual(planned.handles, [
      {service: 'jobs', kind: 'queue', name: 'jobs', phase: '$a'},
      {service: 'jobs', kind: 'queue', name: 'mail', phase: '$b'},
      {service: 'jobs', kind: 'queue', name: 'errors', phase: 'settings.catch'}
    ])
  })
})

describe('A call on a handle', () => {
  it('is given what the runtime answers, asked with its service, kind, name and phase', async () => {
    const runtime = new QueueRuntime()
    const {state, service} = jobs()
    await query({runtime, services: {jobs: service}, phases: {a: [['[jobs]/work', {item: 1}], ['[jobs]/work', {item: 2}]]}})
    assert.deepEqual(state.given, [1, 2].map(() => ({service: 'jobs', kind: 'queue', name: 'jobs'})))
    assert.deepEqual(runtime.requests, [1, 2].map(() => ({service: 'jobs', kind: 'queue', name: 'jobs', phase: '$a'})))
  })

  it('in the Query\'s catch asks for it in the catch\'s phase', async () => {
    const runtime = new QueueRuntime()
    await query({
      runtime,
      services: {jobs: jobs().service},
      phases: {a: ['down', '[util]/throw']},
      settings: {catch: ['[jobs]/other', {inbox: 'errors'}]}
    })
    assert.deepEqual(runtime.requests, [{service: 'jobs', kind: 'queue', name: 'errors', phase: 'settings.catch'}])
  })
})

describe('Calls on one handle', () => {
  it('run one at a time, warning once when one had to wait', async () => {
    const runtime = new QueueRuntime()
    const {state, service} = jobs()
    const result = await query({
      runtime,
      given: {items: [1, 2, 3]},
      services: {jobs: service},
      phases: {a: ['$given.items', '[util]/each', {service: ['[jobs]/work', {item: '@'}]}]},
      select: '$a'
    })
    assert.deepEqual(result, [1, 2, 3].map(item => ({queue: 'jobs', item})))
    assert.equal(state.most, 1)
    const warnings = runtime.logged.filter(({level}) => level === 'warn')
    assert.equal(warnings.length, 1)
    assert.match(warnings[0].text, /^\[\$a\.@1a1\] .*'jobs'/)
  })

  it('run in parallel on different handles', async () => {
    const result = await query({
      runtime: new QueueRuntime(),
      given: {items: ['a', 'b', 'c']},
      services: {jobs: jobs().service},
      phases: {a: ['$given.items', '[util]/each', {service: ['[jobs]/meet', {queue: '@', of: 3}]}]},
      select: '$a'
    })
    assert.deepEqual(result, ['together', 'together', 'together'])
  })

  it('wait without a warning when the Query runs them one at a time', async () => {
    const runtime = new QueueRuntime()
    await query({
      runtime,
      given: {items: [1, 2, 3]},
      services: {jobs: jobs().service},
      phases: {a: ['$given.items', '[util]/each', {sequential: true, service: ['[jobs]/work', {item: '@'}]}]}
    })
    assert.deepEqual(runtime.logged.filter(({level}) => level === 'warn'), [])
  })

  it('are never reused within a Run: each one runs', async () => {
    const {state, service} = jobs()
    await query({runtime: new QueueRuntime(), services: {jobs: service}, phases: {a: [['[jobs]/work', {item: 1}], ['[jobs]/work', {item: 1}]]}})
    assert.equal(state.calls, 2)
  })
})
