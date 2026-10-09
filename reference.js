/**
 * @fileoverview References — how a Query names a value.
 *
 * A reference is a sigil, an identifier, then an optional path of `.field`
 * and `[index]` segments. What a reference points to is known before its path
 * is read:
 *
 *   $name.path   a node — a phase, $given or $trigger — global, resolved by name
 *   @ / @.path   the value flowing in: the previous call in a chain, the current
 *                item of an iteration, or the error in onError
 *   @name.path   the value of the enclosing iteration named `name` by `as:`
 *   @err.path    the error of the enclosing onError; @@err the one outside
 *                it, @@@err the next, counting onError nesting only
 *
 * Every string beginning with $ or @ is a reference; one that doesn't parse is
 * an error, so a literal like "$5.00" is supplied through `given`. One pattern
 * serves both dependency extraction (compile) and resolution (execute).
 */

import _ from 'lodash'

const PATH = '((?:\\.[^.[\\]]+|\\[\\d+\\])*)'
const REFERENCE = new RegExp(`^([$@])([A-Za-z_]\\w*)?${PATH}$`)

// The error ladder: `@err`, `@@err`, `@@@err` — one @ per onError outward.
const ERROR_REFERENCE = new RegExp(`^(@+)err${PATH}$`)

// One path segment: `.field` or an index `[0]`.
const SEGMENT = /\.([^.[\]]+)|\[(\d+)\]/g

// A path segment that is a Service Call Address step (`@1a2`); JSON-LD style
// field names like `@type` stay ordinary segments.
const ADDRESS_SEGMENT = /^@\d/

export const isReference = (value) =>
  typeof value === 'string' && (value.startsWith('$') || value.startsWith('@'))

// The reason a reference-shaped string is not a valid reference, or undefined.
const malformation = (text, match) => {
  if (text === '$') return 'Bare $ is not supported. Reference a phase by name: $name'
  if (text.startsWith('$.')) return `The $.name form is replaced by $name. Use '$${text.slice(2)}'`
  if (text.startsWith('@@')) return '@@ is removed. Name the iteration with as: and reference it as @name'
  if (!match || (match[1] === '$' && !match[2])) {
    return 'A literal string beginning with $ or @ must be supplied through given'
  }
}

const pathOf = (text, dotted) => {
  const path = Array.from(dotted.matchAll(SEGMENT), ([, field, index]) => field ?? index)
  if (path.some(segment => ADDRESS_SEGMENT.test(segment))) {
    throw new Error(`Invalid reference '${text}': Service call addresses are not reliable references in queries - they break when ordering changes. Use an alias instead.`)
  }
  return path
}

// A reference's parts: {sigil, name, path}, plus `depth` for the error
// ladder. Throws when the string is reference-shaped but malformed.
export function parseReference(text) {
  const error = text.match(ERROR_REFERENCE)
  if (error) return {sigil: '@', name: 'err', depth: error[1].length, path: pathOf(text, error[2])}

  const match = text.match(REFERENCE)
  const problem = malformation(text, match)
  if (problem) throw new Error(`Invalid reference '${text}': ${problem}`)

  const [, sigil, name, dotted] = match
  return {sigil, name, path: pathOf(text, dotted)}
}

// Scope: what an `@` reference can see — {flow, bindings, errors}. The same
// shape holds runtime values (execute), forms (forms.js) and types (plan.js).
export const rootScope = {flow: null, bindings: {}, errors: []}

// The scope inside a position, for one input: a lone call receives the input
// as `@`, the position's `as:` names it, and onError adds it to the errors.
export const enterPosition = (position, scope, input) => ({
  flow: position.chain ? null : input,
  bindings: position.as ? {...scope.bindings, [position.as]: input} : scope.bindings,
  errors: position.field === 'onError' ? [...scope.errors, input] : scope.errors
})

// What an `@` reference names in a scope, before its path.
export const scopedRoot = ({name, depth}, scope) =>
  depth ? scope.errors[scope.errors.length - depth]
    : name ? scope.bindings[name]
      : scope.flow

// The value a reference names, given the current scope and the resolved nodes.
export function resolveReference(ref, scope, nodes) {
  const root = ref.sigil === '$' ? nodes[ref.name] : scopedRoot(ref, scope)
  return ref.path.length ? _.get(root, ref.path) : root
}
