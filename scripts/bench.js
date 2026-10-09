// Engine overhead benchmark: services answer instantly, so time is MicroQL's own.
// Usage: npm run bench                          (this checkout)
//        node scripts/bench.js old <query.js>   (0.6.6, extracted per performance.md)
import {pathToFileURL} from 'node:url'
import path from 'node:path'

const [version = 'new', modulePath = 'index.js'] = process.argv.slice(2)
const {default: query} = await import(pathToFileURL(path.resolve(modulePath)).href)
const old = version === 'old'

const echo = {}
const define = (name, fn) => { echo[old ? name : `/${name}`] = fn }
define('get', async ({id}) => ({id}))
define('add1', async ({on}) => on + 1)
echo[old ? 'add1' : '/add1']._argtypes = {on: {argOrder: 0}}

const key = (action) => old ? `echo:${action}` : `GET [echo]/${action}`
const ref = (name) => old ? `$.${name}` : `$${name}`
const phasesKey = old ? 'queries' : 'phases'
const each = old ? 'util:map' : 'GET [util]/each'

// Each workload: [name, calls it makes, config]
const workloads = [
  ['200 independent phases', 200, () => ({[phasesKey]: Object.fromEntries(Array.from({length: 200}, (_, i) => [`p${i}`, [key('get'), {id: i}]]))})],
  ['each over 1000 items', 1000, () => ({given: {ids: Array.from({length: 1000}, (_, i) => i)}, [phasesKey]: {all: [ref('given.ids'), each, {service: [key('get'), {id: '@'}]}]}})],
  ['chain of 100 steps', 100, () => ({given: {n: 0}, [phasesKey]: {chain: [[ref('given.n'), key('add1')], ...Array.from({length: 99}, () => ['@', key('add1')])]}})]
]

const median = (xs) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)]

// Median ms of 7 warm runs of fn, after one warm-up run.
async function time(fn) {
  await fn()
  const times = []
  for (let i = 0; i < 7; i++) {
    const start = performance.now()
    await fn()
    times.push(performance.now() - start)
  }
  return median(times)
}

const results = {version}
for (const [name, calls, config] of workloads) {
  const ms = await time(() => query({services: {echo}, ...config()}))
  results[name] = {ms: +ms.toFixed(1), usPerCall: +((ms * 1000) / calls).toFixed(0)}
}

console.log(JSON.stringify(results))
