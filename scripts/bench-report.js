// Regenerates the results table in performance.md: runs the benchmark several
// times against this checkout and against the baseline (0.6.6), each run in a
// fresh process. The first use installs the baseline's dependencies in the
// system temp directory. Usage: npm run docs:bench
import {execFileSync} from 'node:child_process'
import {rm} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {rangesOf, renderResults} from './lib/bench-report.js'
import {baselineCheckout} from './lib/baseline.js'
import {writeSection} from './lib/sections.js'

const RUNS = 5
const BENCH = path.resolve('scripts/bench.js')

// One benchmark run, as the JSON line bench.js prints.
const benchRun = (cwd, version, entry) =>
  JSON.parse(execFileSync(process.execPath, [BENCH, version, entry], {cwd, encoding: 'utf8'}))

const runsOf = (cwd, version, entry) => Array.from({length: RUNS}, () => benchRun(cwd, version, entry))

const baselineDir = await baselineCheckout()
const baseline = rangesOf(runsOf(baselineDir, 'old', 'query.js'))
await rm(path.join(baselineDir, '.cache'), {recursive: true, force: true}) // 0.6.6 writes one on compile
const current = rangesOf(runsOf('.', 'new', 'index.js'))

const environment = `node ${process.version}, ${os.cpus().length} cores, ${os.type()} ${os.release()}`
await writeSection('performance.md', 'bench-results', renderResults({current, baseline, runs: RUNS, environment}))
console.log('performance.md: results regenerated')
