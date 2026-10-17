/**
 * A catch handler receives the failure as error data: the one that failed,
 * whichever item of an iteration it was, alongside the handler's own args.
 */

import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import query, {defineService} from '../index.js'

describe('Error Handler Context Tests', () => {
  // Fails for every item; the recorder takes error data as its target.
  const failingWith = (captured) => ({
    failing: defineService({
      async '/process'({data}) {
        throw new Error(`Test failure ${data}`)
      }
    }),
    recorder: defineService({
      '/record': {
        input: {on: ['error', {tags: ['target']}]},
        async call({on, location}) {
          captured.push({on, location})
          return {recorded: true}
        }
      }
    })
  })

  // [description, items, the handler, the locations it was given]
  const cases = [
    ['one item', [1], ['@', '[recorder]/record'], [undefined]],
    ['two items, each its own failure', [1, 2], ['@', '[recorder]/record'], [undefined, undefined]],
    ['the handler\'s own args alongside the error', [1], ['@', '[recorder]/record', {location: 'db/failed/test'}], ['db/failed/test']]
  ]

  for (const [description, items, handler, locations] of cases) {
    it(`gives the handler the failed item's error data: ${description}`, async () => {
      const captured = []
      const result = await query({
        services: failingWith(captured),
        given: {items},
        phases: {mapped: ['$given.items', '[util]/each', {service: ['[failing]/process', {data: '@'}], catch: handler}]},
        select: '$mapped'
      })

      assert.deepEqual(result, items.map(() => ({recorded: true})))
      assert.deepEqual(captured.map(({on}) => on.message).sort(), items.map(item => `[$mapped.@1a1 - [failing]/process] Test failure ${item}`))
      assert.deepEqual(captured.map(({on}) => on.key), items.map(() => '[failing]/process'))
      assert.deepEqual(captured.map(({location}) => location), locations)
    })
  }
})
