import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import {readFile} from 'node:fs/promises'
import {ESLint} from 'eslint'

const eslint = new ESLint()

// The rule ids reported for some source, linted as if it lived at `filePath`.
const rulesFired = async (code, filePath) => {
  const [result] = await eslint.lintText(code, {filePath})
  return result.messages.map(m => m.ruleId)
}

describe('core is platform-free', () => {
  // [import, file it appears in, banned]
  const cases = [
    ['import fs from \'fs\'\nfs()', 'execute.js', true],
    ['import fs from \'node:fs\'\nfs()', 'compile.js', true],
    ['import {inspect} from \'util\'\ninspect()', 'wrappers.js', true],
    ['import fs from \'fs-extra\'\nfs()', 'services/util.js', true],
    ['import {sha256} from \'@noble/hashes/sha2.js\'\nsha256()', 'forms.js', false],
    ['import fs from \'node:fs\'\nfs()', 'node.js', false],
    ['import fs from \'node:fs\'\nfs()', 'test/anything.test.js', false]
  ]

  for (const [code, filePath, banned] of cases) {
    it(`${banned ? 'bans' : 'allows'} ${code.split('\n')[0]} in ${filePath}`, async () => {
      assert.equal((await rulesFired(code, filePath)).includes('no-restricted-imports'), banned)
    })
  }

  it('bans node globals in core', async () => {
    assert.ok((await rulesFired('process.stdout.write("x")\n', 'execute.js')).includes('no-undef'))
  })

  it('holds for every core file', async () => {
    const results = await eslint.lintFiles(['*.js', 'services/*.js'])
    const violations = results.flatMap(r => r.messages
      .filter(m => ['no-restricted-imports', 'no-undef'].includes(m.ruleId))
      .map(m => `${r.filePath}:${m.line} ${m.message}`))
    assert.deepEqual(violations, [])
  })
})

describe('entry points', () => {
  it('maps workerd to core and node to the node entry point', async () => {
    const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
    assert.deepEqual(pkg.exports['.'], {workerd: './index.js', node: './node.js', default: './index.js'})
  })

  it('resolves to the node entry point under node', async () => {
    const microql = await import('microql')
    assert.equal(typeof microql.nodeRuntime, 'object')
    assert.equal(typeof microql.default, 'function')
  })
})
