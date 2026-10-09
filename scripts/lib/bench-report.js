/**
 * @fileoverview The benchmark report — several runs of scripts/bench.js,
 * reduced to a range per workload and rendered as the results table in
 * performance.md.
 */

// Each workload's call count and the range of µs per call across runs.
export function rangesOf(runs) {
  const workloads = Object.keys(runs[0]).filter(key => key !== 'version')
  return Object.fromEntries(workloads.map(name => {
    const perCall = runs.map(run => run[name].usPerCall)
    return [name, {calls: runs[0][name].calls, min: Math.min(...perCall), max: Math.max(...perCall)}]
  }))
}

const rangeText = ({min, max}) => min === max ? `${min}` : `${min}–${max}`

// The results as markdown: how they were measured, then a row per workload.
export const renderResults = ({current, baseline, runs, environment}) => [
  `Measured ${new Date().toISOString().slice(0, 10)}: ${environment}. Range of ${runs} runs, each the median of 7 warm runs after one warm-up, in µs per call.`,
  '',
  '| Workload | Calls | 0.6.6 | this checkout |',
  '|---|---|---|---|',
  ...Object.entries(current).map(([name, range]) =>
    `| ${name} | ${range.calls} | ${rangeText(baseline[name])} | ${rangeText(range)} |`)
].join('\n')
