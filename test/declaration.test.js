import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import {z} from 'zod'
import {parseSchema} from '@tlsft/zodly'
import {readDeclaration, READINGS} from '../src/types/declaration.js'
import {compile, defineService} from '../index.js'

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

  // [description, declaration, error]
  const malformed = [
    ['an unknown tag', {input: {on: ['any', 'optional', {tags: ['targte']}]}}, /Unknown tag 'targte' on 'on'/],
    ['the retired reserve tag', {input: {skip: ['any', {tags: ['reserve']}]}}, /Unknown tag 'reserve' on 'skip'/],
    ['two targets', {input: {a: ['any', 'optional', {tags: ['target']}], b: ['any', 'optional', {tags: ['target']}]}}, /Fields 'a', 'b' are each tagged target\.\n\nOnly one field can be the target\./],
    ['the retired tag lists', {input: {on: ['target']}}, /Unknown type name 'target' on \["target"\], at on, in input/],
    ['type without a source', {input: {on: ['type']}}, /is not a source, which has exactly one of/],
    ['a source with two keys', {input: {on: ['type', {fromField: 'a', fromList: 'b'}]}}, /is not a source, which has exactly one of/],
    ['an unknown source', {input: {on: ['type', {fromWhere: 'a'}]}}, /is not a source, which has exactly one of/],
    ['a retired source', {output: ['type', {toList: {fromField: 'a'}}]}, /is not a source, which has exactly one of/],
    ['an operator without a pair of sources', {output: ['type', {without: [{fromField: 'a'}]}]}, /without takes \[source, source\]/],
    ['an operator with a malformed source in its pair', {output: ['type', {merged: [{fromField: 'a'}, 'b']}]}, /is not a source, which has exactly one of/],
    ['fromZodly with a malformed descriptor', {output: ['type', {fromZodly: ['strng']}]}, /Unknown type name 'strng' on \["strng"\], in output/],
    ['fromZodly with a malformed source', {output: ['type', {fromZodly: {fromWhere: 'a'}}]}, /is not a source, which has exactly one of/],
    ['fromList without a path', {input: {on: ['type', {fromList: {fromField: 'a'}}]}}, /fromList takes a field path/],
    ['a check on a dynamic type', {input: {on: ['type', {fromField: 'a'}, {min: 1}]}}, /unknown modifier 'min'/],
    ['a malformed source in a call field\'s input', {input: {service: ['call', {input: ['type', {fromWhere: 'a'}]}]}}, /is not a source, which has exactly one of/],
    ['a field typed function', {input: {service: ['function', {input: ['string']}]}}, /A service call is typed 'call', not 'function' on \["function",\{"input":\["string"\]\}\], at service, in input/],
    ['a bare function', {input: {service: 'function'}}, /A service call is typed 'call', not 'function'/],
    ['a function in the output', {output: ['array', ['function']]}, /A service call is typed 'call', not 'function'.*in output/],
    ['a malformed zodly type', {input: {on: ['strng']}}, /Unknown type name 'strng' on \["strng"\], at on, in input/],
    ['an unknown zodly modifier', {output: ['string', 'optinal']}, /'string' has an unknown modifier 'optinal' on \["string","optinal"\], in output/]
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
