/**
 * @fileoverview Declarations — what an operation tells core about its fields.
 *
 * An operation (what a service's lookup returns) declares its input as field
 * paths, each with a list of tags, and its output as a list of tags:
 *
 *   input:  {on: ['target', ['type', {fromZod: z.array(z.any())}]],
 *            service: [['call', {fromList: 'on'}]]}
 *   output: [['type', {toList: {fromField: 'service'}}]]
 *
 * A tag is a name, or [name, config]:
 *   target     method syntax fills this field
 *   reserve    configures the call rather than feeding it data
 *   settings   receives the call's merged settings
 *   call       holds a nested call or chain, handed over as a function; its
 *              config is a source for what the nested call receives (`@`)
 *   type       the field's type; on a call field, what the nested call
 *              returns; on the output, what the operation returns
 *
 * A source names a type, by reading one (from*) or building one (to*):
 *   {fromZod: schema}     a concrete zod schema
 *   {fromField: path}     the type of another field (a call field: its return)
 *   {fromList: path}      one item of a list field
 *   {fromObject: path}    one value of an object field
 *   {toList: source}      a list of the source's type
 *   {toObject: source}    an object whose values are the source's type
 *   {without: [source, path]}  the source's type less the members that fit
 *                         the zodly schema the field at path holds
 *
 * Only fromZod types are checked at run time; the rest are resolved by plan().
 * Field paths are dotted, with `..` for a dot inside a field name.
 */

import {z} from 'zod'
import {isPlainObject, mapValues, parseFieldPath} from './common.js'

const FLAGS = ['target', 'reserve', 'settings']
const READ_SOURCES = ['fromField', 'fromList', 'fromObject']
const BUILD_SOURCES = ['toList', 'toObject']
const SOURCES = ['fromZod', ...READ_SOURCES, ...BUILD_SOURCES, 'without']

// A source is checked whole, so a malformed one is refused where it's declared.
function checkSource(source) {
  const keys = isPlainObject(source) ? Object.keys(source) : []
  if (keys.length !== 1 || !SOURCES.includes(keys[0])) {
    throw new Error(`A source has exactly one of ${SOURCES.join(', ')}. Got: ${JSON.stringify(source)}`)
  }
  const [kind] = keys
  const value = source[kind]
  if (kind === 'fromZod' && !(value instanceof z.ZodType)) throw new Error('fromZod takes a zod schema')
  if (READ_SOURCES.includes(kind) && typeof value !== 'string') throw new Error(`${kind} takes a field path`)
  if (BUILD_SOURCES.includes(kind)) checkSource(value)
  if (kind === 'without') {
    if (!Array.isArray(value) || value.length !== 2 || typeof value[1] !== 'string') throw new Error('without takes [source, field path]')
    checkSource(value[0])
  }
  return source
}

// A tag as {name, config}, from a name or a [name, config] pair.
function readTag(tag, path) {
  const [name, config] = typeof tag === 'string' ? [tag] : Array.isArray(tag) && typeof tag[0] === 'string' && tag.length <= 2 ? tag : []
  if (name === undefined) throw new Error(`Tags are a name or [name, config]. Got: ${JSON.stringify(tag)} on '${path}'`)
  if (FLAGS.includes(name) && config !== undefined) throw new Error(`'${name}' takes no config, on '${path}'`)
  if (name === 'type' && config === undefined) throw new Error(`'type' needs a source, on '${path}'`)
  if (![...FLAGS, 'call', 'type'].includes(name)) throw new Error(`Unknown tag '${name}' on '${path}'`)
  return {name, config: config === undefined ? undefined : checkSource(config)}
}

// One input field: its path, and what its tags say about it.
function readField(path, tags) {
  const read = tags.map(tag => readTag(tag, path))
  const named = (name) => read.find(tag => tag.name === name)
  return {
    path,
    segments: parseFieldPath(path),
    target: Boolean(named('target')),
    reserve: Boolean(named('reserve')),
    settings: Boolean(named('settings')),
    call: Boolean(named('call')),
    receives: named('call')?.config,
    type: named('type')?.config
  }
}

const isPrefix = (prefix, segments) => prefix.length < segments.length && prefix.every((s, i) => segments[i] === s)

// The run-time schema of an input: one object built from the data fields typed
// fromZod, nested along their paths. A nested object is optional when all its
// fields are.
function inputSchemaOf(fields) {
  const typed = fields.filter(field => !field.call && field.type?.fromZod)
  for (const outer of typed) {
    const inner = typed.find(field => isPrefix(outer.segments, field.segments))
    if (inner) throw new Error(`'${outer.path}' and '${inner.path}' both have a schema; give it to one of them`)
  }
  if (!typed.length) return undefined

  const tree = {}
  for (const {segments, type} of typed) {
    const parent = segments.slice(0, -1).reduce((node, segment) => (node[segment] ??= {}), tree)
    parent[segments.at(-1)] = type.fromZod
  }
  const toSchema = (node) => {
    if (node instanceof z.ZodType) return node
    const shape = mapValues(node, toSchema)
    const object = z.object(shape)
    return Object.values(shape).every(schema => schema.safeParse(undefined).success) ? object.optional() : object
  }
  return z.object(mapValues(tree, toSchema))
}

function readOutput(tags = []) {
  const read = tags.map(tag => readTag(tag, 'output'))
  if (read.some(tag => tag.name !== 'type')) throw new Error('The output takes only a type tag')
  return read[0]?.config
}

function readDeclaration({input = {}, output}) {
  const fields = Object.entries(input).map(([path, tags]) => readField(path, tags))
  const targets = fields.filter(field => field.target)
  if (targets.length > 1) throw new Error(`Only one field can be the target: ${targets.map(f => `'${f.path}'`).join(' and ')}`)
  const outputType = readOutput(output)
  return {
    fields,
    target: targets[0],
    calls: fields.filter(field => field.call).sort((a, b) => a.path.localeCompare(b.path)),
    settings: fields.filter(field => field.settings),
    inputSchema: inputSchemaOf(fields),
    outputType,
    outputSchema: outputType?.fromZod
  }
}

// Declarations are read once per operation.
const declarations = new WeakMap()

/**
 * An operation's declaration, read and checked: its fields by role, its
 * run-time input and output schemas, and its output type's source.
 */
export function declarationOf(operation) {
  if (!declarations.has(operation)) declarations.set(operation, readDeclaration(operation))
  return declarations.get(operation)
}
