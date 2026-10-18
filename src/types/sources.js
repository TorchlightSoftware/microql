/**
 * @fileoverview Sources — MicroQL's dynamic types: what `['type', source]`
 * means in a declaration (see declaration.js).
 *
 * zodly reserves the type name `type` for dynamic types and leaves its meaning
 * to MicroQL: a source names a type that follows from a call's fields, which
 * only plan() knows. A source is an object of one key: a reader reads a type,
 * an operator computes one from a pair of sources.
 *
 *   {fromField: path}         the type of another field (a call field: what
 *                             its nested call returns)
 *   {fromList: path}          one item of a list field
 *   {fromObject: path}        one value of an object field
 *   {fromValue: path}         the field's value, as a literal type: ['name']
 *                             is the tuple of literal 'name'
 *   {fromZodly: descriptor}   a fixed zodly type, as an operator's operand
 *   {fromZodly: source}       the zodly descriptor the source's value is
 *   {picked: [a, keys]}       a with only the fields keys names, as [util]/pick
 *   {merged: [a, b]}          b laid over a, as [util]/merge
 *   {without: [a, b]}         a's members less those that fit b
 *
 * Paths name fields of the service call's input, dotted, with `..` for a dot
 * inside a field name. Sources resolve against a call's bindings: its fields'
 * types as plan() works them out (`typeOf`), their values (`valueAt`), and
 * zodly's `parse`, for an operand written in zodly.
 */

import {isPlainObject} from '../common/common.js'
import {isReference} from '../query/reference.js'
import {any, elementOf, fieldValueOf, literalTypeOf, schemaOfDescriptor, pick, merge, difference} from './types.js'

const refuse = (kind, takes) => {
  throw new Error(`${kind} takes ${takes}`)
}

// What each kind of source takes: a check of its value that throws what's
// wrong. `parse` reads a zodly descriptor by the preprocessors of the reading
// the source is in.
const TAKES = {
  path: (kind, value) => typeof value === 'string' || refuse(kind, 'a field path'),
  zodly: (kind, value, parse) => isPlainObject(value) ? checkSource(value, parse) : parse(value),
  pair: (kind, value, parse) => Array.isArray(value) && value.length === 2
    ? value.forEach(source => checkSource(source, parse))
    : refuse(kind, '[source, source]')
}

// A type operator over the types of a pair of sources.
const onPair = (operator) => ([one, other], bindings) => operator(resolveSource(one, bindings), resolveSource(other, bindings))

// Each kind of source: what it takes, and the type it names given a call's bindings.
const SOURCES = {
  fromField: {takes: 'path', resolve: (path, bindings) => bindings.typeOf(path)},
  fromList: {takes: 'path', resolve: (path, bindings) => elementOf(bindings.typeOf(path))},
  fromObject: {takes: 'path', resolve: (path, bindings) => fieldValueOf(bindings.typeOf(path))},
  fromValue: {takes: 'path', resolve: (path, bindings) => literalTypeOf(bindings.valueAt(path), isReference)},
  fromZodly: {
    takes: 'zodly',
    resolve: (value, bindings) => isPlainObject(value) ? schemaOfDescriptor(resolveSource(value, bindings)) : bindings.parse(value)
  },
  picked: {takes: 'pair', resolve: onPair(pick)},
  merged: {takes: 'pair', resolve: onPair(merge)},
  without: {takes: 'pair', resolve: onPair(difference)}
}

/**
 * A source, checked whole, so that a malformed one is refused where it's
 * declared; `parse` reads its zodly operands.
 */
export function checkSource(source, parse) {
  const keys = isPlainObject(source) ? Object.keys(source) : []
  if (keys.length !== 1 || !Object.hasOwn(SOURCES, keys[0])) {
    throw new Error(`A source has exactly one of ${Object.keys(SOURCES).join(', ')}. Got: ${JSON.stringify(source)}`)
  }
  const [kind] = keys
  TAKES[SOURCES[kind].takes](kind, source[kind], parse)
  return source
}

// The type a source names, given a call's bindings.
export function resolveSource(source, bindings) {
  const [[kind, value]] = Object.entries(source)
  return SOURCES[kind].resolve(value, bindings)
}

/**
 * zodly preprocessors for `type`, each a form's reading: checked, as any,
 * keeping its modifiers, for what's fixed before plan(); resolved against a
 * call's bindings, for plan(). Either reads a source's zodly operands with
 * zodly's `parse`, by the same preprocessors as the form.
 */
export const checkedAsAny = ([, source, ...modifiers], path, {parse}) => {
  checkSource(source, parse)
  return ['zod', any, ...modifiers]
}

export const resolvedIn = (bindings) => ([, source, ...modifiers], path, {parse}) =>
  ['zod', resolveSource(source, {...bindings, parse}), ...modifiers]
