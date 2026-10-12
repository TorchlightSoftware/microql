import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import compile from '../compile.js'
import {canonical, hashOf, formsOf} from '../forms.js'
import {serviceFromTable} from '../service-table.js'

describe('canonical serialization', () => {
  // [value, canonical text]
  const cases = [
    [{b: 1, a: [2, {d: 4, c: 3}]}, '{"a":[2,{"c":3,"d":4}],"b":1}'],
    [{a: undefined, b: () => 1, c: null}, '{"c":null}'],
    [Object.assign(new Error('boom'), {address: '$x.@1'}), '{"address":"$x.@1","message":"boom","name":"Error"}'],
    [new Date('2026-01-01T00:00:00Z'), '"2026-01-01T00:00:00.000Z"'],
    ['text', '"text"'],
    // nothing at all reads as null, as it does inside an array
    [undefined, 'null'],
    [[undefined, 1], '[null,1]']
  ]

  for (const [value, text] of cases) {
    it(`serializes ${text}`, () => {
      assert.equal(canonical(value), text)
    })
  }

  it('hashes equal values equally regardless of key order', () => {
    assert.equal(hashOf({a: 1, b: 2}), hashOf({b: 2, a: 1}))
  })

  // stored entries are keyed by these hashes, so they must not change
  it('hashes as SHA-256 of the canonical text, in hex', () => {
    assert.equal(hashOf({b: 2, a: 1}), '43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777')
  })
})

describe('form hashes', () => {
  const services = {
    scraper: serviceFromTable({
      async '/extract'({url}) { return {url} },
      '/images': {input: {on: ['target']}, call: async ({on}) => on}
    })
  }

  // a fresh Query on every call, so an edit never reaches another test
  const baseQuery = () => ({
    given: {baseUrl: 'https://a.example', unused: 1},
    services,
    phases: {
      categories: ['[scraper]/extract', {url: '$given.baseUrl'}],
      listings: ['$categories', '[util]/each', {
        as: 'category',
        service: [
          ['[scraper]/extract', {url: '@category.url'}],
          ['@', '[scraper]/images']
        ]
      }]
    }
  })
  const base = baseQuery()

  const hashesOf = (query) => {
    const forms = formsOf(compile(query))
    return Object.fromEntries([...forms.calls].map(([address, {hash}]) => [address, hash]))
  }

  // [edit, addresses whose form hash changes, addresses that appear or disappear]
  const edits = [
    ['change an unused $given field', q => { q.given.unused = 2 }, []],
    ['change a used $given field',
      q => { q.given.baseUrl = 'https://b.example' },
      ['$categories.@1', '$listings.@1', '$listings.@1a1', '$listings.@1a2']],
    ['edit an argument inside the iteration',
      q => { q.phases.listings[2].service[0][1].timeout = 5; q.phases.listings[2].service[0][1].selector = 'img' },
      ['$listings.@1', '$listings.@1a1', '$listings.@1a2']],
    ['change only operational settings', q => { q.phases.listings[2].service[0][1].retry = 3; q.phases.listings[2].service[0][1].debug = true }, []],
    ['rename the binding', q => {
      q.phases.listings[2].as = 'cat'
      q.phases.listings[2].service[0][1].url = '@cat.url'
    }, []]
  ]

  for (const [name, edit, changed] of edits) {
    it(`${name}: changes ${changed.length ? changed.join(', ') : 'nothing'}`, () => {
      const before = hashesOf(base)
      const edited = baseQuery()
      edit(edited)
      const after = hashesOf(edited)

      assert.deepEqual(Object.keys(after).sort(), Object.keys(before).sort())
      const actual = Object.keys(before).filter(address => before[address] !== after[address]).sort()
      assert.deepEqual(actual, changed.sort())
    })
  }

  it('rename a phase: addresses change, forms do not', () => {
    const renamed = {...base, phases: {cats: base.phases.categories, listings: ['$cats', ...base.phases.listings.slice(1)]}}
    const before = hashesOf(base)
    const after = hashesOf(renamed)
    assert.equal(after['$cats.@1'], before['$categories.@1'])
    assert.equal(after['$listings.@1'], before['$listings.@1'])
  })

  it('move a subtree: a new address, the same form', () => {
    const moved = {
      ...base,
      phases: {
        categories: [
          ['[util]/template', {note: 'added first'}],
          base.phases.categories
        ],
        listings: base.phases.listings
      }
    }
    const before = hashesOf(base)
    const after = hashesOf(moved)
    assert.equal(after['$categories.@2'], before['$categories.@1'])
    assert.equal(after['$listings.@1a2'], before['$listings.@1a2'])
  })

  it('gives identical calls one form hash', () => {
    const hashes = hashesOf({
      given: {u: 'x'},
      services,
      phases: {
        a: ['[scraper]/extract', {url: '$given.u'}],
        b: ['[scraper]/extract', {url: '$given.u'}]
      }
    })
    assert.equal(hashes['$a.@1'], hashes['$b.@1'])
  })

  it('distinguishes trigger payloads', () => {
    const query = {trigger: {kind: 'webhook'}, services, phases: {a: ['[scraper]/extract', {url: '$trigger.url'}]}}
    const one = formsOf(compile(query), {trigger: {url: 'one'}})
    const two = formsOf(compile(query), {trigger: {url: 'two'}})
    assert.notEqual(one.calls.get('$a.@1').hash, two.calls.get('$a.@1').hash)
    assert.notEqual(one.queryHash, two.queryHash)
  })

  it('returns a readable form that holds upstream hashes, not upstream forms', () => {
    const forms = formsOf(compile(base))
    const {form} = forms.calls.get('$listings.@1')
    assert.equal(form.key, '[util]/each')
    assert.deepEqual(form.args.on, {phase: forms.calls.get('$categories.@1').hash, path: []})
    assert.match(form.positions.service[0], /^[0-9a-f]{64}$/)
  })
})
