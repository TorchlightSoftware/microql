import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import {ScopedTable} from '../src/runtime/table.js'

describe('ScopedTable', () => {
  const tenant = (tenantId) => ({tenantId})
  const byTenant = () => new ScopedTable({tenantId: ['string']})

  it('keeps a value by scope and name', () => {
    const table = byTenant()
    table.set(tenant('t1'), 'github', {token: 'a'})
    assert.deepEqual(table.get(tenant('t1'), 'github'), {token: 'a'})
  })

  it('keeps each scope apart', () => {
    const table = byTenant()
    table.set(tenant('t1'), 'github', {token: 'a'})
    table.set(tenant('t2'), 'github', {token: 'b'})
    assert.deepEqual([table.get(tenant('t1'), 'github'), table.get(tenant('t2'), 'github')], [{token: 'a'}, {token: 'b'}])
    assert.equal(table.get(tenant('t3'), 'github'), undefined)
  })

  it('reads a scope the same however its fields are ordered', () => {
    const table = new ScopedTable({tenantId: ['string'], region: ['string']})
    table.set({tenantId: 't1', region: 'eu'}, 'github', 1)
    assert.equal(table.get({region: 'eu', tenantId: 't1'}, 'github'), 1)
  })

  it('lists a scope\'s values by name', () => {
    const table = byTenant()
    table.set(tenant('t1'), 'github', 1)
    table.set(tenant('t1'), 'obsidian', 2)
    table.set(tenant('t2'), 'other', 3)
    assert.deepEqual(table.list(tenant('t1')), {github: 1, obsidian: 2})
    assert.deepEqual(table.list(tenant('t3')), {})
  })

  it('keeps everything under the empty scope when given no scope schema', () => {
    const table = new ScopedTable()
    table.set({}, 'github', 1)
    assert.equal(table.get({}, 'github'), 1)
  })

  // [description, what remove is given, what it removes, what's left: t1's values and t2's]
  const removals = [
    ['one name\'s value in a scope', [tenant('t1'), 'github'], [1], [{obsidian: 2}, {github: 3}]],
    ['a scope\'s values', [tenant('t1')], [1, 2], [{}, {github: 3}]],
    ['every value', [], [1, 2, 3], [{}, {}]],
    ['a name the scope lacks', [tenant('t1'), 'missing'], [], [{github: 1, obsidian: 2}, {github: 3}]]
  ]

  for (const [description, given, removed, left] of removals) {
    it(`removes ${description}, returning what it removed`, () => {
      const table = byTenant()
      table.set(tenant('t1'), 'github', 1)
      table.set(tenant('t1'), 'obsidian', 2)
      table.set(tenant('t2'), 'github', 3)
      assert.deepEqual(table.remove(...given), removed)
      assert.deepEqual([table.list(tenant('t1')), table.list(tenant('t2'))], left)
    })
  }

  it('refuses a scope that doesn\'t fit its schema', () => {
    const table = byTenant()
    assert.throws(() => table.set({tenant: 't1'}, 'github', 1), /Invalid scope/)
    assert.throws(() => table.get({tenantId: 1}, 'github'), /Invalid scope/)
  })
})
