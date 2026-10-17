import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import {readFile} from 'node:fs/promises'
import compile from '../compile.js'
import {defineService} from '../define-service.js'

const echo = defineService({
  '/echo': {input: {on: ['any', 'optional', {tags: ['target']}]}, call: async ({on}) => on},
  '/items': {
    async GET() { return [] },
    async POST({on}) { return on }
  },
  '/broken': {input: {on: ['any', 'optional', {tags: ['targte']}]}, call: async () => null}
})

const compileQuery = (query) => compile({...query, services: {echo, ...query.services}})

describe('Compile-time errors', () => {
  // [name, query, the error's code and address, its message]
  const cases = [
    ['an unknown $name',
      {phases: {a: ['[echo]/echo', {on: '$missing'}]}},
      {code: 'unknown-reference', address: '$a.@1'},
      /\[\$a\.@1\] Unknown reference '\$missing'/],
    ['$given when the Query has no given',
      {phases: {a: ['[echo]/echo', {on: '$given.x'}]}},
      {code: 'unknown-reference', address: '$a.@1'},
      /Unknown reference '\$given\.x'/],
    ['an unknown @name',
      {given: {xs: [1]}, phases: {a: ['$given.xs', '[util]/each', {service: ['[echo]/echo', {on: '@item'}]}]}},
      {code: 'unknown-reference', address: '$a.@1a1'},
      /\[\$a\.@1a1\] Unknown reference '@item'/],
    ['an @name used outside its iteration',
      {given: {xs: [1]}, phases: {a: ['$given.xs', '[util]/each', {as: 'x', service: ['[echo]/echo', {on: '@'}]}], b: ['[echo]/echo', {on: '@x'}]}},
      {code: 'unknown-reference', address: '$b.@1'},
      /\[\$b\.@1\] Unknown reference '@x'/],
    ['a binding name used twice',
      {
        given: {xs: [1]}, phases: {
          a: ['$given.xs', '[util]/each', {as: 'x', service: ['[echo]/echo', {on: '@x'}]}],
          b: ['$given.xs', '[util]/each', {as: 'x', service: ['[echo]/echo', {on: '@x'}]}]
        }
      },
      {code: 'duplicate-binding', address: '$b.@1'},
      /\[\$b\.@1\] Binding name 'x' is used more than once/],
    ['the old $.name form',
      {given: {x: 1}, phases: {a: ['[echo]/echo', {on: '$.given.x'}]}},
      {code: 'invalid-reference', address: '$a.@1'},
      /The \$\.name form is replaced by \$name. Use '\$given\.x'/],
    ['@@',
      {given: {xs: [1]}, phases: {a: ['$given.xs', '[util]/each', {service: ['[echo]/echo', {on: '@@'}]}]}},
      {code: 'invalid-reference', address: '$a.@1a1'},
      /@@ is removed/],
    ['bare $',
      {phases: {a: ['[echo]/echo', {on: '$'}]}},
      {code: 'invalid-reference', address: '$a.@1'},
      /Bare \$ is not supported/],
    ['bare @ at the start of a phase',
      {phases: {a: ['[echo]/echo', {on: '@'}]}},
      {code: 'invalid-reference', address: '$a.@1'},
      /\[\$a\.@1\] Invalid reference '@': nothing flows into this call/],
    ['bare @ in the first step of a chain',
      {given: {x: 1}, phases: {a: [['[echo]/echo', {on: '@'}], ['@', '[echo]/echo']]}},
      {code: 'invalid-reference', address: '$a.@1'},
      /\[\$a\.@1\] Invalid reference '@': nothing flows/],
    ['a chain in a service argument without as:',
      {given: {xs: [1]}, phases: {a: ['$given.xs', '[util]/each', {service: [['[echo]/echo', {on: 1}]]}]}},
      {code: 'unreachable-input', address: '$a.@1'},
      /\[\$a\.@1\] The chain in 'service' can't reach its input. Name it with as:/],
    ['as: on a call that takes no call',
      {given: {x: 1}, phases: {a: ['[echo]/echo', {on: '$given.x', as: 'x'}]}},
      {code: 'misplaced-as', address: '$a.@1'},
      /as: names an iteration, but \[echo\]\/echo takes no call/],
    ['@err outside any catch',
      {phases: {a: ['[echo]/echo', {on: '@err'}]}},
      {code: 'unknown-reference', address: '$a.@1'},
      /\[\$a\.@1\] Unknown reference '@err': no enclosing catch/],
    ['@@err with only one enclosing catch',
      {phases: {a: ['[util]/try', {service: ['[echo]/echo', {on: 1}], catch: ['[echo]/echo', {on: '@@err'}]}]}},
      {code: 'unknown-reference', address: '$a.@1e1'},
      /\[\$a\.@1e1\] Unknown reference '@@err': it is inside only 1 catch/],
    ['catch on a call that holds no calls',
      {phases: {a: ['[echo]/echo', {on: 1, catch: ['[echo]/echo', {on: '@err'}]}]}},
      {code: 'misplaced-catch', address: '$a.@1'},
      /\[\$a\.@1\] catch: handles failures of the calls a call holds, but \[echo\]\/echo holds none. To catch a single call, hold it in \[util\]\/try/],
    ['the retired onError',
      {phases: {a: ['[echo]/echo', {on: 1, onError: ['[echo]/echo', {on: '@err'}]}]}},
      {code: 'retired-key', address: '$a.@1'},
      /'onError' is retired. Use catch: on the call holding the calls whose failures it handles/],
    ['the retired ignoreErrors',
      {phases: {a: ['[echo]/echo', {on: 1, ignoreErrors: true}]}},
      {code: 'retired-key', address: '$a.@1'},
      /'ignoreErrors' is retired/],
    ['the retired skipOutputErrors',
      {given: {xs: [1]}, phases: {a: ['$given.xs', '[util]/each', {service: ['[echo]/echo', {on: '@'}], skipOutputErrors: true}]}},
      {code: 'retired-key', address: '$a.@1'},
      /'skipOutputErrors' is retired. Use catch: to handle each failure, then skip: \['error'\] to leave them out/],
    ['the retired Query-level onError',
      {settings: {onError: ['[echo]/echo', {on: '@err'}]}, phases: {a: ['[echo]/echo', {on: 1}]}},
      {code: 'retired-key', address: 'settings'},
      /'onError' is retired/],
    ['a retired util resource',
      {phases: {a: ['[util]/print', {on: 1}]}},
      {code: 'refused-key', address: '$a.@1'},
      /\[util\]\/print is retired. Use \[util\]\/inspect/],
    ['err as a binding name',
      {given: {xs: [1]}, phases: {a: ['$given.xs', '[util]/each', {as: 'err', service: ['[echo]/echo', {on: '@err'}]}]}},
      {code: 'reserved-name', address: '$a.@1'},
      /'err' is reserved for the error in catch/],
    ['a phase named given',
      {phases: {given: ['[echo]/echo', {on: 1}]}},
      {code: 'reserved-name', address: '$given'},
      /'given' is reserved/],
    ['a malformed Service Call Validation',
      {phases: {a: ['[echo]/echo', {on: 1, precheck: {on: ['nope']}}]}},
      {code: 'malformed-schema', address: '$a.@1'},
      /Service Call Validation precheck schema parse error/],
    ['a phase named trigger',
      {phases: {trigger: ['[echo]/echo', {on: 1}]}},
      {code: 'reserved-name', address: '$trigger'},
      /'trigger' is reserved/],
    ['a Service Call Address used as a reference',
      {phases: {a: ['[echo]/echo', {on: 1}], b: ['[echo]/echo', {on: '$a.@1'}]}},
      {code: 'invalid-reference', address: '$b.@1'},
      /Service call addresses are not reliable references in queries - they break when ordering changes. Use an alias instead./],
    ['a literal that looks like a reference',
      {phases: {a: ['[echo]/echo', {on: '$5.00'}]}},
      {code: 'invalid-reference', address: '$a.@1'},
      /must be supplied through given/],
    ['the retired service:action form',
      {phases: {a: ['echo:echo', {on: 1}]}},
      {code: 'retired-key', address: '$a.@1'},
      /uses the retired service:action form. Use '\[echo\]\/echo'/],
    ['the retired service:action form in method syntax',
      {given: {x: 1}, phases: {a: ['$given.x', 'echo:echo']}},
      {code: 'retired-key', address: '$a.@1'},
      /uses the retired service:action form. Use '\[echo\]\/echo'/],
    ['an unknown service',
      {phases: {a: ['[nope]/echo', {on: 1}]}},
      {code: 'unknown-service', address: '$a.@1'},
      /Service 'nope' not found/],
    ['an unknown resource',
      {phases: {a: ['[echo]/nope', {on: 1}]}},
      {code: 'refused-key', address: '$a.@1'},
      /\[\$a\.@1\] \[echo\]\/nope is not a resource of this service/],
    ['a method on a service call that takes none',
      {phases: {a: ['POST [echo]/echo', {on: 1}]}},
      {code: 'refused-key', address: '$a.@1'},
      /\[\$a\.@1\] \[echo\]\/echo takes no method; got POST/],
    ['a method missing from a resource with several',
      {phases: {a: ['DELETE [echo]/items', {}]}},
      {code: 'refused-key', address: '$a.@1'},
      /\[\$a\.@1\] \[echo\]\/items doesn't answer DELETE \(answers GET, POST\)/],
    ['no method on a resource that needs one',
      {phases: {a: ['[echo]/items', {}]}},
      {code: 'refused-key', address: '$a.@1'},
      /\[echo\]\/items needs a method: GET, POST/],
    ['a service without lookup, supportedCalls and init',
      {services: {plain: {'/x': async () => 1}}, phases: {a: ['[plain]/x', {}]}},
      {code: 'not-a-service', address: '$a.@1'},
      /Service 'plain' must provide lookup\(key\), supportedCalls\(\) and init\(runtime\)/],
    ['a service with lookup only',
      {services: {partial: {lookup: () => ({})}}, phases: {a: ['[partial]/x', {}]}},
      {code: 'not-a-service', address: '$a.@1'},
      /Service 'partial' must provide/],
    ['a malformed declaration',
      {phases: {a: ['[echo]/broken', {on: 1}]}},
      {code: 'malformed-declaration', address: '$a.@1'},
      /\[\$a\.@1\] The declaration of \[echo\]\/broken is malformed: Unknown tag 'targte' on 'on'/],
    ['method syntax on a service call with no target',
      {given: {x: 1}, phases: {a: ['$given.x', '[util]/when']}},
      {code: 'no-target', address: '$a.@1'},
      /Method syntax was used for \[util\]\/when but it declares no target field/],
    ['an unknown phase in select',
      {phases: {a: ['[echo]/echo', {on: 1}]}, select: '$b'},
      {code: 'unknown-reference', address: 'select'},
      /Unknown reference '\$b' in select/],
    ['a bare name in select',
      {phases: {a: ['[echo]/echo', {on: 1}]}, select: 'a'},
      {code: 'invalid-select', address: 'select'},
      /select takes references: '\$a'/]
  ]

  for (const [name, query, {code, address}, pattern] of cases) {
    it(`rejects ${name}`, () => {
      assert.throws(() => compileQuery(query), (error) => {
        assert.match(error.message, pattern)
        assert.deepEqual({code: error.code, address: error.address}, {code, address})
        return true
      })
    })
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

// Error codes are API: every one core raises is documented, and every
// documented one is raised.
describe('error codes', () => {
  const read = (file) => readFile(new URL(`../${file}`, import.meta.url), 'utf8')
  const raised = async () => {
    const sources = await Promise.all(['compile.js', 'graph.js', 'types.js', 'execute.js'].map(read))
    const codes = sources.flatMap(source => [...source.matchAll(/(?:fail\([^,]+, |runError\([^,]+, |code: |issue\()'([a-z-]+)'/g)].map(([, code]) => code))
    return [...new Set(codes)].sort()
  }
  const documented = async () => {
    const doc = await read('docs/runtime-integration.md')
    const section = doc.slice(doc.indexOf('## Errors'), doc.indexOf('## The runtime API'))
    return [...new Set([...section.matchAll(/^\| `([a-z-]+)` \|/gm)].map(([, code]) => code))].sort()
  }

  it('documents exactly the codes core raises', async () => {
    const codes = await raised()
    assert.equal(codes.length, 23)
    assert.deepEqual(await documented(), codes)
  })
})
