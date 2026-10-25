import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import {readFile} from 'node:fs/promises'
import {compile} from '../index.js'
import {defineService} from '../src/service/define-service.js'
import {ERRORS} from '../src/common/error-catalog.js'

const echo = defineService({
  '/echo': {input: {on: ['any', 'optional', {tags: ['target']}]}, call: async ({on}) => on},
  '/items': {
    async GET() { return [] },
    async POST({on}) { return on }
  },
  '/broken': {input: {on: ['any', 'optional', {tags: ['targte']}]}, call: async () => null},
  '/open': {input: [{on: ['any', 'optional', {tags: ['target']}]}, 'loose'], call: async (args) => args}
})

const compileQuery = (query) => compile({...query, services: {echo, ...query.services}})

describe('Compile-time errors', () => {
  // [name, query, the error: its code, address and details]
  const cases = [
    ['an unknown $name',
      {phases: {a: ['[echo]/echo', {on: '$missing'}]}},
      {code: 'unknown-reference', address: '$a.@1', reference: '$missing'}],
    ['$given when the Query has no given',
      {phases: {a: ['[echo]/echo', {on: '$given.x'}]}},
      {code: 'unknown-reference', address: '$a.@1', reference: '$given.x'}],
    ['an unknown @name',
      {given: {xs: [1]}, phases: {a: ['$given.xs', '[util]/each', {service: ['[echo]/echo', {on: '@item'}]}]}},
      {code: 'unknown-binding', address: '$a.@1a1', reference: '@item', binding: 'item'}],
    ['an @name used outside its iteration',
      {given: {xs: [1]}, phases: {a: ['$given.xs', '[util]/each', {as: 'x', service: ['[echo]/echo', {on: '@'}]}], b: ['[echo]/echo', {on: '@x'}]}},
      {code: 'unknown-binding', address: '$b.@1', reference: '@x', binding: 'x'}],
    ['a binding name used twice',
      {
        given: {xs: [1]}, phases: {
          a: ['$given.xs', '[util]/each', {as: 'x', service: ['[echo]/echo', {on: '@x'}]}],
          b: ['$given.xs', '[util]/each', {as: 'x', service: ['[echo]/echo', {on: '@x'}]}]
        }
      },
      {code: 'duplicate-binding', address: '$b.@1', binding: 'x'}],
    ['the old $.name form',
      {given: {x: 1}, phases: {a: ['[echo]/echo', {on: '$.given.x'}]}},
      {code: 'retired-key', address: '$a.@1', retired: '$.given.x', replacement: 'The $.name form is replaced by $name: use \'$given.x\'.'}],
    ['@@',
      {given: {xs: [1]}, phases: {a: ['$given.xs', '[util]/each', {service: ['[echo]/echo', {on: '@@'}]}]}},
      {code: 'retired-key', address: '$a.@1a1', retired: '@@'}],
    ['bare $',
      {phases: {a: ['[echo]/echo', {on: '$'}]}},
      {code: 'bare-reference', address: '$a.@1', reference: '$'}],
    ['bare @ at the start of a phase',
      {phases: {a: ['[echo]/echo', {on: '@'}]}},
      {code: 'nothing-flows', address: '$a.@1', reference: '@'}],
    ['bare @ in the first step of a chain',
      {given: {x: 1}, phases: {a: [['[echo]/echo', {on: '@'}], ['@', '[echo]/echo']]}},
      {code: 'nothing-flows', address: '$a.@1', reference: '@'}],
    ['a chain in a service argument without as:',
      {given: {xs: [1]}, phases: {a: ['$given.xs', '[util]/each', {service: [['[echo]/echo', {on: 1}]]}]}},
      {code: 'unreachable-input', address: '$a.@1', field: 'service'}],
    ['as: on a call that takes no call',
      {given: {x: 1}, phases: {a: ['[echo]/echo', {on: '$given.x', as: 'x'}]}},
      {code: 'misplaced-as', address: '$a.@1', key: '[echo]/echo'}],
    ['@err outside any catch',
      {phases: {a: ['[echo]/echo', {on: '@err'}]}},
      {code: 'unknown-error', address: '$a.@1', reference: '@err', catches: 0}],
    ['@@err with only one enclosing catch',
      {phases: {a: ['[util]/try', {service: ['[echo]/echo', {on: 1}], catch: ['[echo]/echo', {on: '@@err'}]}]}},
      {code: 'unknown-error', address: '$a.@1e1', reference: '@@err', catches: 1}],
    ['catch on a call that holds no calls',
      {phases: {a: ['[echo]/echo', {on: 1, catch: ['[echo]/echo', {on: '@err'}]}]}},
      {code: 'misplaced-catch', address: '$a.@1', key: '[echo]/echo'}],
    ['the retired onError',
      {phases: {a: ['[echo]/echo', {on: 1, onError: ['[echo]/echo', {on: '@err'}]}]}},
      {code: 'retired-key', address: '$a.@1', retired: 'onError'}],
    ['the retired ignoreErrors',
      {phases: {a: ['[echo]/echo', {on: 1, ignoreErrors: true}]}},
      {code: 'retired-key', address: '$a.@1', retired: 'ignoreErrors'}],
    ['the retired skipOutputErrors',
      {given: {xs: [1]}, phases: {a: ['$given.xs', '[util]/each', {service: ['[echo]/echo', {on: '@'}], skipOutputErrors: true}]}},
      {code: 'retired-key', address: '$a.@1', retired: 'skipOutputErrors'}],
    ['the retired Query-level onError',
      {settings: {onError: ['[echo]/echo', {on: '@err'}]}, phases: {a: ['[echo]/echo', {on: 1}]}},
      {code: 'retired-key', address: 'settings', retired: 'onError'}],
    ['a retired util resource',
      {phases: {a: ['[util]/print', {on: 1}]}},
      {code: 'retired-key', address: '$a.@1', retired: '[util]/print', replacement: 'Use [util]/inspect.'}],
    ['err as a binding name',
      {given: {xs: [1]}, phases: {a: ['$given.xs', '[util]/each', {as: 'err', service: ['[echo]/echo', {on: '@err'}]}]}},
      {code: 'reserved-name', address: '$a.@1', reserved: 'err'}],
    ['a phase named given',
      {phases: {given: ['[echo]/echo', {on: 1}]}},
      {code: 'reserved-name', address: '$given', reserved: 'given', naming: 'a phase'}],
    ['a malformed Service Call Validation',
      {phases: {a: ['[echo]/echo', {on: 1, precheck: {on: ['nope']}}]}},
      {code: 'malformed-schema', address: '$a.@1', validation: 'Service Call Validation', order: 'precheck'}],
    ['a phase named trigger',
      {phases: {trigger: ['[echo]/echo', {on: 1}]}},
      {code: 'reserved-name', address: '$trigger', reserved: 'trigger', naming: 'a phase'}],
    ['a Service Call Address used as a reference',
      {phases: {a: ['[echo]/echo', {on: 1}], b: ['[echo]/echo', {on: '$a.@1'}]}},
      {code: 'address-reference', address: '$b.@1', reference: '$a.@1'}],
    ['a literal that looks like a reference',
      {phases: {a: ['[echo]/echo', {on: '$5.00'}]}},
      {code: 'invalid-reference', address: '$a.@1', reference: '$5.00'}],
    ['the retired service:action form',
      {phases: {a: ['echo:echo', {on: 1}]}},
      {code: 'retired-key', address: '$a.@1', retired: 'echo:echo', replacement: 'The service:action form is replaced by \'[echo]/echo\'.'}],
    ['the retired service:action form in method syntax',
      {given: {x: 1}, phases: {a: ['$given.x', 'echo:echo']}},
      {code: 'retired-key', address: '$a.@1', retired: 'echo:echo'}],
    ['an unknown service',
      {phases: {a: ['[nope]/echo', {on: 1}]}},
      {code: 'unknown-service', address: '$a.@1', service: 'nope'}],
    ['an unknown resource',
      {phases: {a: ['[echo]/nope', {on: 1}]}},
      {code: 'unknown-resource', address: '$a.@1', key: '[echo]/nope'}],
    ['a method on a service call that takes none',
      {phases: {a: ['POST [echo]/echo', {on: 1}]}},
      {code: 'method-not-allowed', address: '$a.@1', key: '[echo]/echo', method: 'POST', methods: []}],
    ['a method missing from a resource with several',
      {phases: {a: ['DELETE [echo]/items', {}]}},
      {code: 'method-not-allowed', address: '$a.@1', key: '[echo]/items', method: 'DELETE', methods: ['GET', 'POST']}],
    ['no method on a resource that needs one',
      {phases: {a: ['[echo]/items', {}]}},
      {code: 'method-required', address: '$a.@1', key: '[echo]/items', methods: ['GET', 'POST']}],
    ['a service without lookup, supportedCalls and init',
      {services: {plain: {'/x': async () => 1}}, phases: {a: ['[plain]/x', {}]}},
      {code: 'not-a-service', address: '$a.@1', service: 'plain'}],
    ['a service with lookup only',
      {services: {partial: {lookup: () => ({})}}, phases: {a: ['[partial]/x', {}]}},
      {code: 'not-a-service', address: '$a.@1', service: 'partial'}],
    ['a malformed declaration',
      {phases: {a: ['[echo]/broken', {on: 1}]}},
      {code: 'malformed-declaration', address: '$a.@1', key: '[echo]/broken'}],
    ['method syntax on a service call with no target',
      {given: {x: 1}, phases: {a: ['$given.x', '[util]/when']}},
      {code: 'no-target', address: '$a.@1', key: '[util]/when'}],
    ['an unknown phase in select',
      {phases: {a: ['[echo]/echo', {on: 1}]}, select: '$b'},
      {code: 'unknown-reference', address: 'select', reference: '$b'}],
    ['a bare name in select',
      {phases: {a: ['[echo]/echo', {on: 1}]}, select: 'a'},
      {code: 'invalid-select', address: 'select', select: 'a'}],
    ['a field the declaration does not name',
      {phases: {a: ['[echo]/echo', {on: 1, extra: 2}]}},
      {code: 'unknown-field', address: '$a.@1', key: '[echo]/echo', field: 'extra', declared: ['on']}],
    ['a field the declaration does not name, beside a target given by method syntax',
      {given: {x: 1}, phases: {a: ['$given.x', '[echo]/echo', {extra: 2}]}},
      {code: 'unknown-field', address: '$a.@1', field: 'extra'}]
  ]

  for (const [name, query, error] of cases) {
    it(`rejects ${name}`, () => assert.throws(() => compileQuery(query), error))
  }

  it('places an error\'s message at its address', () => {
    assert.throws(() => compileQuery({phases: {a: ['[echo]/echo', {on: '$missing'}]}}), {message: /^\[\$a\.@1\] '\$missing'/})
  })

  // [query, the error's address and the JSON path of what's at fault]: an
  // editor places the error by its path, since a Query that doesn't compile
  // has no plan to look its address up in
  const located = [
    [{phases: {a: ['[echo]/echo', {on: '$missing'}]}}, {address: '$a.@1', path: ['phases', 'a']}],
    [{phases: {a: [['[echo]/echo', {on: 1}], ['[echo]/nope', {}]]}}, {address: '$a.@2', path: ['phases', 'a', 1]}],
    [{given: {xs: [1]}, phases: {a: ['$given.xs', '[util]/each', {service: ['[echo]/echo', {on: '@item'}]}]}}, {address: '$a.@1a1', path: ['phases', 'a', 2, 'service']}],
    [{phases: {given: ['[echo]/echo', {on: 1}]}}, {address: '$given', path: ['phases', 'given']}],
    [{phases: {a: ['[echo]/echo', {on: 1}]}, select: 'a'}, {address: 'select', path: ['select']}],
    [{phases: {}, settings: {onError: []}}, {address: 'settings', path: ['settings']}],
    [{trigger: {schema: ['nope']}, phases: {}}, {address: '$trigger', path: ['trigger', 'schema']}]
  ]

  for (const [query, error] of located) {
    it(`gives the path of ${error.address}`, () => assert.throws(() => compileQuery(query), error))
  }

  // [description, query]: the fields a call may be given
  const fieldsTaken = [
    ['reserve args beside the declared fields', {phases: {a: ['[echo]/echo', {on: 1, timeout: 5, retry: 1, debug: false, cache: false, precheck: {on: ['number']}}]}}],
    ['as: and catch: on a call that holds calls', {given: {xs: [1]}, phases: {a: ['$given.xs', '[util]/each', {as: 'x', service: ['[echo]/echo', {on: '@x'}], catch: ['[echo]/echo', {on: '@err'}]}]}}],
    ['any field, by a call that declares no input', {phases: {a: ['POST [echo]/items', {on: 1, anything: 2}]}}],
    ['any field, by a call whose input is loose', {phases: {a: ['[echo]/open', {on: 1, anything: 2}]}}],
    ['any field, by [util]/template', {phases: {a: ['[util]/template', {on: 1, anything: 2}]}}]
  ]

  for (const [description, query] of fieldsTaken) {
    it(`accepts ${description}`, () => assert.doesNotThrow(() => compileQuery(query)))
  }

  it('accepts a literal reference-like string supplied through given', () => {
    assert.doesNotThrow(() => compileQuery({given: {price: '$5.00'}, phases: {a: ['[echo]/echo', {on: '$given.price'}]}}))
  })


  it('warns, but compiles, when a binding shares a phase name', () => {
    const {warnings} = compileQuery({
      given: {xs: [1]},
      phases: {
        listing: ['$given.xs', '[util]/each', {as: 'listing', service: ['[echo]/echo', {on: '@listing'}]}]
      }
    })
    assert.deepEqual(warnings, [{address: '$listing.@1', message: 'Binding \'@listing\' shares its name with \'$listing\''}])
  })
})

// Error codes are API: every one in the catalog is raised or reported, and
// documented.
describe('error codes', () => {
  const read = (file) => readFile(new URL(`../${file}`, import.meta.url), 'utf8')
  const SOURCES = ['common/common.js',
    'execute/execute.js',
    'execute/wrappers.js',
    'query/compile.js',
    'query/graph.js',
    'query/handles.js',
    'query/reference.js',
    'runtime/config.js',
    'runtime/runtime.js',
    'runtime/service-registry.js',
    'runtime/table.js',
    'service/define-service.js',
    'service/util.js',
    'types/declaration.js',
    'types/sources.js',
    'types/types.js']
  const quotedIn = async (files) => new Set((await Promise.all(files.map(read))).flatMap(source => [...source.matchAll(/'([a-z]+(?:-[a-z]+)*)'/g)].map(([, code]) => code)))
  const documented = async () => {
    const doc = await read('docs/runtime-integration.md')
    const section = doc.slice(doc.indexOf('## Errors'), doc.indexOf('## The runtime API'))
    return [...new Set([...section.matchAll(/^\| `([a-z-]+)` \|/gm)].map(([, code]) => code))].sort()
  }

  it('raises every code in the catalog', async () => {
    const quoted = await quotedIn(SOURCES.map(file => `src/${file}`))
    assert.deepEqual(Object.keys(ERRORS).filter(code => !quoted.has(code)), [])
  })

  it('documents exactly the catalog\'s codes', async () => {
    assert.deepEqual(await documented(), Object.keys(ERRORS).sort())
  })
})
