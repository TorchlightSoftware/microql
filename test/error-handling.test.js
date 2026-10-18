import assert from 'node:assert'
import {describe, it, after} from 'node:test'
import os from 'node:os'
import path from 'node:path'
import {mkdtemp, rm} from 'node:fs/promises'
import query, {plan, defineService, NodeRuntime, fileRunStates} from '../index.js'

describe('Error Handling Tests', () => {
  const errorService = defineService({
    '/fail': async () => {
      throw new Error('Service failed')
    },
    '/succeed': async () => {
      return {success: true}
    }
  })

  // Hands back what it's given, and remembers it.
  const seen = []
  const keep = defineService({
    '/same': {
      input: {on: ['any', 'optional', {tags: ['target']}]},
      call: async ({on}) => { seen.push(on); return on }
    }
  })

  const services = {error: errorService, keep}

  describe('a failure without a catch', () => {
    it('fails the Run, labelled with the call that raised it', async () => {
      await assert.rejects(
        query({services, phases: {result: ['[error]/fail', {someArg: 'value'}]}}),
        (error) => {
          assert.match(error.message, /^\[\$result\.@1 - \[error\]\/fail\] Service failed$/)
          assert.strictEqual(error.address, '$result.@1')
          assert.strictEqual(error.key, '[error]/fail')
          assert.deepStrictEqual(error.args, {someArg: 'value'})
          return true
        }
      )
    })
  })

  describe('the Query\'s catch', () => {
    it('handles each failed phase: its result is the phase\'s, and the Run carries on', async () => {
      const result = await query({
        services,
        settings: {catch: ['[util]/template', {failed: '@err.address'}]},
        phases: {
          failed: ['[error]/fail', {}],
          succeeded: ['[error]/succeed', {}],
          downstream: ['[util]/template', {saw: '$failed'}]
        }
      })
      assert.deepStrictEqual(result, {
        failed: {failed: '$failed.@1'},
        succeeded: {success: true},
        downstream: {saw: {failed: '$failed.@1'}}
      })
    })

    it('fails the Run when it throws', async () => {
      await assert.rejects(
        query({services, settings: {catch: ['@err', '[util]/throw']}, phases: {result: ['[error]/fail', {}]}}),
        (error) => error.address === '$result.@1' && /Service failed/.test(error.message)
      )
    })
  })

  describe('handlers', () => {
    it('receive the failure as error data: name, message, address, key, Query version, form hash and args', async () => {
      seen.length = 0
      const config = {services, phases: {result: ['[util]/try', {service: ['[error]/fail', {someArg: 'value'}], catch: ['@err', '[keep]/same']}]}}
      await query(config)
      const planned = plan(config)
      assert.deepStrictEqual(seen, [{
        '@type': 'Error',
        name: 'Error',
        message: '[$result.@1a1 - [error]/fail] Service failed',
        address: '$result.@1a1',
        key: '[error]/fail',
        queryHash: planned.queryHash,
        formHash: planned.calls.find(call => call.address === '$result.@1a1').formHash,
        args: {someArg: 'value'}
      }])
    })

    it('can be a chain, whose first step reaches the error as @err', async () => {
      const result = await query({
        services,
        phases: {
          result: ['[util]/try', {
            service: ['[error]/fail', {}],
            catch: [['@err', '[keep]/same'], ['[util]/template', {key: '@.key', severity: 'bad'}]]
          }]
        },
        select: '$result'
      })
      assert.deepStrictEqual(result, {key: '[error]/fail', severity: 'bad'})
    })

    it('reach the outer error as @@err from inside an inner catch', async () => {
      const result = await query({
        services,
        phases: {
          result: ['[util]/try', {
            service: ['[error]/fail', {}],
            catch: ['[util]/try', {
              service: ['[error]/fail', {inner: true}],
              catch: ['[util]/template', {inner: '@err.args', outer: '@@err.address'}]
            }]
          }]
        },
        select: '$result'
      })
      assert.deepStrictEqual(result, {inner: {inner: true}, outer: '$result.@1a1'})
    })
  })

  describe('retry', () => {
    it('runs before catch: a catch sees only a failure that outlasted its retries', async () => {
      let attempts = 0
      const flaky = defineService({
        '/once': async () => {
          attempts++
          if (attempts === 1) throw new Error('first attempt fails')
          return 'recovered'
        }
      })
      const result = await query({
        services: {flaky},
        phases: {result: ['[util]/try', {service: ['[flaky]/once', {retry: 1}], catch: ['[util]/template', {caught: true}]}]},
        select: '$result'
      })
      assert.strictEqual(result, 'recovered')
      assert.strictEqual(attempts, 2)
    })
  })

  describe('the Run State', () => {
    const dirs = []
    after(() => Promise.all(dirs.map(dir => rm(dir, {recursive: true, force: true}))))

    it('keeps a caught failure as data, message and all, on disk', async () => {
      const dir = await mkdtemp(path.join(os.tmpdir(), 'microql-errors-'))
      dirs.push(dir)
      const config = {
        given: {items: [1, 2]},
        services,
        phases: {result: ['$given.items', '[util]/each', {service: ['[error]/fail', {item: '@'}], catch: ['@err', '[keep]/same']}]},
        select: '$result'
      }
      const first = await query({...config, runtime: new NodeRuntime({runStates: fileRunStates(dir)})}, {runId: 'run'})
      const resumed = await query({...config, runtime: new NodeRuntime({runStates: fileRunStates(dir)})}, {runId: 'run'})

      assert.deepStrictEqual(resumed, first)
      assert.strictEqual(resumed[0].message, '[$result.@1a1 - [error]/fail] Service failed')
    })
  })

  describe('Validation Error Attribution in Nested Services', () => {
    it('should attribute postcheck errors to nested service, not wrapper service', async () => {
      const atLeastOne = ['array', ['object', {}], {min: 1}]
      const scraper = defineService({
        '/extract': {
          output: {images: atLeastOne, websites: atLeastOne},
          async call() {
            return {
              images: [], // Will fail postcheck
              websites: []
            }
          }
        }
      })

      const config = {
        services: {scraper},
        phases: {
          listings: ['$given.urls', '[util]/flattenEach', {
            service: ['[scraper]/extract', {url: '@'}]
          }]
        },
        given: {
          urls: ['http://example.com']
        }
      }

      await assert.rejects(
        query(config),
        (error) => {
          // Error properties should reflect the innermost service (where the error originated)
          assert.strictEqual(error.key, '[scraper]/extract')
          assert.strictEqual(error.address, '$listings.@1a1')

          // Error message should contain only the innermost service context
          // (outer services don't relabel an error that already has an address)
          assert.match(error.message, /\[\$listings\.@1a1 - \[scraper\]\/extract\]/)
          assert.match(error.message, /Service Defined Validation postcheck failed/)

          // Validation details should be present
          assert.match(error.message, /images:.*Too small/)
          assert.match(error.message, /websites:.*Too small/)

          return true
        }
      )
    })
  })
})
