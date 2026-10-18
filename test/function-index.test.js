import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import {definitionsOf, functionIndex, isCore, renderIndex} from '../scripts/lib/function-index.js'

describe('function index', () => {
  describe('definitions', () => {
    // [source, expected {line, name, kind, lines}]
    const cases = [
      ['function a() {\n  return 1\n}', [{line: 1, name: 'a', kind: 'function', lines: 3}]],
      ['export const b = (x) => x', [{line: 1, name: 'b', kind: 'const', lines: 1}]],
      ['let c = function () {}', [{line: 1, name: 'c', kind: 'let', lines: 1}]],
      ['const d = 5', []],
      ['const o = {\n  e() {},\n  \'/f\': async () => 1,\n  g: 2\n}', [
        {line: 2, name: 'e', kind: 'property', lines: 1},
        {line: 3, name: '/f', kind: 'property', lines: 1}
      ]],
      ['class K {\n  h() {}\n}', [{line: 2, name: 'h', kind: 'method', lines: 1}]],
      ['function outer() {\n  const inner = () => 1\n}', [
        {line: 1, name: 'outer', kind: 'function', lines: 3},
        {line: 2, name: 'inner', kind: 'const', lines: 1}
      ]],
      ['[1].map(x => x)\nexport default function () {}', []]
    ]

    for (const [source, expected] of cases) {
      it(`finds ${expected.map(d => d.name).join(', ') || 'nothing'} in ${JSON.stringify(source.split('\n')[0])}`, () => {
        assert.deepEqual(definitionsOf(source), expected)
      })
    }
  })

  describe('references', () => {
    const sources = {
      'a.js': [
        'export const used = () => 1',
        'export function unused() {}',
        'const local = () => used()',
        'local()',
        'const obj = {used: 1, local}',
        'obj.used',
        'export {local}',
        'export default local'
      ].join('\n'),
      'services/b.js': [
        'import {used as renamed} from \'../a.js\'',
        'import local from \'../a.js\'',
        'renamed()',
        'renamed()',
        'local()',
        'const service = {method() {}}'
      ].join('\n')
    }
    const index = functionIndex(sources, new Set(['unused']))
    const row = (file, name) => index.find(f => f.file === file).definitions.find(d => d.name === name)

    // [file, name, refs, in 0.6]
    const cases = [
      ['a.js', 'used', 3, false],
      ['a.js', 'unused', 0, true],
      ['a.js', 'local', 3, false],
      ['services/b.js', 'method', undefined, false]
    ]

    for (const [file, name, refs, old] of cases) {
      it(`counts ${refs ?? 'no'} refs to ${name} in ${file}`, () => {
        assert.equal(row(file, name).refs, refs)
        assert.equal(row(file, name).old, old)
      })
    }

    it('renders a table per file, in the order given', () => {
      const markdown = renderIndex(index)
      assert.match(markdown, /^## a\.js\n\n\| line \| name \| kind \| lines \| refs \| 0\.6 \|/)
      assert.match(markdown, /\| 2 \| `unused` \| function \| 1 \| 0 \| ✓ \|/)
      assert.ok(markdown.includes('| 6 | `method` | property | 1 | — |  |'))
      assert.ok(markdown.indexOf('## a.js') < markdown.indexOf('## services/b.js'))
    })
  })

  // [path, is core]
  const files = [
    ['src/query/compile.js', true],
    ['src/service/util.js', true],
    ['core.js', true],
    ['eslint.config.js', false],
    ['test/forms.test.js', false],
    ['scripts/bench.js', false],
    ['README.md', false]
  ]

  for (const [file, core] of files) {
    it(`${core ? 'includes' : 'excludes'} ${file}`, () => {
      assert.equal(isCore(file), core)
    })
  }
})
