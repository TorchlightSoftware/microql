import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import {parseReference, isReference, resolveReference, mapReferences} from '../src/query/reference.js'

describe('Reference grammar', () => {
  // [string, parsed reference]
  const valid = [
    ['$listings', {sigil: '$', name: 'listings', path: []}],
    ['$given.baseUrl', {sigil: '$', name: 'given', path: ['baseUrl']}],
    ['$trigger.body.items.0', {sigil: '$', name: 'trigger', path: ['body', 'items', '0']}],
    ['@', {sigil: '@', name: undefined, path: []}],
    ['@.categories', {sigil: '@', name: undefined, path: ['categories']}],
    ['@listing', {sigil: '@', name: 'listing', path: []}],
    ['@listing.images', {sigil: '@', name: 'listing', path: ['images']}],
    ['@item.@type', {sigil: '@', name: 'item', path: ['@type']}],
    ['$_private', {sigil: '$', name: '_private', path: []}],
    ['$given.values[0]', {sigil: '$', name: 'given', path: ['values', '0']}],
    ['@[1].name', {sigil: '@', name: undefined, path: ['1', 'name']}],
    ['@err', {sigil: '@', name: 'err', depth: 1, path: []}],
    ['@err.message', {sigil: '@', name: 'err', depth: 1, path: ['message']}],
    ['@@err.args.url', {sigil: '@', name: 'err', depth: 2, path: ['args', 'url']}],
    ['@@@err', {sigil: '@', name: 'err', depth: 3, path: []}],
    ['@errors', {sigil: '@', name: 'errors', path: []}]
  ]

  for (const [text, expected] of valid) {
    it(`parses ${text}`, () => {
      assert.deepEqual(parseReference(text), expected)
    })
  }

  // [string, the error: its code and details]
  const invalid = [
    ['$', {code: 'bare-reference', reference: '$'}],
    ['$.given.x', {code: 'retired-key', retired: '$.given.x', replacement: /'\$given\.x'/}],
    ['$.', {code: 'retired-key', retired: '$.'}],
    ['@@', {code: 'retired-key', retired: '@@'}],
    ['@@@.naics', {code: 'retired-key', retired: '@@@.naics'}],
    ['@@item', {code: 'retired-key', retired: '@@item'}],
    ['$listings.@1a2', {code: 'address-reference', reference: '$listings.@1a2'}],
    ['@listing.@2', {code: 'address-reference', reference: '@listing.@2'}],
    ['$5.00', {code: 'invalid-reference', reference: '$5.00'}],
    ['@acme corp', {code: 'invalid-reference', reference: '@acme corp'}],
    ['$a..b', {code: 'invalid-reference', reference: '$a..b'}],
    ['$a[x]', {code: 'invalid-reference', reference: '$a[x]'}]
  ]

  for (const [text, error] of invalid) {
    it(`rejects ${text}`, () => {
      assert.throws(() => parseReference(text), error)
    })
  }

  it('treats every string beginning with $ or @ as a reference', () => {
    assert.equal(isReference('$x'), true)
    assert.equal(isReference('@'), true)
    assert.equal(isReference('user@example.com'), false)
    assert.equal(isReference('cost: $5'), false)
    assert.equal(isReference(5), false)
  })
})

describe('Reference resolution', () => {
  const nodes = {given: {a: {b: 1}}, listings: [{href: 'x'}]}
  const scope = {flow: {name: 'flow'}, bindings: {listing: {href: 'y', '@type': 'Org'}}, errors: [{message: 'outer'}, {message: 'inner'}]}

  // [reference, expected value]
  const cases = [
    ['$given.a.b', 1],
    ['$listings.0.href', 'x'],
    ['@', {name: 'flow'}],
    ['@.name', 'flow'],
    ['@listing.href', 'y'],
    ['@err.message', 'inner'],
    ['@@err.message', 'outer'],
    ['@listing.@type', 'Org'],
    ['$given.missing', undefined],
    ['@.missing.deeper', undefined]
  ]

  for (const [text, expected] of cases) {
    it(`resolves ${text}`, () => {
      assert.deepEqual(resolveReference(parseReference(text), scope, nodes), expected)
    })
  }
})

describe('mapReferences', () => {
  // [value, expected, with each reference replaced by its text in brackets]
  const cases = [
    ['$given.a', '<$given.a>'],
    ['literal', 'literal'],
    [{url: '@', nested: {list: ['$a', 2, null]}}, {url: '<@>', nested: {list: ['<$a>', 2, null]}}],
    [[{id: '@item.id'}], [{id: '<@item.id>'}]]
  ]

  for (const [value, expected] of cases) {
    it(`maps ${JSON.stringify(value)}`, () => {
      assert.deepEqual(mapReferences(value, text => `<${text}>`), expected)
    })
  }

  it('leaves instances alone, references inside them included', () => {
    const date = new Date(0)
    const instance = new (class Holder { ref = '$a' })()
    const mapped = mapReferences({date, instance}, () => 'replaced')
    assert.equal(mapped.date, date)
    assert.equal(mapped.instance, instance)
  })
})
