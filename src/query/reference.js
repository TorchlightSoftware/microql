/**
 * @fileoverview References — how a Query names a value.
 *
 * A reference is a sigil, an identifier, then an optional path of `.field`
 * and `[index]` segments. What a reference points to is known before its path
 * is read:
 *
 *   $name.path   a node — a phase, $given or $trigger — global, resolved by name
 *   @ / @.path   the value flowing in: the previous call in a chain, the current
 *                item of an iteration, or the error in catch
 *   @name.path   the value of the enclosing iteration named `name` by `as:`
 *   @err.path    the error of the enclosing catch; @@err the one outside
 *                it, @@@err the next, counting catch nesting only
 *
 * Every string beginning with $ or @ is a reference; one that doesn't parse is
 * an error, so a literal like "$5.00" is supplied through `given`. One pattern
 * serves both dependency extraction (compile) and resolution (execute).
 */

import {isPlainObject, mapValues, getIn} from '../common/common.js'

const PATH = '((?:\\.[^.[\\]]+|\\[\\d+\\])*)'
const REFERENCE = new RegExp(`^([$@])([A-Za-z_]\\w*)?${PATH}$`)

// The error ladder: `@err`, `@@err`, `@@@err` — one @ per catch outward.
const ERROR_REFERENCE = new RegExp(`^(@+)err${PATH}$`)

// One path segment: `.field` or an index `[0]`.
const SEGMENT = /\.([^.[\]]+)|\[(\d+)\]/g

// A path segment that is a Service Call Address step (`@1a2`); JSON-LD style
// field names like `@type` stay ordinary segments.
const ADDRESS_SEGMENT = /^@\d/

export const isReference = (value) =>
  typeof value === 'string' && (value.startsWith('$') || value.startsWith('@'))

// Arguments with each reference replaced by what `replace` makes of its text:
// the walk shared by resolution (execute) and forms. Arrays and plain objects
// are walked; every other value is kept as it is.
export const mapReferences = (value, replace) => {
  if (isReference(value)) return replace(value)
  if (Array.isArray(value)) return value.map(v => mapReferences(v, replace))
  if (isPlainObject(value)) return mapValues(value, v => mapReferences(v, replace))
  return value
}

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

// Context: what an `@` reference can see — {flow, bindings, errors}. The same
// shape holds runtime values (execute), forms (forms.js) and types (plan.js).
export const rootContext = {flow: null, bindings: {}, errors: []}

// The context inside a position, for one input: a lone call receives the input
// as `@`, and the position's `as:` names the item, which is the input itself
// except in a catch, whose input is the error and whose item is the one whose
// call failed; catch adds its input to the errors.
export const enterPosition = (position, context, input, item = input) => ({
  flow: position.chain ? null : input,
  bindings: position.as ? {...context.bindings, [position.as]: item} : context.bindings,
  errors: position.field === 'catch' ? [...context.errors, input] : context.errors
})

// What an `@` reference names in a context, before its path.
export const contextRoot = ({name, depth}, context) =>
  depth ? context.errors[context.errors.length - depth]
    : name ? context.bindings[name]
      : context.flow

// A reference as a read: what it names in terms that hold anywhere in the
// Query — a node or a binding by name, an error by the level of the catch that
// holds it (1 the outermost) — plus its path, and a key naming the read. A
// call's reads from outside itself are part of its input (see compile.js).
export function readOf({sigil, name, depth, path}, context) {
  const level = depth ? context.errors - depth + 1 : undefined
  const root = level ? `err${level}` : `${sigil}${name ?? ''}`
  return {sigil, name, level, path, key: [root, ...path].join('.')}
}

// Whether a read, made inside a call compiled in this context, names something
// bound outside it: any node, a binding the context already has, or the error of
// a catch around it. The flow `@` is always bound inside.
export const readsOutside = (read, context) =>
  read.sigil === '$' || (read.level ? read.level <= context.errors : Boolean(read.name) && context.bindings.includes(read.name))

// The value a read names in a context, as the Run resolves it.
export function resolveRead({sigil, name, level, path}, context, nodes) {
  const root = sigil === '$' ? nodes[name] : level ? context.errors[level - 1] : context.bindings[name]
  return getIn(root, path)
}

// The value a reference names, given the current context and the resolved nodes.
export function resolveReference(ref, context, nodes) {
  const root = ref.sigil === '$' ? nodes[ref.name] : contextRoot(ref, context)
  return getIn(root, ref.path)
}
