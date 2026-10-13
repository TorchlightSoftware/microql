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
import {errorSchema, parseSchema} from './zodly.js'

export const any = z.any()

const WRAPPERS = ['optional', 'nullable', 'default', 'prefault', 'readonly', 'catch', 'nonoptional']

// The schema inside optional, nullable and default wrappers.
const unwrap = (schema) => WRAPPERS.includes(schema.def.type) ? unwrap(schema.def.innerType) : schema

const typeOf = (schema) => unwrap(schema).def.type

export const isAny = (schema) => ['any', 'unknown'].includes(typeOf(schema))

// A value of this schema may be absent: undefined or null.
const mayBeMissing = (schema) => schema.safeParse(undefined).success || schema.safeParse(null).success

// The type of the fields an object has beyond those it lists: a record's
// value type, a loose object's catchall; none for an object closed to them.
const openTo = (object) => {
  if (object.def.type === 'record') return object.def.valueType
  return object.def.catchall && typeOf(object.def.catchall) !== 'never' ? object.def.catchall : undefined
}

// The type of an object's field: the one it lists, else maybe its other
// fields' type, if it's open to them, else undefined.
const fieldOf = (object, name) =>
  object.def.shape && Object.hasOwn(object.def.shape, name) ? object.def.shape[name] : openTo(object)?.optional() ?? z.undefined()

// An object of these fields, as open to others as the object it's made from.
const objectLike = (object, shape) => openTo(object) ? z.object(shape).catchall(openTo(object)) : z.object(shape)

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
  if (type === 'array') return `array of ${described(schema.def.element)}`
  if (type === 'tuple') return `[${schema.def.items.map(describeSchema).join(', ')}]`
  if (type === 'record') return `record of ${describeSchema(schema.def.valueType)}`
  if (type === 'enum') return `enum (${enumValues(schema).join(' | ')})`
  if (type === 'literal') return `literal ${JSON.stringify(schema.def.values[0])}`
  if (type === 'union') return schema.def.options.map(describeSchema).join(' | ')
  if (type === 'object') {
    const fields = Object.entries(schema.def.shape).map(([name, field]) =>
      field.def.type === 'optional' ? `${name}?: ${describeSchema(field.def.innerType)}` : `${name}: ${describeSchema(field)}`)
    const rest = openTo(schema) ? [`...${describeSchema(schema.def.catchall)}`] : []
    return `{${[...fields, ...rest].join(', ')}}`
  }
  return type
}

// A list's item as text: a union in parentheses, so it reads as one item.
const described = (schema) => unwrap(schema).def.type === 'union' ? `(${describeSchema(schema)})` : describeSchema(schema)

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
// record, has for it: a field it doesn't list is maybe of the type of the
// fields it's open to (a record's values), else absent.
function compareFields(expected, actual, path) {
  return Object.entries(expected.def.shape).flatMap(([name, field]) => {
    return compare(field, fieldOf(actual, name), [...path, name])
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

// One schema of several members, each type named once.
function unionOf(members) {
  const named = [...new Map(members.map(member => [describeSchema(member), member])).values()]
  return named.length === 1 ? named[0] : z.union(named)
}

/*
 * Type operators: what a declaration's sources compute (see declaration.js),
 * each a pure function of zod schemas. union and difference are the set
 * operations; pick and merge mirror [util]/pick and [util]/merge.
 */

/**
 * A value of one schema or the other, as one union. A never (what a call that
 * always throws returns) adds nothing.
 */
export const union = (one, other) => {
  const members = [...membersOf(one), ...membersOf(other)].filter(member => typeOf(member) !== 'never')
  return members.length ? unionOf(members) : z.never()
}

/**
 * The schema less the members that fit the removed one: what's left of a
 * list's items once those matching a skip schema are left out. Removing never
 * removes nothing; removing what isn't known (any) keeps the schema, since
 * what it removes can't be told. Never when nothing is left.
 */
export function difference(schema, removed) {
  if (isAny(removed)) return schema
  const members = membersOf(schema)
  const kept = members.filter(member => compare(removed, member).length > 0)
  if (kept.length === members.length) return schema
  return kept.length ? unionOf(kept) : z.never()
}

const isScalar = (value) => ['string', 'number', 'boolean'].includes(typeof value) || value === null

/**
 * The literal type of a value written in a Query: a scalar's literal, a list's
 * tuple, an object's fields, item by item; undefined for nothing. A value
 * that isn't known (a reference, to plan()) or has no literal type (a RegExp,
 * a zod schema) is any.
 */
export function literalOf(value, isUnknown = () => false) {
  if (isUnknown(value)) return any
  if (isScalar(value)) return z.literal(value)
  if (value === undefined) return z.undefined()
  if (Array.isArray(value)) return z.tuple(value.map(item => literalOf(item, isUnknown)))
  if (isPlainObject(value)) return z.object(mapValues(value, item => literalOf(item, isUnknown)))
  return any
}

// What makes up a literal type, by kind: the types its value is read from.
const LITERAL_PARTS = {
  literal: () => [],
  undefined: () => [],
  tuple: (schema) => schema.def.items,
  object: (schema) => Object.values(schema.def.shape)
}

// Whether a type is a literal type through and through, so its value is known.
export const isLiteral = (schema) => {
  const parts = LITERAL_PARTS[schema.def.type]
  return Boolean(parts) && parts(schema).every(isLiteral)
}

// The value a literal type was read from (see literalOf).
export function valueOfLiteral(schema) {
  const {def} = schema
  if (def.type === 'literal') return def.values[0]
  if (def.type === 'tuple') return def.items.map(valueOfLiteral)
  if (def.type === 'object') return mapValues(def.shape, valueOfLiteral)
  return undefined
}

/**
 * The schema a zodly descriptor describes, given the descriptor's literal
 * type: never for no descriptor, so there's nothing it describes; any when the
 * descriptor isn't known before the Run.
 */
export function describedBy(type) {
  if (typeOf(type) === 'undefined') return z.never()
  return isLiteral(type) ? parseSchema(valueOfLiteral(type)) : any
}

// The key names a type of keys holds: a tuple's items, or a union's members,
// each a string literal; none when they aren't known.
function keysIn(keys) {
  const members = keys.def.type === 'tuple' ? keys.def.items : membersOf(keys)
  const names = members.map(member => member.def.type === 'literal' ? member.def.values[0] : undefined)
  return names.every(name => typeof name === 'string') ? names : undefined
}

/**
 * The schema with only the named fields its objects have, as TypeScript's
 * Pick does: a name a loose object doesn't list may be there, of the type
 * its other fields have, or not. Unchanged when the keys aren't known before
 * the Run.
 */
export function pick(schema, keys) {
  const names = keysIn(keys)
  if (!names) return schema
  const pickFrom = (member) => {
    const inner = unwrap(member)
    if (inner.def.type !== 'object') return member
    const picked = names.map(name => [name, fieldOf(inner, name)]).filter(([, field]) => typeOf(field) !== 'undefined')
    return z.object(Object.fromEntries(picked))
  }
  return unionOf(membersOf(schema).map(pickFrom))
}

// A schema's alternatives, with optional as undefined and nullable as null.
function alternativesOf(schema) {
  const {type, innerType} = schema.def
  if (type === 'optional') return [...alternativesOf(innerType), z.undefined()]
  if (type === 'nullable') return [...alternativesOf(innerType), z.null()]
  if (WRAPPERS.includes(type)) return alternativesOf(innerType)
  return type === 'union' ? schema.def.options.flatMap(alternativesOf) : [schema]
}

// Merging one alternative of `with` onto one of `on`, as [util]/merge does:
// undefined keeps on's, objects merge field by field, lists join, and any
// other value wins.
function mergeOne(on, added) {
  const [a, b] = [on.def.type, added.def.type]
  if (b === 'undefined') return on
  if (isAny(on)) return ['object', 'array'].includes(b) ? any : added
  if (a === 'object' && b === 'object') {
    const names = [...new Set([...Object.keys(on.def.shape), ...Object.keys(added.def.shape)])]
    const shape = Object.fromEntries(names.map(name => [name, merge(fieldOf(on, name), fieldOf(added, name))]))
    return objectLike(openTo(on) ? on : added, shape)
  }
  if (a === 'array' && b === 'array') return z.array(union(on.def.element, added.def.element))
  return added
}

/**
 * What [util]/merge returns, given on's type and with's: each alternative of
 * with merged onto each of on's. Any when with isn't known, or when an object
 * or list of with's merges onto an on that isn't, since on may have fields or
 * items with doesn't.
 */
export function merge(on, added) {
  if (isAny(added)) return any
  const merged = alternativesOf(on).flatMap(a => alternativesOf(added).map(b => mergeOne(a, b)))
  return merged.reduce(union)
}
