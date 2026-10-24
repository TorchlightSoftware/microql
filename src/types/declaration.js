/**
 * @fileoverview Declarations — what a service call tells core about its fields.
 *
 * A service call's declaration (what a service's lookup returns) holds its
 * input and its output as zodly documents: `input` an object schema, one field
 * per argument, and `output` the type of what it returns.
 *
 *   input:  {on: ['array', {tags: ['target']}],
 *            service: ['call', {input: ['type', {fromList: 'on'}]}]}
 *   output: ['array', ['type', {fromField: 'service'}]]
 *
 * A field's tags say what core does with it:
 *   target     method syntax fills this field
 *   settings   receives the call's merged settings
 *
 * A handle field, `['handle', kind, ...modifiers]`, names a resource outside
 * the Query that the call works on, of a kind the runtime offers (a browser
 * session): the Query writes a name, and the call is given the handle the
 * runtime answers for it (see query/handles.js). It's a string with its kind
 * in its meta, `{meta: {handle: kind}}`, as a zod schema may also write it.
 * Its answer may differ each time, so the call is never reused within a Run.
 *
 * A call field is one typed `call`: it holds a nested call or chain, handed
 * over as a function of one input. Its `input` is what the nested call
 * receives (`@`), and its `output` what the nested call returns. `call` is
 * MicroQL's own type name, which it writes as a zodly `function`; a
 * declaration can't use `function` itself, whose input is a list of
 * arguments.
 *
 * `['type', source]` is a dynamic type: one that follows from the call's
 * fields (see sources.js). Only plan() can resolve it, so it's checked when
 * the declaration is read, and takes no checks of its own (min, email) since
 * there's nothing to apply them to until then.
 *
 * Core reads a declaration's documents in several ways (see READINGS), each
 * a table of zodly preprocessors.
 */

import {parseSchema, tagsOf} from '@tlsft/zodly'
import {isPlainObject, writeFieldPath} from '../common/common.js'
import {errorOf, reasonOf} from '../common/error-catalog.js'
import {isAny, unwrap, returnedBy, opened} from './types.js'
import {checkedAsAny, resolvedIn} from './sources.js'

const TAGS = ['target', 'settings']

/**
 * A call field as a zod function: its nested call receives one value, so its
 * input is a tuple of that one. A zodly preprocessor for `call`.
 */
const asFunction = (form) => typeof form === 'string' ? 'function' : ['function', ...form.slice(1).map(modifier =>
  isPlainObject(modifier) && Object.hasOwn(modifier, 'input') ? {...modifier, input: ['tuple', modifier.input]} : modifier)]

// A handle field as the name the Query writes: a string, with its kind in its
// meta. A zodly preprocessor for `handle`.
const asHandle = (form) => {
  const [, kind, ...modifiers] = typeof form === 'string' ? [form] : form
  return ['string', {min: 1}, ...modifiers, {meta: {handle: kind}}]
}

// A zodly preprocessor for `function`, which a declaration doesn't use.
const refusedFunction = () => {
  throw errorOf('function-type')
}

/**
 * The ways core reads a declaration's documents, each a table of zodly
 * preprocessors, by what the reading is for:
 *   declared     the fields' roles and declared types: dynamic types checked,
 *                as any; call fields with their input as one argument
 *   atRunTime    the Service Defined Validations, which check what's fixed:
 *                dynamic types and call fields as any
 *   planned      a call's expected input and output, in plan(): dynamic types
 *                resolved against the call's bindings, call fields as declared
 *   plannedData  the same, with call fields as any: its data fields only
 */
const reading = (type, call) => ({type, call, handle: asHandle, function: refusedFunction})

export const READINGS = {
  declared: reading(checkedAsAny, asFunction),
  atRunTime: reading(() => 'any', () => 'any'),
  planned: (bindings) => reading(resolvedIn(bindings), asFunction),
  plannedData: (bindings) => reading(resolvedIn(bindings), () => 'any')
}

// One of the declaration's documents as zod, with an error in it reported in
// the document it is in.
function readDocument(name, document, preprocess) {
  try {
    return parseSchema(document, {preprocess})
  } catch (error) {
    throw errorOf('malformed-document', {document: name, reason: reasonOf(error)}, {cause: error})
  }
}

// A field's handle, when it is one: the kind its meta names.
function handleOf(type) {
  const meta = type.meta() ?? {}
  return Object.hasOwn(meta, 'handle') ? {kind: meta.handle} : undefined
}

// Every field of an input, nested fields after their parents, each with its
// path, its tags, its handle, whether it holds a call, and its declared type
// (a call field's: what its nested call returns).
function fieldsIn(schema, segments = []) {
  const inner = unwrap(schema)
  if (inner.def.type !== 'object') return []
  return Object.entries(inner.def.shape).flatMap(([name, type]) => {
    const at = [...segments, name]
    const call = unwrap(type).def.type === 'function'
    const field = {path: writeFieldPath(at), segments: at, tags: tagsOf(type), handle: handleOf(type), call, declaredType: call ? returnedBy(unwrap(type)) : type}
    return [field, ...fieldsIn(type, at)]
  })
}

function checkTags({path, tags}) {
  const unknown = tags.find(tag => !TAGS.includes(tag))
  if (unknown !== undefined) throw errorOf('unknown-tag', {tag: unknown, path})
}

function checkHandle({path, handle}) {
  if (handle && !(typeof handle.kind === 'string' && handle.kind)) throw errorOf('unnamed-handle', {path})
}

const tagged = (fields, tag) => fields.filter(field => field.tags.includes(tag))

// The run-time schema of a document: none when it checks nothing. A call
// receives, and its caller gets back, what the schema parses, so it's opened:
// it fills defaults and applies transforms, but drops no field.
function atRunTime(name, document) {
  const schema = readDocument(name, document, READINGS.atRunTime)
  return isAny(schema) ? undefined : opened(schema)
}

// Whether an input takes fields it doesn't name: when it declares none, isn't
// an object, or is an object open to other fields (loose, passthrough).
function takesOtherFields(schema) {
  const inner = schema && unwrap(schema)
  if (inner?.def.type !== 'object') return true
  return inner.def.catchall !== undefined && inner.def.catchall.def.type !== 'never'
}

// A declaration, read and checked afresh.
function read({input, output}) {
  const declared = input === undefined ? undefined : readDocument('input', input, READINGS.declared)
  const fields = declared ? fieldsIn(declared) : []
  if (output !== undefined) readDocument('output', output, READINGS.declared)
  fields.forEach(checkTags)
  fields.forEach(checkHandle)
  const targets = tagged(fields, 'target')
  if (targets.length > 1) throw errorOf('multiple-targets', {paths: targets.map(field => field.path)})
  return {
    input,
    output,
    fields,
    // the names of the fields a call may be given, or none when it takes any
    fieldNames: takesOtherFields(declared) ? undefined : fields.filter(field => field.segments.length === 1).map(field => field.path),
    target: targets[0],
    calls: fields.filter(field => field.call).sort((a, b) => a.path.localeCompare(b.path)),
    settings: tagged(fields, 'settings'),
    handles: fields.filter(field => field.handle),
    inputSchema: input === undefined ? undefined : atRunTime('input', input),
    outputSchema: output === undefined ? undefined : atRunTime('output', output)
  }
}

// Declarations read so far, by the declaration a service's lookup answered.
const readings = new WeakMap()

/**
 * A service call's declaration, read and checked: its documents, its fields
 * by role, and its run-time input and output schemas. A service answers the
 * same declaration for every call of a key, so those calls share one
 * reading, read-only, and one run-time schema, which zod compiles once.
 */
export function readDeclaration(declaration) {
  if (!readings.has(declaration)) readings.set(declaration, read(declaration))
  return readings.get(declaration)
}
