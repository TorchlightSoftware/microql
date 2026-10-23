import assert from 'node:assert'
import {describe, it} from 'node:test'
import query, {defineService} from '../index.js'

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

// A higher-order service that runs its nested call once per item, one after
// another, so the whole call outlasts any one nested call.
const serial = defineService({
  '/run': {
    input: {on: ['any', 'optional', {tags: ['target']}], service: ['call']},
    async call({on, service}) {
      const results = []
      for (const item of on) results.push(await service(item))
      return results
    }
  }
})

// A service whose calls take the given time.
const taking = (ms) => defineService({
  async '/process'({value}) {
    await sleep(ms)
    return {processed: value}
  }
})

// A call that holds nested calls has no timeout of its own: each nested call
// has its own, and only a timeout set on the holding call itself applies to it.
describe('NoTimeout Tests', () => {
  describe('Calls that hold nested calls have no timeout of their own', () => {
    it('lets a call outlast the timeout while each nested call stays within it', async () => {
      const result = await query({
        given: {items: ['a', 'b', 'c', 'd']},
        services: {serial, step: taking(20)},
        settings: {timeout: 50},
        phases: {
          results: ['$given.items', '[serial]/run', {service: ['[step]/process', {value: '@'}]}]
        },
        select: '$results'
      })

      assert.deepStrictEqual(result.map(r => r.processed), ['a', 'b', 'c', 'd'])
    })

    it('still times out a nested call that outlasts the timeout', async () => {
      await assert.rejects(
        query({
          given: {items: ['a']},
          services: {slow: taking(100)},
          settings: {timeout: 50},
          phases: {
            results: ['[util]/each', {
              on: '$given.items',
              service: ['[slow]/process', {value: '@'}]
            }]
          },
          select: '$results'
        }),
        {code: 'timeout', timeout: 50}
      )
    })

    it('lets [util]/filter run its nested calls', async () => {
      const result = await query({
        given: {words: ['hi', 'hello', 'world', 'a']},
        services: {
          fastFilter: defineService({
            async '/isLong'({value}) {
              await sleep(10)
              return value.length > 2
            }
          })
        },
        settings: {timeout: 50},
        phases: {
          longWords: ['[util]/filter', {
            on: '$given.words',
            service: ['[fastFilter]/isLong', {value: '@'}]
          }]
        },
        select: '$longWords'
      })

      assert.deepStrictEqual(result, ['hello', 'world'])
    })

    it('lets [util]/flattenEach run its nested calls', async () => {
      const result = await query({
        given: {words: ['hi', 'bye']},
        services: {
          fastSplit: defineService({
            async '/chars'({word}) {
              await sleep(10)
              return word.split('')
            }
          })
        },
        settings: {timeout: 50},
        phases: {
          allChars: ['[util]/flattenEach', {
            on: '$given.words',
            service: ['[fastSplit]/chars', {word: '@'}]
          }]
        },
        select: '$allChars'
      })

      assert.deepStrictEqual(result, ['h', 'i', 'b', 'y', 'e'])
    })
  })

  describe('A timeout set on the holding call applies to it', () => {
    it('times out a holding call given its own timeout', async () => {
      await assert.rejects(
        query({
          given: {items: ['a', 'b', 'c', 'd']},
          services: {serial, step: taking(20)},
          phases: {
            results: ['$given.items', '[serial]/run', {service: ['[step]/process', {value: '@'}], timeout: 50}]
          },
          select: '$results'
        }),
        {code: 'timeout', timeout: 50, address: '$results.@1', key: '[serial]/run'}
      )
    })
  })

  describe('Regular services still timeout', () => {
    it('should timeout for a call that holds no nested call', async () => {
      await assert.rejects(
        query({
          given: {value: 'test'},
          services: {slow: taking(100)},
          settings: {timeout: 50},
          phases: {
            result: ['[slow]/process', {value: '$given.value'}]
          },
          select: '$result'
        }),
        {code: 'timeout', timeout: 50}
      )
    })
  })
})
