import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import {z} from 'zod'
import {parseSchema} from '@tlsft/zodly'
import {readDeclaration, READINGS} from '../src/types/declaration.js'
import {compile, defineService} from '../index.js'
import {causedBy} from './test-services.js'

describe('readDeclaration', () => {
  it('reads the roles of input fields from their tags and types, by path', () => {
    const declaration = readDeclaration({
      input: {
        on: ['array', {tags: ['target']}],
        service: ['call', {input: ['type', {fromList: 'on'}]}],
        params: {fn: ['call']},
        settings: ['any', 'optional', {tags: ['settings']}]
      }
    })
    assert.equal(declaration.target.path, 'on')
    assert.deepEqual(declaration.calls.map(f => f.path), ['params.fn', 'service'])
    assert.deepEqual(declaration.calls.map(f => f.segments), [['params', 'fn'], ['service']])
    assert.deepEqual(declaration.settings.map(f => f.path), ['settings'])
  })

  it('reads handle fields and their kind, written as a handle or as zod meta', () => {
    const {handles} = readDeclaration({
      input: {session: ['handle', 'browser', {default: 'default'}], page: z.string().meta({handle: 'browser'}), url: ['string']}
    })
    assert.deepEqual(handles.map(({path, handle}) => [path, handle.kind]), [['session', 'browser'], ['page', 'browser']])
  })

  it('checks a handle\'s value as the name it is', () => {
    const {inputSchema} = readDeclaration({input: {session: ['handle', 'browser', {default: 'default'}]}})
    const fits = [{}, {session: 'a'}, {session: ''}, {session: 1}].map(fields => inputSchema.safeParse(fields).success)
    assert.deepEqual(fits, [true, true, false, false])
  })

  it('writes a dot inside a field\'s name as .. in its path', () => {
    const {calls} = readDeclaration({input: {'a.b': ['call']}})
    assert.deepEqual([calls[0].path, calls[0].segments], ['a..b', ['a.b']])
  })

  it('declares nothing for a service call that declares nothing', () => {
    const declaration = readDeclaration({})
    assert.equal(declaration.target, undefined)
    assert.deepEqual(declaration.calls, [])
    assert.equal(declaration.inputSchema, undefined)
    assert.equal(declaration.outputSchema, undefined)
  })

  it('checks fixed types at run time, but not dynamic types or call fields', () => {
    const {inputSchema} = readDeclaration({
      input: {
        url: ['string'],
        params: {count: ['number'], tag: ['string', 'optional']},
        'a.b': ['boolean'],
        loose: ['type', {fromField: 'url'}],
        service: ['call', {output: ['boolean']}]
      }
    })
    const fields = {url: 'u', params: {count: 1}, 'a.b': true, loose: 5, service: 'a literal stays data'}
    assert.equal(inputSchema.safeParse(fields).success, true)
    assert.equal(inputSchema.safeParse({...fields, params: {count: 'x'}}).success, false)
    assert.equal(inputSchema.safeParse({...fields, 'a.b': undefined}).success, false)
  })

  it('reads a zod schema in place of a descriptor', () => {
    const {inputSchema} = readDeclaration({input: {count: z.number().int()}})
    assert.deepEqual([{count: 2}, {count: 2.5}].map(fields => inputSchema.safeParse(fields).success), [true, false])
  })

  it('gives each field its declared type, with dynamic types as any; a call field\'s is what it returns', () => {
    const {fields} = readDeclaration({
      input: {on: ['array', ['string']], loose: ['type', {fromField: 'on'}], service: ['call', {output: ['boolean']}]}
    })
    const declared = Object.fromEntries(fields.map(field => [field.path, field.declaredType.def.type]))
    assert.deepEqual(declared, {on: 'array', loose: 'any', service: 'boolean'})
  })

  it('checks a fixed output at run time, and as much of a dynamic one as is fixed', () => {
    const fits = (output, value) => readDeclaration({output}).outputSchema.safeParse(value).success
    assert.deepEqual([fits(['array', ['string']], ['a']), fits(['array', ['string']], [1])], [true, false])
    assert.deepEqual([fits(['array', ['type', {fromField: 'service'}]], [1]), fits(['array', ['type', {fromField: 'service'}]], 'x')], [true, false])
    assert.equal(readDeclaration({output: ['type', {fromField: 'service'}]}).outputSchema, undefined)
  })

  it('reads a call field as a function of one input', () => {
    const fn = parseSchema(['call', {input: ['string'], output: ['boolean']}], {preprocess: READINGS.declared})
    assert.deepEqual([fn.def.type, fn.def.input.def.items.map(item => item.def.type), fn.def.output.def.type], ['function', ['string'], 'boolean'])
  })

  it('reads a bare call as a function', () => {
    assert.equal(parseSchema('call', {preprocess: READINGS.declared}).def.type, 'function')
  })

  // A document zodly can't read, as MicroQL reports it: the document, and
  // the error behind it, zodly's own or the catalogued one a MicroQL
  // preprocessor raised.
  const inDocument = (document, because) => (error) => {
    assert.deepEqual([error.code, error.document], ['malformed-document', document])
    return causedBy(because)(error)
  }
  const malformedSource = (source) => ({code: 'malformed-source', source: JSON.stringify(source)})
  const functionType = {code: 'function-type'}

  // [description, declaration, the error: its code and details]
  const malformed = [
    ['an unknown tag', {input: {on: ['any', 'optional', {tags: ['targte']}]}}, {code: 'unknown-tag', tag: 'targte', path: 'on'}],
    ['the retired reserve tag', {input: {skip: ['any', {tags: ['reserve']}]}}, {code: 'unknown-tag', tag: 'reserve', path: 'skip'}],
    ['the retired handle tag', {input: {session: ['string', {tags: ['handle']}]}}, {code: 'unknown-tag', tag: 'handle', path: 'session'}],
    ['a handle without a kind', {input: {session: 'handle'}}, {code: 'unnamed-handle', path: 'session'}],
    ['a handle whose kind isn\'t a name', {input: {session: z.string().meta({handle: true})}}, {code: 'unnamed-handle', path: 'session'}],
    ['two targets', {input: {a: ['any', 'optional', {tags: ['target']}], b: ['any', 'optional', {tags: ['target']}]}}, {code: 'multiple-targets', paths: ['a', 'b']}],
    ['the retired tag lists', {input: {on: ['target']}}, inDocument('input', /Unknown type name 'target' on \["target"\], at on$/)],
    ['type without a source', {input: {on: ['type']}}, inDocument('input', malformedSource(undefined))],
    ['a source with two keys', {input: {on: ['type', {fromField: 'a', fromList: 'b'}]}}, inDocument('input', malformedSource({fromField: 'a', fromList: 'b'}))],
    ['an unknown source', {input: {on: ['type', {fromWhere: 'a'}]}}, inDocument('input', malformedSource({fromWhere: 'a'}))],
    ['a retired source', {output: ['type', {toList: {fromField: 'a'}}]}, inDocument('output', malformedSource({toList: {fromField: 'a'}}))],
    ['an operator without a pair of sources', {output: ['type', {without: [{fromField: 'a'}]}]}, inDocument('output', {code: 'malformed-source-operand', kind: 'without', takes: '[source, source]'})],
    ['an operator with a malformed source in its pair', {output: ['type', {merged: [{fromField: 'a'}, 'b']}]}, inDocument('output', malformedSource('b'))],
    ['fromZodly with a malformed descriptor', {output: ['type', {fromZodly: ['strng']}]}, inDocument('output', /Unknown type name 'strng' on \["strng"\]$/)],
    ['fromZodly with a malformed source', {output: ['type', {fromZodly: {fromWhere: 'a'}}]}, inDocument('output', malformedSource({fromWhere: 'a'}))],
    ['fromList without a path', {input: {on: ['type', {fromList: {fromField: 'a'}}]}}, inDocument('input', {code: 'malformed-source-operand', kind: 'fromList', takes: 'a field path'})],
    ['a check on a dynamic type', {input: {on: ['type', {fromField: 'a'}, {min: 1}]}}, inDocument('input', /unknown modifier 'min'/)],
    ['a malformed source in a call field\'s input', {input: {service: ['call', {input: ['type', {fromWhere: 'a'}]}]}}, inDocument('input', malformedSource({fromWhere: 'a'}))],
    ['a field typed function', {input: {service: ['function', {input: ['string']}]}}, inDocument('input', functionType)],
    ['a bare function', {input: {service: 'function'}}, inDocument('input', functionType)],
    ['a function in the output', {output: ['array', ['function']]}, inDocument('output', functionType)],
    ['a malformed zodly type', {input: {on: ['strng']}}, inDocument('input', /Unknown type name 'strng' on \["strng"\], at on$/)],
    ['an unknown zodly modifier', {output: ['string', 'optinal']}, inDocument('output', /'string' has an unknown modifier 'optinal' on \["string","optinal"\]$/)]
  ]

  for (const [description, declaration, error] of malformed) {
    it(`refuses ${description}`, () => {
      assert.throws(() => readDeclaration(declaration), error)
    })
  }
})

describe('a declaration many calls name', () => {
  const add1 = defineService({'/add1': {input: {on: ['number', {tags: ['target']}]}, call: async ({on}) => on + 1}})

  // zod compiles a schema on its first check, so calls that share one schema compile it once
  it('is read once, so its calls check their input with one schema', () => {
    const {calls} = compile({services: {add1}, given: {n: 0}, phases: {chain: [['$given.n', '[add1]/add1'], ['@', '[add1]/add1'], ['@', '[add1]/add1']]}})
    assert.equal(new Set(calls.map(call => call.validators.precheck.schema)).size, 1)
  })
})
