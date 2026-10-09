import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import {parseReference, isReference, resolveReference} from '../reference.js'

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

  // [string, error pattern]
  const invalid = [
    ['$', /Bare \$ is not supported/],
    ['$.given.x', /\$\.name form is replaced by \$name.*'\$given\.x'/],
    ['$.', /\$\.name form is replaced/],
    ['@@', /@@ is removed/],
    ['@@@.naics', /@@ is removed/],
    ['@@item', /@@ is removed/],
    ['$listings.@1a2', /Service call addresses are not reliable references in queries - they break when ordering changes. Use an alias instead./],
    ['@listing.@2', /Service call addresses are not reliable references/],
    ['$5.00', /must be supplied through given/],
    ['@acme corp', /must be supplied through given/],
    ['$a..b', /must be supplied through given/],
    ['$a[x]', /must be supplied through given/]
  ]

  for (const [text, pattern] of invalid) {
    it(`rejects ${text}`, () => {
      assert.throws(() => parseReference(text), pattern)
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
