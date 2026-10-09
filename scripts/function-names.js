// Regenerates the function tables in function-names.md from core as it is
// now, marking the names the baseline (0.6.6) core also defined. Usage: npm run docs:functions
import {readFile, readdir} from 'node:fs/promises'
import {definitionsOf, functionIndex, isCore, renderIndex} from './lib/function-index.js'
import {baselineFiles, baselineSource} from './lib/baseline.js'
import {writeSection} from './lib/sections.js'

// The core files of the working tree, with their sources, in path order.
async function currentSources() {
  const files = [...await readdir('.'), ...(await readdir('services')).map(f => `services/${f}`)].filter(isCore).sort()
  return Object.fromEntries(await Promise.all(files.map(async file => [file, await readFile(file, 'utf8')])))
}

// The names 0.6.6 core defined.
const baselineNames = () =>
  new Set(baselineFiles().filter(isCore).flatMap(file => definitionsOf(baselineSource(file)).map(d => d.name)))

await writeSection('function-names.md', 'function-names', renderIndex(functionIndex(await currentSources(), baselineNames())))
console.log('function-names.md: regenerated')
