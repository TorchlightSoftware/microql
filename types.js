/**
 * @fileoverview Types — the seven types the Builder renders.
 *
 *   text, number, boolean (true/false), datetime, list (with element type),
 *   object (with fields), mixed
 *
 * Mixed is TypeScript's `any`: zod's any, unknown and unions map to it, as
 * does a call with no schema. Optional and nullable are one flag, `optional`.
 * Refinements (email, url) are not represented.
 *
 * A type is plain data: {type, optional?, element?, fields?}.
 */

import _ from 'lodash'

export const mixed = {type: 'mixed'}

const SCALARS = {string: 'text', number: 'number', int: 'number', boolean: 'boolean', date: 'datetime', enum: 'text'}

// Zod schemas are converted once, when first seen.
const converted = new WeakMap()

// The seven-type form of a zod schema.
export function typeOfSchema(schema) {
  if (!schema) return mixed
  if (!converted.has(schema)) converted.set(schema, convertSchema(schema.def))
  return converted.get(schema)
}

function convertSchema(def) {
  if (SCALARS[def.type]) return {type: SCALARS[def.type]}
  if (def.type === 'array') return {type: 'list', element: typeOfSchema(def.element)}
  if (def.type === 'object') return {type: 'object', fields: _.mapValues(def.shape, typeOfSchema)}
  if (def.type === 'optional' || def.type === 'nullable') return {...typeOfSchema(def.innerType), optional: true}
  if (def.type === 'default') return typeOfSchema(def.innerType)
  if (def.type === 'literal') return typeOfValue(def.values[0])
  return mixed
}

// The type of a literal value.
export function typeOfValue(value) {
  if (value === null || value === undefined) return {...mixed, optional: true}
  if (typeof value === 'string') return {type: 'text'}
  if (typeof value === 'number') return {type: 'number'}
  if (typeof value === 'boolean') return {type: 'boolean'}
  if (value instanceof Date) return {type: 'datetime'}
  if (Array.isArray(value)) return listOf(value.map(typeOfValue))
  if (_.isPlainObject(value)) return {type: 'object', fields: _.mapValues(value, typeOfValue)}
  return mixed
}

// A list whose element type is shared by all its elements, or mixed.
export function listOf(elementTypes) {
  const [first, ...rest] = elementTypes
  const shared = first && rest.every(t => _.isEqual(t, first))
  return {type: 'list', element: shared ? first : mixed}
}

// The type found by walking a path into a type.
export function typeAtPath(type, path) {
  return path.reduce((current, segment) => {
    if (current.type === 'object') return current.fields?.[segment] ?? mixed
    if (current.type === 'list' && /^\d+$/.test(segment)) return current.element
    return mixed
  }, type)
}

// Whether a value of the actual type fits a slot of the expected type. Mixed
// fits and accepts everything; lists compare their elements one level deep.
export function satisfies(expected, actual) {
  if (expected.type === 'mixed' || actual.type === 'mixed') return true
  if (expected.type !== actual.type) return false
  if (expected.type === 'list') return satisfies(expected.element, actual.element)
  return true
}
