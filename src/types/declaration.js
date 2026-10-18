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
import {isAny, unwrap, returnedBy} from './types.js'
import {checkedAsAny, resolvedIn} from './sources.js'

const TAGS = ['target', 'settings']

/**
 * A call field as a zod function: its nested call receives one value, so its
 * input is a tuple of that one. A zodly preprocessor for `call`.
 */
const asFunction = (form) => typeof form === 'string' ? 'function' : ['function', ...form.slice(1).map(modifier =>
  isPlainObject(modifier) && Object.hasOwn(modifier, 'input') ? {...modifier, input: ['tuple', modifier.input]} : modifier)]

// A zodly preprocessor for `function`, which a declaration doesn't use.
const refusedFunction = () => {
  throw new Error('A service call is typed \'call\', not \'function\'')
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
const reading = (type, call) => ({type, call, function: refusedFunction})

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
    throw new Error(`${error.message}, in ${name}`, {cause: error})
  }
}

// Every field of an input, nested fields after their parents, each with its
// path, its tags, whether it holds a call, and its declared type (a call
// field's: what its nested call returns).
function fieldsIn(schema, segments = []) {
  const inner = unwrap(schema)
  if (inner.def.type !== 'object') return []
  return Object.entries(inner.def.shape).flatMap(([name, type]) => {
    const at = [...segments, name]
    const call = unwrap(type).def.type === 'function'
    const field = {path: writeFieldPath(at), segments: at, tags: tagsOf(type), call, declaredType: call ? returnedBy(unwrap(type)) : type}
    return [field, ...fieldsIn(type, at)]
  })
}

function checkTags({path, tags}) {
  const unknown = tags.find(tag => !TAGS.includes(tag))
  if (unknown !== undefined) throw new Error(`Unknown tag '${unknown}' on '${path}'`)
}

const tagged = (fields, tag) => fields.filter(field => field.tags.includes(tag))

// The run-time schema of a document: none when it checks nothing.
function atRunTime(name, document) {
  const schema = readDocument(name, document, READINGS.atRunTime)
  return isAny(schema) ? undefined : schema
}

/**
 * A service call's declaration, read and checked: its documents, its fields
 * by role, and its run-time input and output schemas.
 */
export function readDeclaration({input, output}) {
  const fields = input === undefined ? [] : fieldsIn(readDocument('input', input, READINGS.declared))
  if (output !== undefined) readDocument('output', output, READINGS.declared)
  fields.forEach(checkTags)
  const targets = tagged(fields, 'target')
  if (targets.length > 1) throw new Error(`Only one field can be the target: ${targets.map(f => `'${f.path}'`).join(' and ')}`)
  return {
    input,
    output,
    fields,
    target: targets[0],
    calls: fields.filter(field => field.call).sort((a, b) => a.path.localeCompare(b.path)),
    settings: tagged(fields, 'settings'),
    inputSchema: input === undefined ? undefined : atRunTime('input', input),
    outputSchema: output === undefined ? undefined : atRunTime('output', output)
  }
}
