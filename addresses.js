/**
 * @fileoverview Service Call Addresses ↔ JSON paths.
 *
 * An address names one call within one Query version: `$listings.@1a2` is
 * the second call in the chain of the first call field of the
 * phase's first call. A call's fields follow its address by name:
 * `$listings.@1.url`. Addresses are calculated, never stored in the Query.
 *
 * Both directions are pure lookups over a plan's calls, each of which carries
 * its address, its JSON path, and the path of its arguments.
 */

import {parseFieldPath} from './common.js'

// A call address, then an optional field path.
const ADDRESS = /^(.+?\.@\d+(?:[a-z]\d+)*)(?:\.(.+))?$/

// The JSON path of one of a call's fields, by its field path: method syntax
// keeps its target at index 0 of the descriptor; every other field lives in
// the arguments object.
export const fieldPathOf = (call, field) =>
  call.targetField === field ? [...call.path, 0] : [...call.argsPath, ...parseFieldPath(field)]

// The JSON path within the Query of an address, or undefined.
export function addressToPath(plan, address) {
  const match = address.match(ADDRESS)
  const call = match && plan.calls.find(c => c.address === match[1])
  if (!call) return undefined
  if (!match[2]) return call.path
  const target = call.targetField
  if (target && (match[2] === target || match[2].startsWith(`${target}.`))) {
    return [...call.path, 0, ...match[2].slice(target.length + 1).split('.').filter(Boolean)]
  }
  return [...call.argsPath, ...match[2].split('.')]
}

const startsWith = (path, prefix) => prefix.every((segment, i) => path[i] === segment)

// A call's address followed by a field path, if there is one.
const withField = (address, fieldPath) => fieldPath.length ? `${address}.${fieldPath.join('.')}` : address

// The address of a JSON path within the Query: the deepest call containing it,
// then the field path inside that call. Undefined outside any call.
export function pathToAddress(plan, path) {
  const call = plan.calls
    .filter(c => startsWith(path, c.path))
    .reduce((deepest, c) => (!deepest || c.path.length > deepest.path.length ? c : deepest), undefined)
  if (!call) return undefined

  const rest = path.slice(call.path.length)
  if (rest.length === 0) return call.address
  if (call.targetField && rest[0] === 0) return withField(call.address, [call.targetField, ...rest.slice(1)])
  if (startsWith(path, call.argsPath)) return withField(call.address, path.slice(call.argsPath.length))
  return undefined
}
