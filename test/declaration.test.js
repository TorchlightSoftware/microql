import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import {z} from 'zod'
import {declarationOf} from '../declaration.js'

const call = async () => null

describe('declarationOf', () => {
  it('reads the roles of input fields by path', () => {
    const declaration = declarationOf({
      input: {
        on: ['target', ['type', {fromZod: z.array(z.any())}]],
        service: [['call', {fromList: 'on'}]],
        'params.fn': ['call'],
        skip: ['reserve'],
        settings: ['settings']
      },
      call
    })
    assert.equal(declaration.target.path, 'on')
    assert.deepEqual(declaration.calls.map(f => f.path), ['params.fn', 'service'])
    assert.deepEqual(declaration.calls.map(f => f.segments), [['params', 'fn'], ['service']])
    assert.deepEqual(declaration.calls.map(f => f.receives), [undefined, {fromList: 'on'}])
    assert.deepEqual(declaration.settings.map(f => f.path), ['settings'])
  })

  it('declares nothing for an operation without a declaration', () => {
    const declaration = declarationOf({call})
    assert.equal(declaration.target, undefined)
    assert.deepEqual(declaration.calls, [])
    assert.equal(declaration.inputSchema, undefined)
    assert.equal(declaration.outputSchema, undefined)
  })

  it('builds the input schema from the fields typed fromZod, nesting dotted paths', () => {
    const {inputSchema} = declarationOf({
      input: {
        url: [['type', {fromZod: z.string()}]],
        'params.count': [['type', {fromZod: z.number()}]],
        'params.tag': [['type', {fromZod: z.string().optional()}]],
        'a..b': [['type', {fromZod: z.boolean()}]],
        loose: [['type', {fromField: 'url'}]]
      },
      call
    })
    assert.equal(inputSchema.safeParse({url: 'u', params: {count: 1}, 'a.b': true}).success, true)
    assert.equal(inputSchema.safeParse({url: 'u', params: {count: 'x'}, 'a.b': true}).success, false)
    assert.equal(inputSchema.safeParse({url: 'u', params: {count: 1}}).success, false)
  })

  it('leaves out the schema of a call field, which types what the nested call returns', () => {
    const {inputSchema, calls} = declarationOf({
      input: {on: [['type', {fromZod: z.array(z.any())}]], service: [['call'], ['type', {fromZod: z.boolean()}]]},
      call
    })
    assert.equal(inputSchema.safeParse({on: [], service: () => true}).success, true)
    assert.deepEqual(calls[0].type, {fromZod: calls[0].type.fromZod})
  })

  it('makes a nested object optional when all its fields are', () => {
    const {inputSchema} = declarationOf({input: {'params.tag': [['type', {fromZod: z.string().optional()}]]}, call})
    assert.equal(inputSchema.safeParse({}).success, true)
  })

  it('reads the output schema when the output is typed fromZod', () => {
    const output = z.array(z.string())
    assert.equal(declarationOf({output: [['type', {fromZod: output}]], call}).outputSchema, output)
    assert.equal(declarationOf({output: [['type', {toList: {fromField: 'service'}}]], call}).outputSchema, undefined)
  })

  it('is read once per operation', () => {
    const operation = {input: {on: ['target']}, call}
    assert.equal(declarationOf(operation), declarationOf(operation))
  })

  // [description, declaration, error]
  const malformed = [
    ['an unknown tag', {input: {on: ['targte']}}, /Unknown tag 'targte' on 'on'/],
    ['a tag that is neither a name nor a pair', {input: {on: [7]}}, /Tags are a name or \[name, config\]/],
    ['two targets', {input: {a: ['target'], b: ['target']}}, /Only one field can be the target: 'a' and 'b'/],
    ['a flag given config', {input: {on: [['target', {}]]}}, /'target' takes no config/],
    ['type without a source', {input: {on: ['type']}}, /'type' needs a source/],
    ['a source with two keys', {input: {on: [['type', {fromField: 'a', fromList: 'b'}]]}}, /A source has exactly one of/],
    ['an unknown source', {input: {on: [['type', {fromWhere: 'a'}]]}}, /A source has exactly one of/],
    ['an operator without a pair of sources', {output: [['type', {union: [{fromField: 'a'}]}]]}, /union takes \[source, source\]/],
    ['an operator with a malformed source in its pair', {output: [['type', {merge: [{fromField: 'a'}, 'b']}]]}, /A source has exactly one of/],
    ['fromZodly without a source', {input: {on: [['type', {fromZodly: 'skip'}]]}}, /A source has exactly one of/],
    ['fromZod without a zod schema', {input: {on: [['type', {fromZod: ['string']}]]}}, /fromZod takes a zod schema/],
    ['fromList without a path', {input: {on: [['type', {fromList: {fromField: 'a'}}]]}}, /fromList takes a field path/],
    ['toList without a source', {input: {on: [['type', {toList: 'a'}]]}}, /A source has exactly one of/],
    ['a schema on a path and its parent', {input: {params: [['type', {fromZod: z.object({})}]], 'params.a': [['type', {fromZod: z.string()}]]}}, /'params' and 'params.a' both have a schema/],
    ['an output tag other than type', {output: ['target']}, /The output takes only a type tag/],
    ['a malformed path', {input: {'a.': ['target']}}, /names an empty field/]
  ]

  for (const [description, declaration, error] of malformed) {
    it(`refuses ${description}`, () => {
      assert.throws(() => declarationOf({...declaration, call}), error)
    })
  }
})
