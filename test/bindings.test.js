import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import query, {serviceFromTable} from '../index.js'

describe('Scope: @ and named bindings', () => {
  const inspector = serviceFromTable({
    '/check'({level1, level2}) {
      return {level1, level2}
    }
  })

  const onTarget = (call) => ({input: {on: ['target']}, call})
  const math = serviceFromTable({
    '/add1': onTarget(async ({on}) => on + 1),
    '/times10': onTarget(async ({on}) => on * 10),
    '/reduce': {input: {on: ['target'], service: ['call']}, call: async ({on, service}) => on.reduce(async (l, r) => service([await l, r]))},
    '/sequence': onTarget(async ({on}) => Array.from({length: on}, (v, k) => k + 1)),
    '/sum': onTarget(async ({on}) => on.reduce((l, r) => l + r))
  })

  const services = {inspector, math}

  it('gives a lone call in a service position its item as @', async () => {
    const result = await query({
      given: {items: [1, 2]},
      services,
      phases: {
        simple: ['$given.items', '[util]/each', {
          service: ['[inspector]/check', {level1: '@'}]
        }]
      },
      select: '$simple'
    })
    assert.deepEqual(result, [{level1: 1, level2: undefined}, {level1: 2, level2: undefined}])
  })

  it('reaches enclosing iterations by name', async () => {
    const result = await query({
      given: {outer: [{inner: [1, 2]}, {inner: [3, 4]}]},
      services,
      phases: {
        nested: ['$given.outer', '[util]/flattenEach', {
          as: 'group',
          service: ['@group.inner', '[util]/each', {
            as: 'number',
            service: ['[inspector]/check', {level1: '@number', level2: '@group'}]
          }]
        }]
      },
      select: '$nested'
    })

    assert.equal(result.length, 4)
    assert.deepEqual(result[0], {level1: 1, level2: {inner: [1, 2]}})
    assert.deepEqual(result[3], {level1: 4, level2: {inner: [3, 4]}})
  })

  it('flows each chain step into the next', async () => {
    const chain = serviceFromTable({
      '/step1': {input: {on: ['target']}, call: ({on}) => `${on}-step1`},
      '/step2': {input: {on: ['target']}, call: ({on}) => `${on}-step2`}
    })

    const result = await query({
      given: {input: 'input'},
      services: {chain},
      phases: {
        result: [
          ['$given.input', '[chain]/step1'],
          ['@', '[chain]/step2']
        ]
      },
      select: '$result'
    })
    assert.equal(result, 'input-step1-step2')
  })

  it('handles deep nesting: chain -> each -> chain -> reduce', async () => {
    const result = await query({
      given: {input: 1, array: [1, 2, 3]},
      services,
      phases: {
        deepNested: [
          ['$given.input', '[math]/add1'],
          ['@', '[math]/add1'],
          ['$given.array', '[util]/each', {
            as: 'n',
            service: [
              ['@n', '[math]/times10'], // 10, 20, 30
              ['@', '[math]/add1'], // 11, 21, 31
              ['@', '[math]/sequence'], // [1..11], [1..21], [1..31]
              ['[math]/reduce', {on: '@', service: ['[math]/sum', {on: '@'}]}],
              ['@', '[util]/template', {n: '@n'}]
            ]
          }]
        ]
      },
      select: '$deepNested'
    })

    assert.deepEqual(result, [
      {on: 66, n: 1},
      {on: 231, n: 2},
      {on: 496, n: 3}
    ])
  })

  it('lets catch see the error as @err and the enclosing bindings by name', async () => {
    const flaky = serviceFromTable({
      async '/fetch'({id}) {
        if (id === 2) throw new Error(`no ${id}`)
        return id
      }
    })

    const result = await query({
      given: {ids: [1, 2, 3]},
      services: {flaky},
      phases: {
        fetched: ['$given.ids', '[util]/each', {
          as: 'id',
          service: ['[util]/try', {
            service: ['[flaky]/fetch', {id: '@id'}],
            catch: ['[util]/template', {failedId: '@id', address: '@err.address'}]
          }]
        }]
      },
      select: '$fetched'
    })

    assert.deepEqual(result, [1, {failedId: 2, address: '$fetched.@1a1a1'}, 3])
  })

  it('passes undefined for a reference that names nothing at run time', async () => {
    const result = await query({
      given: {person: {name: 'Ada'}},
      services,
      phases: {
        checked: ['[inspector]/check', {level1: '$given.person.age', level2: ['$given.person.name', '$given.person.missing']}]
      },
      select: '$checked'
    })
    assert.deepEqual(result, {level1: undefined, level2: ['Ada', undefined]})
  })
})
