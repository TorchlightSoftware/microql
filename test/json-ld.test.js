/**
 * JSON-LD data through a Query: `@context`, `@type` and `@id` are ordinary
 * fields, reached by ordinary paths, and a node of `@type` Error is an error.
 */
import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import query, {plan, defineService} from '../index.js'
import {describeSchema} from '../types.js'

const acme = {'@type': 'Organization', '@id': 'https://acme.example/#org', name: 'Acme Fabrication'}
const bolt = {'@type': 'LocalBusiness', '@id': 'https://bolt.example/#org', name: 'Bolt Works'}
const unreadable = {'@type': 'Error', name: 'Error', message: 'listing could not be read'}
const press = {'@type': 'Organization', '@id': 'https://press.example/#org', name: 'Print Press'}

const directory = {'@context': 'https://schema.org', '@graph': [acme, bolt, unreadable, press]}

const services = {
  ld: defineService({
    '/same': {input: {node: []}, call: async ({node}) => node},
    '/isType': {input: {node: [], type: []}, call: async ({node, type}) => node['@type'] === type}
  })
}

const run = (phase) => query({given: directory, services, phases: {result: phase}, select: '$result'})

describe('JSON-LD data', () => {
  // [description, phase, result]
  const cases = [
    ['reads @type and @id by path inside an iteration',
      ['$given.@graph', '[util]/each', {as: 'node', service: ['[util]/template', {type: '@node.@type', id: '@node.@id'}]}],
      [
        {type: 'Organization', id: 'https://acme.example/#org'},
        {type: 'LocalBusiness', id: 'https://bolt.example/#org'},
        {type: 'Error', id: undefined},
        {type: 'Organization', id: 'https://press.example/#org'}
      ]],
    ['filters by @type',
      ['$given.@graph', '[util]/filter', {service: ['[ld]/isType', {node: '@', type: 'Organization'}]}],
      [acme, press]],
    ['writes @type and @id fields',
      ['[util]/template', {'@type': 'Place', '@id': '$given.@graph[1].@id', name: '$given.@graph[1].name'}],
      {'@type': 'Place', '@id': 'https://bolt.example/#org', name: 'Bolt Works'}],
    ['takes a node of @type Error for an error, and leaves it out with skip',
      ['$given.@graph', '[util]/each', {service: ['[ld]/same', {node: '@'}], skip: ['error']}],
      [acme, bolt, press]],
    ['splits Error nodes from the rest',
      ['$given.@graph', '[util]/partitionErrors'],
      {successes: [acme, bolt, press], failures: [unreadable]}]
  ]

  for (const [description, phase, expected] of cases) {
    it(description, async () => {
      assert.deepEqual(await run(phase), expected)
    })
  }

  it('types @type and @id by path in the plan', () => {
    const {calls} = plan({
      given: {'@graph': [acme, press]},
      phases: {result: ['$given.@graph', '[util]/each', {as: 'node', service: ['[util]/template', {type: '@node.@type', id: '@node.@id'}]}]}
    })
    const {args} = calls.find(call => call.address === '$result.@1a1').types
    assert.deepEqual([describeSchema(args.type.actual), describeSchema(args.id.actual)], ['string', 'string'])
  })
})
