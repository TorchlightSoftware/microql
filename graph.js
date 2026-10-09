/**
 * @fileoverview The phase graph — which phases run together.
 *
 * Phases form a DAG inferred from their `$name` references. A column is a set
 * of phases whose dependencies are all in earlier columns; columns run in
 * order, and the phases of a column run in parallel.
 */

// The phases' columns, in order. A cycle is a compile-time error.
export function columnsOf(phases) {
  const columns = []
  const placed = new Set()
  const pending = Object.values(phases)

  while (placed.size < pending.length) {
    const ready = pending.filter(phase =>
      !placed.has(phase.name) && phase.dependencies.difference(placed).size === 0)

    if (ready.length === 0) {
      const remaining = pending.filter(phase => !placed.has(phase.name)).map(phase => phase.name)
      throw new Error(`Circular dependency detected at compile time: ${remaining.join(', ')}`)
    }

    ready.forEach(phase => placed.add(phase.name))
    columns.push(ready.map(phase => phase.name))
  }
  return columns
}

// A phase and every phase it depends on, transitively.
export function upstreamOf(phases, name) {
  const found = new Set()
  const visit = (current) => {
    if (found.has(current)) return
    found.add(current)
    phases[current].dependencies.forEach(visit)
  }
  visit(name)
  return found
}
