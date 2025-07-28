import assert from 'node:assert'
import {describe, it} from 'node:test'
import query from '../query.js'

describe('NoTimeout Tests', () => {
  describe('Iterator services without timeout', () => {
    it('should not timeout for util.map itself but nested services still can', async () => {
      let callCount = 0
      const services = {
        fast: {
          async process({value}) {
            callCount++
            // Simulate fast processing (shorter than timeout)
            await new Promise(resolve => setTimeout(resolve, 10))
            return {processed: value, call: callCount}
          }
        }
      }

      const result = await query({
        given: {items: ['a', 'b', 'c']},
        services,
        settings: {
          timeout: 50
        },
        queries: {
          results: ['util:map', {
            on: '$.given.items',
            service: ['fast:process', {value: '@'}]
          }]
        },
        select: 'results'
      })

      // All items should be processed - map itself won't timeout, and nested services are fast enough
      assert.strictEqual(result.length, 3)
      assert.strictEqual(callCount, 3)
      assert.strictEqual(result[0].processed, 'a')
      assert.strictEqual(result[1].processed, 'b')
      assert.strictEqual(result[2].processed, 'c')
    })

    it('should timeout nested services even in _noTimeout iterator', async () => {
      let callCount = 0
      const services = {
        slow: {
          async process({value}) {
            callCount++
            // Simulate slow processing (longer than timeout)
            await new Promise(resolve => setTimeout(resolve, 100))
            return {processed: value, call: callCount}
          }
        }
      }

      await assert.rejects(
        query({
          given: {items: ['a']},
          services,
          settings: {
            timeout: 50
          },
          queries: {
            results: ['util:map', {
              on: '$.given.items',
              service: ['slow:process', {value: '@'}]
            }]
          },
          select: 'results'
        }),
        /Timed out after 50ms/
      )
    })

    it('should not timeout for util.filter itself', async () => {
      let callCount = 0
      const services = {
        fastFilter: {
          async isLong({value}) {
            callCount++
            // Simulate fast processing
            await new Promise(resolve => setTimeout(resolve, 10))
            return value.length > 2
          }
        }
      }

      const result = await query({
        given: {words: ['hi', 'hello', 'world', 'a']},
        services,
        settings: {
          timeout: 50
        },
        queries: {
          longWords: ['util:filter', {
            on: '$.given.words',
            service: ['fastFilter:isLong', {value: '@'}]
          }]
        },
        select: 'longWords'
      })

      assert.strictEqual(result.length, 2)
      assert.strictEqual(callCount, 4)
      assert.deepStrictEqual(result, ['hello', 'world'])
    })

    it('should not timeout for util.flatMap itself', async () => {
      let callCount = 0
      const services = {
        fastSplit: {
          async chars({word}) {
            callCount++
            // Simulate fast processing
            await new Promise(resolve => setTimeout(resolve, 10))
            return word.split('')
          }
        }
      }

      const result = await query({
        given: {words: ['hi', 'bye']},
        services,
        settings: {
          timeout: 50
        },
        queries: {
          allChars: ['util:flatMap', {
            on: '$.given.words',
            service: ['fastSplit:chars', {word: '@'}]
          }]
        },
        select: 'allChars'
      })

      assert.strictEqual(result.length, 5)
      assert.strictEqual(callCount, 2)
      assert.deepStrictEqual(result, ['h', 'i', 'b', 'y', 'e'])
    })
  })

  describe('Override _noTimeout with explicit timeout', () => {
    it('should apply timeout when explicitly provided to _noTimeout service', async () => {
      // Test that setting an explicit timeout on a _noTimeout service should apply the timeout
      const services2 = {
        slowIterator: {
          async process({items}) {
            // This service has _noTimeout but we'll override it
            await new Promise(resolve => setTimeout(resolve, 100))
            return items.map(item => ({processed: item}))
          }
        }
      }
      services2.slowIterator._noTimeout = true

      await assert.rejects(
        query({
          given: {items: ['a']},
          services: services2,
          queries: {
            results: ['slowIterator:process', {
              items: '$.given.items',
              timeout: 50 // Explicit timeout should override _noTimeout
            }]
          },
          select: 'results'
        }),
        /Timed out after 50ms/
      )
    })
  })

  describe('Regular services still timeout', () => {
    it('should timeout for non-iterator services with global timeout', async () => {
      const services = {
        slow: {
          async process({value}) {
            await new Promise(resolve => setTimeout(resolve, 100))
            return {processed: value}
          }
        }
      }

      await assert.rejects(
        query({
          given: {value: 'test'},
          services,
          settings: {
            timeout: 50
          },
          queries: {
            result: ['slow:process', {value: '$.given.value'}]
          },
          select: 'result'
        }),
        /Timed out after 50ms/
      )
    })
  })
})