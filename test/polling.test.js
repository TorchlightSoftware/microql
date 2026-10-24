/**
 * [util]/waitFor and [util]/repeat: calls that run a nested call again and
 * again, every interval, against something outside the Query that changes
 * between runs (a page, a queue, a job's status).
 */
import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import query, {defineService} from '../index.js'
import {QueueRuntime} from './test-services.js'

// A service whose answers come from a script, one per call, as something
// outside the Query would: a value, or an Error to fail with. Past the end of
// the script it keeps giving the last answer. It names a queue, that outside
// state, a handle, so MicroQL runs every call of it rather than reusing an
// answer.
const scripted = (answers) => {
  const state = {calls: 0}
  const service = defineService({
    '/next': {
      input: {queue: ['handle', 'queue', {default: 'outside'}]},
      async call() {
        const answer = answers[Math.min(state.calls++, answers.length - 1)]
        if (answer instanceof Error) throw answer
        return answer
      }
    }
  })
  return {state, service}
}

const runtime = new QueueRuntime()

const run = (service, phase) => query({runtime, services: {outside: service}, phases: {result: phase}, select: '$result'})

describe('[util]/waitFor', () => {
  // [description, answers, fields, its result, how many calls it made]
  const cases = [
    ['returns the first result that fits expect', [{n: 1}, {n: 2}, {n: 3}, {n: 4}], {expect: {n: ['number', {min: 3}]}, interval: 1}, {n: 3}, 3],
    ['without expect, returns the first success', [new Error('not yet'), new Error('not yet'), {n: 1}], {interval: 1}, {n: 1}, 3],
    ['tries again after a failure, even once results fit', [{n: 3}, new Error('flaky'), {n: 3}], {expect: {n: ['number', {min: 3}]}, interval: 1}, {n: 3}, 1]
  ]

  for (const [description, answers, fields, result, calls] of cases) {
    it(description, async () => {
      const {state, service} = scripted(answers)
      assert.deepEqual(await run(service, ['[util]/waitFor', {service: ['[outside]/next', {}], ...fields}]), result)
      assert.equal(state.calls, calls)
    })
  }

  it('gives up after its tries, naming them and the last failure', async () => {
    const {state, service} = scripted([{n: 1}])
    await assert.rejects(run(service, ['[util]/waitFor', {service: ['[outside]/next', {}], expect: {n: ['number', {min: 3}]}, tries: 4, interval: 1}]),
      {code: 'gave-up', tries: 4, message: /after 4 tries[\s\S]*n/})
    assert.equal(state.calls, 4)
  })

  it('gives up with the last error a call failed with', async () => {
    const {service} = scripted([new Error('still loading')])
    await assert.rejects(run(service, ['[util]/waitFor', {service: ['[outside]/next', {}], tries: 2, interval: 1}]),
      {code: 'gave-up', message: /still loading/})
  })


  it('tries 10 times, every 200ms, unless told otherwise', async () => {
    const {state, service} = scripted([{n: 1}])
    const started = Date.now()
    await assert.rejects(run(service, ['[util]/waitFor', {service: ['[outside]/next', {}], expect: {n: ['number', {min: 3}]}}]), {code: 'gave-up', tries: 10})
    assert.equal(state.calls, 10)
    assert.ok(Date.now() - started >= 9 * 200)
  })
})

describe('[util]/repeat', () => {
  // [description, answers, fields, its result]
  const cases = [
    ['runs exactly times, returning every pass',
      [{page: 1}, {page: 2}, {page: 3}],
      {times: 3},
      {passes: [{page: 1}, {page: 2}, {page: 3}], stoppedBy: 'times'}],
    ['stops on the first pass that fits until, keeping it',
      [{left: 2}, {left: 0}, {left: 0}],
      {until: {left: ['number', {max: 0}]}, times: 5},
      {passes: [{left: 2}, {left: 0}], stoppedBy: 'until'}],
    ['stops at times when nothing fits until',
      [{left: 2}],
      {until: {left: ['number', {max: 0}]}, times: 2},
      {passes: [{left: 2}, {left: 2}], stoppedBy: 'times'}],
    ['runs 10 times unless told otherwise',
      [{page: 1}],
      {},
      {passes: Array.from({length: 10}, () => ({page: 1})), stoppedBy: 'times'}]
  ]

  for (const [description, answers, fields, result] of cases) {
    it(description, async () => {
      const {service} = scripted(answers)
      assert.deepEqual(await run(service, ['[util]/repeat', {service: ['[outside]/next', {}], ...fields}]), result)
    })
  }


  it('fails when a pass fails', async () => {
    const {service} = scripted([{page: 1}, new Error('no page 2')])
    await assert.rejects(run(service, ['[util]/repeat', {service: ['[outside]/next', {}], times: 3}]), /no page 2/)
  })
})
