/**
 * @fileoverview Types — zod schemas as plan() reasons about them.
 *
 * Every type plan() works with is a zod schema: a service's declared types,
 * the schema of a literal value, or one resolved from a declaration's
 * relationships. `any` stands for what isn't known.
 *
 * compare() says how an actual type fits an expected one, structurally, as a
 * list of issues, each with a code and the path inside the value where it is:
 *
 *   type-mismatch    the types are incompatible
 *   maybe-missing    an optional or nullable value goes into a required field
 *   type-narrowing   a value of unknown type (any) or of a wider type (a string
 *                    for an enum) goes into a narrower field
 *
 * Refinements (email, min) are carried but not compared: they're checked at
 * run time.
 */

import {z} from 'zod'
import {isPlainObject, mapValues} from './common.js'
import {errorSchema} from './zodly.js'

export const any = z.any()

const WRAPPERS = ['optional', 'nullable', 'default', 'prefault', 'readonly', 'catch', 'nonoptional']

// The schema inside optional, nullable and default wrappers.
const unwrap = (schema) => WRAPPERS.includes(schema.def.type) ? unwrap(schema.def.innerType) : schema

const typeOf = (schema) => unwrap(schema).def.type

export const isAny = (schema) => ['any', 'unknown'].includes(typeOf(schema))

// A value of this schema may be absent: undefined or null.
const mayBeMissing = (schema) => schema.safeParse(undefined).success || schema.safeParse(null).success

const enumValues = (schema) => Object.values(schema.def.entries)

// A value of this schema is never there: undefined, or null.
const isAbsent = (schema) => ['undefined', 'null'].includes(typeOf(schema))

/**
 * A schema as text, for messages: `string`, `array of number`,
 * `{url: string, tags?: array of string}`, `enum (a | b)`, `record of number`,
 * `error` (error data).
 */
export function describeSchema(schema) {
  if (schema === errorSchema) return 'error'
  const {type} = schema.def
  if (type === 'optional') return `${describeSchema(schema.def.innerType)} (optional)`
  if (type === 'nullable') return `${describeSchema(schema.def.innerType)} (nullable)`
  if (WRAPPERS.includes(type)) return describeSchema(schema.def.innerType)
  if (type === 'array') return `array of ${describeSchema(schema.def.element)}`
  if (type === 'record') return `record of ${describeSchema(schema.def.valueType)}`
  if (type === 'enum') return `enum (${enumValues(schema).join(' | ')})`
  if (type === 'literal') return `literal ${JSON.stringify(schema.def.values[0])}`
  if (type === 'union') return schema.def.options.map(describeSchema).join(' | ')
  if (type === 'object') {
    const fields = Object.entries(schema.def.shape).map(([name, field]) =>
      field.def.type === 'optional' ? `${name}?: ${describeSchema(field.def.innerType)}` : `${name}: ${describeSchema(field)}`)
    return `{${fields.join(', ')}}`
  }
  return type
}

// The one schema several share, or any when they differ (or there are none).
export function sharedSchema(schemas) {
  const [first, ...rest] = schemas
  return first && rest.every(schema => describeSchema(schema) === describeSchema(first)) ? first : any
}

// The schema of a literal value.
export function schemaOfValue(value) {
  if (typeof value === 'string') return z.string()
  if (typeof value === 'number') return z.number()
  if (typeof value === 'boolean') return z.boolean()
  if (value instanceof Date) return z.date()
  if (Array.isArray(value)) return z.array(sharedSchema(value.map(schemaOfValue)))
  if (isPlainObject(value)) return z.object(mapValues(value, schemaOfValue))
  return any
}

// One item of a list's schema; any for anything else.
export function elementOf(schema) {
  const inner = unwrap(schema)
  return inner.def.type === 'array' ? inner.def.element : any
}

// One value of an object's schema: a record's value type, the type all of an
// object's fields share, or any of them.
export function valueOf(schema) {
  const inner = unwrap(schema)
  if (inner.def.type === 'record') return inner.def.valueType
  if (inner.def.type !== 'object') return any
  const values = Object.values(inner.def.shape)
  const shared = sharedSchema(values)
  return shared === any && values.length > 1 ? z.union(values) : shared
}

// The schema found by walking a path of field names (and list indexes).
export function schemaAtPath(schema, path) {
  return path.reduce((current, segment) => {
    const inner = unwrap(current)
    if (inner.def.type === 'object') return inner.def.shape[segment] ?? any
    if (inner.def.type === 'record') return inner.def.valueType
    if (inner.def.type === 'array' && /^\d+$/.test(segment)) return inner.def.element
    return any
  }, schema)
}

const SEVERITY = {'type-narrowing': 1, 'maybe-missing': 2, 'type-mismatch': 3}
const severityOf = (issues) => Math.max(0, ...issues.map(({code}) => SEVERITY[code]))

const issue = (code, path, expected, actual) => [{code, path, expected, actual}]

// The base type a scalar belongs to: a literal's or an enum's.
const LITERAL_TYPES = {string: 'string', number: 'number', boolean: 'boolean', bigint: 'bigint'}
function baseTypeOf(schema) {
  const {def} = schema
  if (def.type === 'literal') return LITERAL_TYPES[typeof def.values[0]]
  if (def.type === 'enum') return 'string'
  return def.type
}

// Each field of an expected object against what the actual object, or
// record, has for it.
function compareFields(expected, actual, path) {
  return Object.entries(expected.def.shape).flatMap(([name, field]) => {
    const at = [...path, name]
    if (actual.def.type === 'record') {
      const absent = mayBeMissing(field) ? [] : issue('maybe-missing', at, field, actual.def.valueType)
      return [...absent, ...compare(field, actual.def.valueType, at)]
    }
    const actualField = actual.def.shape[name]
    if (actualField) return compare(field, actualField, at)
    return mayBeMissing(field) ? [] : issue('type-mismatch', at, field, any)
  })
}

// How an actual type fits each kind of expected type, both unwrapped.
const FITS = {
  array: (expected, actual, path) => actual.def.type === 'array'
    ? compare(expected.def.element, actual.def.element, [...path, '*'])
    : issue('type-mismatch', path, expected, actual),
  object: (expected, actual, path) => ['object', 'record'].includes(actual.def.type)
    ? compareFields(expected, actual, path)
    : issue('type-mismatch', path, expected, actual),
  record: (expected, actual, path) => {
    if (actual.def.type === 'record') return compare(expected.def.valueType, actual.def.valueType, [...path, '*'])
    if (actual.def.type === 'object') {
      return Object.entries(actual.def.shape).flatMap(([name, field]) => compare(expected.def.valueType, field, [...path, name]))
    }
    return issue('type-mismatch', path, expected, actual)
  },
  enum: (expected, actual, path) => {
    const allowed = enumValues(expected)
    const given = actual.def.type === 'enum' ? enumValues(actual) : actual.def.type === 'literal' ? actual.def.values : undefined
    if (given) return given.every(value => allowed.includes(value)) ? [] : issue('type-mismatch', path, expected, actual)
    return actual.def.type === 'string' ? issue('type-narrowing', path, expected, actual) : issue('type-mismatch', path, expected, actual)
  },
  literal: (expected, actual, path) => {
    if (actual.def.type === 'literal' && actual.def.values[0] === expected.def.values[0]) return []
    return baseTypeOf(actual) === baseTypeOf(expected) ? issue('type-narrowing', path, expected, actual) : issue('type-mismatch', path, expected, actual)
  }
}

// What fits the best member of an expected union; one mismatch when none does.
function compareToUnion(expected, actual, path) {
  const [best] = expected.def.options.map(option => compare(option, actual, path)).sort((a, b) => severityOf(a) - severityOf(b))
  return severityOf(best) < SEVERITY['type-mismatch'] ? best : issue('type-mismatch', path, expected, actual)
}

/**
 * How a value of the actual type fits a field of the expected one: the
 * issues found, each {code, path, expected, actual}, with the expected and
 * actual types where it is. No issues means it fits.
 */
export function compare(expected, actual, path = []) {
  if (isAny(expected)) return []
  if (isAny(actual)) return issue('type-narrowing', path, expected, actual)
  if (isAbsent(actual)) return mayBeMissing(expected) ? [] : issue('type-mismatch', path, expected, actual)
  const absent = mayBeMissing(actual) && !mayBeMissing(expected) ? issue('maybe-missing', path, expected, actual) : []

  const [want, have] = [unwrap(expected), unwrap(actual)]
  if (have.def.type === 'union') return [...absent, ...have.def.options.flatMap(option => compare(want, option, path))]
  if (want.def.type === 'union') return [...absent, ...compareToUnion(want, have, path)]
  const fits = FITS[want.def.type]
  if (fits) return [...absent, ...fits(want, have, path)]
  return [...absent, ...(baseTypeOf(have) === want.def.type ? [] : issue('type-mismatch', path, want, have))]
}

// The members of a schema: a union's options, else the schema itself.
const membersOf = (schema) => unwrap(schema).def.type === 'union' ? unwrap(schema).def.options : [schema]

const unionOf = (members) => members.length === 1 ? members[0] : z.union(members)

/**
 * A value of one schema or the other, as one union. A never (what a call that
 * always throws returns) adds nothing. Provisional: the plan's union of what a
 * call returns and what its catch does.
 */
export const eitherOf = (one, other) => {
  const members = [...membersOf(one), ...membersOf(other)].filter(member => typeOf(member) !== 'never')
  return members.length ? unionOf(members) : z.never()
}

/**
 * The schema less the members that fit the removed one: what's left of a
 * list's items once those matching a skip schema are left out. Unchanged when
 * there is nothing to remove; never when nothing is left.
 */
export function without(schema, removed) {
  if (!removed) return schema
  const members = membersOf(schema)
  const kept = members.filter(member => compare(removed, member).length > 0)
  if (kept.length === members.length) return schema
  return kept.length ? unionOf(kept) : z.never()
}
