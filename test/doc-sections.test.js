import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import {replaceSection} from '../scripts/lib/sections.js'

describe('generated sections', () => {
  const doc = [
    '# Title',
    'Hand-written intro.',
    '<!-- generated:table -->',
    'old table',
    '<!-- /generated:table -->',
    'Hand-written outro.'
  ].join('\n')

  it('replaces only the text between the markers', () => {
    assert.equal(replaceSection(doc, 'table', 'new table\n'), [
      '# Title',
      'Hand-written intro.',
      '<!-- generated:table -->',
      'new table',
      '<!-- /generated:table -->',
      'Hand-written outro.'
    ].join('\n'))
  })

  it('is stable: replacing with the same body changes nothing', () => {
    const once = replaceSection(doc, 'table', 'body')
    assert.equal(replaceSection(once, 'table', 'body'), once)
  })

  it('leaves other sections alone', () => {
    const two = `${doc}\n<!-- generated:other -->\nkeep\n<!-- /generated:other -->`
    assert.match(replaceSection(two, 'table', 'x'), /generated:other -->\nkeep\n/)
  })

  // [description, text]
  const missing = [
    ['no markers', '# Title'],
    ['no closing marker', '<!-- generated:table -->\nold'],
    ['markers out of order', '<!-- /generated:table -->\n<!-- generated:table -->']
  ]

  for (const [description, text] of missing) {
    it(`refuses a document with ${description}`, () => {
      assert.throws(() => replaceSection(text, 'table', 'x'), /No generated section 'table'/)
    })
  }
})
