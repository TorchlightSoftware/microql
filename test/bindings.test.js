import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import query from '../node.js'

describe('Scope: @ and named bindings', () => {
  const inspector = {
    '/check'({level1, level2}) {
      return {level1, level2}
    }
  }

  const math = {
    '/add1': async ({on}) => on + 1,
    '/times10': async ({on}) => on * 10,
    '/reduce': async ({on, service}) => on.reduce(async (l, r) => service([await l, r])),
    '/sequence': async ({on}) => Array.from({length: on}, (v, k) => k + 1),
    '/sum': async ({on}) => on.reduce((l, r) => l + r)
  }
  for (const resource of ['/add1', '/times10', '/sequence', '/sum']) math[resource]._argtypes = {on: {argOrder: 0}}
  math['/reduce']._argtypes = {on: {argOrder: 0}, service: {type: 'service'}}

  const services = {inspector, math}

  it('gives a lone call in a service position its item as @', async () => {
    const result = await query({
      given: {items: [1, 2]},
      services,
      phases: {
        simple: ['$given.items', 'GET [util]/each', {
          service: ['GET [inspector]/check', {level1: '@'}]
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
        nested: ['$given.outer', 'GET [util]/each', {
          as: 'group',
          flatten: true,
          service: ['@group.inner', 'GET [util]/each', {
            as: 'number',
            service: ['GET [inspector]/check', {level1: '@number', level2: '@group'}]
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
    const chain = {
      '/step1': ({on}) => `${on}-step1`,
      '/step2': ({on}) => `${on}-step2`
    }
    chain['/step1']._argtypes = {on: {argOrder: 0}}
    chain['/step2']._argtypes = {on: {argOrder: 0}}

    const result = await query({
      given: {input: 'input'},
      services: {chain},
      phases: {
        result: [
          ['$given.input', 'GET [chain]/step1'],
          ['@', 'GET [chain]/step2']
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
          ['$given.input', 'GET [math]/add1'],
          ['@', 'GET [math]/add1'],
          ['$given.array', 'GET [util]/each', {
            as: 'n',
            service: [
              ['@n', 'GET [math]/times10'], // 10, 20, 30
              ['@', 'GET [math]/add1'], // 11, 21, 31
              ['@', 'GET [math]/sequence'], // [1..11], [1..21], [1..31]
              ['GET [math]/reduce', {on: '@', service: ['GET [math]/sum', {on: '@'}]}],
              ['@', 'GET [util]/template', {n: '@n'}]
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

  it('lets onError see the error as @ and the enclosing bindings by name', async () => {
    const flaky = {
      async '/fetch'({id}) {
        if (id === 2) throw new Error(`no ${id}`)
        return id
      }
    }

    const result = await query({
      given: {ids: [1, 2, 3]},
      services: {flaky},
      phases: {
        fetched: ['$given.ids', 'GET [util]/each', {
          as: 'id',
          service: [
            ['GET [flaky]/fetch', {
              id: '@id',
              ignoreErrors: true,
              onError: ['GET [util]/template', {failedId: '@id', address: '@.address'}]
            }]
          ]
        }]
      },
      select: '$fetched'
    })

    assert.deepEqual(result, [1, {failedId: 2, address: '$fetched.@1a1'}, 3])
  })

  it('passes undefined for a reference that names nothing at run time', async () => {
    const result = await query({
      given: {person: {name: 'Ada'}},
      services,
      phases: {
        checked: ['GET [inspector]/check', {level1: '$given.person.age', level2: ['$given.person.name', '$given.person.missing']}]
      },
      select: '$checked'
    })
    assert.deepEqual(result, {level1: undefined, level2: ['Ada', undefined]})
  })
})
