/**
 * @fileoverview A service written as a table of operations.
 *
 * Core asks a service for two things: `lookup(parts)`, the operation answering
 * a key's parts, and `operations()`, every operation it has. A table is the
 * plainest way to answer both: resources ('/each') map to an operation, or to
 * one operation per verb ({GET, POST}). An operation is {description, input,
 * output, call} (see declaration.js), or just its call when it declares
 * nothing. `init` and `tearDown` in the table are the service's lifecycle,
 * and `requires` lists the runtime keys it uses.
 *
 * Operations and hooks run with the table as `this`, so a table can keep the
 * runtime it was given at init.
 */

const isOperation = (entry) => typeof entry === 'function' || typeof entry?.call === 'function'

// An operation as core receives it: its resource and verb, its declaration,
// and its call bound to the table.
function operationOf(table, resource, method, entry) {
  const {call, ...declaration} = typeof entry === 'function' ? {call: entry} : entry
  return {...declaration, resource, method, call: (fields) => call.call(table, fields)}
}

// Each resource's operations, by verb; a verbless operation is filed under null.
function operationsByResource(table) {
  const resources = Object.keys(table).filter(key => key.startsWith('/'))
  return new Map(resources.map(resource => {
    const entry = table[resource]
    const byVerb = isOperation(entry) ? [[null, entry]] : Object.entries(entry)
    return [resource, new Map(byVerb.map(([method, op]) => [method, operationOf(table, resource, method, op)]))]
  }))
}

const verbsOf = (byVerb) => [...byVerb.keys()].join(', ')

/**
 * A service answering from a table: lookup and operations, plus the table's
 * requires, init and tearDown when it has them.
 */
export function serviceFromTable(table) {
  const resources = operationsByResource(table)
  const name = (service, resource) => `[${service}]${resource}`

  function lookup({service, resource, method}) {
    const byVerb = resources.get(resource)
    if (!byVerb) return undefined
    if (byVerb.has(null)) {
      if (method !== null) throw new Error(`${name(service, resource)} takes no verb; got ${method}`)
      return byVerb.get(null)
    }
    if (method === null) throw new Error(`${name(service, resource)} needs a verb: ${verbsOf(byVerb)}`)
    if (!byVerb.has(method)) throw new Error(`${name(service, resource)} doesn't answer ${method} (answers ${verbsOf(byVerb)})`)
    return byVerb.get(method)
  }

  return {
    lookup,
    operations: () => [...resources.values()].flatMap(byVerb => [...byVerb.values()]),
    ...(table.requires && {requires: table.requires}),
    ...(table.init && {init: (runtime) => table.init(runtime)}),
    ...(table.tearDown && {tearDown: () => table.tearDown()})
  }
}
