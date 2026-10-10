import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import compile from '../compile.js'

const echo = {
  async '/echo'({on}) { return on },
  '/items': {
    async GET() { return [] },
    async POST({on}) { return on }
  }
}
echo['/echo']._argtypes = {on: {argOrder: 0}}

const compileQuery = (query) => compile({services: {echo}, ...query})

describe('Compile-time errors', () => {
  // [name, query, error pattern]
  const cases = [
    ['an unknown $name',
      {phases: {a: ['GET [echo]/echo', {on: '$missing'}]}},
      /\[\$a\.@1\] Unknown reference '\$missing'/],
    ['$given when the Query has no given',
      {phases: {a: ['GET [echo]/echo', {on: '$given.x'}]}},
      /Unknown reference '\$given\.x'/],
    ['an unknown @name',
      {given: {xs: [1]}, phases: {a: ['$given.xs', 'GET [util]/each', {service: ['GET [echo]/echo', {on: '@item'}]}]}},
      /\[\$a\.@1a1\] Unknown reference '@item'/],
    ['an @name used outside its iteration',
      {given: {xs: [1]}, phases: {a: ['$given.xs', 'GET [util]/each', {as: 'x', service: ['GET [echo]/echo', {on: '@'}]}], b: ['GET [echo]/echo', {on: '@x'}]}},
      /\[\$b\.@1\] Unknown reference '@x'/],
    ['a binding name used twice',
      {
        given: {xs: [1]}, phases: {
          a: ['$given.xs', 'GET [util]/each', {as: 'x', service: ['GET [echo]/echo', {on: '@x'}]}],
          b: ['$given.xs', 'GET [util]/each', {as: 'x', service: ['GET [echo]/echo', {on: '@x'}]}]
        }
      },
      /\[\$b\.@1\] Binding name 'x' is used more than once/],
    ['the old $.name form',
      {given: {x: 1}, phases: {a: ['GET [echo]/echo', {on: '$.given.x'}]}},
      /The \$\.name form is replaced by \$name. Use '\$given\.x'/],
    ['@@',
      {given: {xs: [1]}, phases: {a: ['$given.xs', 'GET [util]/each', {service: ['GET [echo]/echo', {on: '@@'}]}]}},
      /@@ is removed/],
    ['bare $',
      {phases: {a: ['GET [echo]/echo', {on: '$'}]}},
      /Bare \$ is not supported/],
    ['bare @ at the start of a phase',
      {phases: {a: ['GET [echo]/echo', {on: '@'}]}},
      /\[\$a\.@1\] Invalid reference '@': nothing flows into this call/],
    ['bare @ in the first step of a chain',
      {given: {x: 1}, phases: {a: [['GET [echo]/echo', {on: '@'}], ['@', 'GET [echo]/echo']]}},
      /\[\$a\.@1\] Invalid reference '@': nothing flows/],
    ['a chain in a service argument without as:',
      {given: {xs: [1]}, phases: {a: ['$given.xs', 'GET [util]/each', {service: [['GET [echo]/echo', {on: 1}]]}]}},
      /\[\$a\.@1\] The chain in 'service' can't reach its input. Name it with as:/],
    ['as: on a call that takes no service',
      {given: {x: 1}, phases: {a: ['GET [echo]/echo', {on: '$given.x', as: 'x'}]}},
      /as: names an iteration, but GET \[echo\]\/echo takes no service/],
    ['@err outside any onError',
      {phases: {a: ['GET [echo]/echo', {on: '@err'}]}},
      /\[\$a\.@1\] Unknown reference '@err': no enclosing onError/],
    ['@@err with only one enclosing onError',
      {phases: {a: ['GET [echo]/echo', {on: 1, onError: ['GET [echo]/echo', {on: '@@err'}]}]}},
      /\[\$a\.@1a1\] Unknown reference '@@err': it is inside only 1 onError/],
    ['err as a binding name',
      {given: {xs: [1]}, phases: {a: ['$given.xs', 'GET [util]/each', {as: 'err', service: ['GET [echo]/echo', {on: '@err'}]}]}},
      /'err' is reserved for the error in onError/],
    ['a phase named given',
      {phases: {given: ['GET [echo]/echo', {on: 1}]}},
      /'given' is reserved/],
    ['a malformed Service Call Validation',
      {phases: {a: ['GET [echo]/echo', {on: 1, precheck: {on: ['nope']}}]}},
      /Service Call Validation precheck schema parse error/],
    ['a phase named trigger',
      {phases: {trigger: ['GET [echo]/echo', {on: 1}]}},
      /'trigger' is reserved/],
    ['a Service Call Address used as a reference',
      {phases: {a: ['GET [echo]/echo', {on: 1}], b: ['GET [echo]/echo', {on: '$a.@1'}]}},
      /Service call addresses are not reliable references in queries - they break when ordering changes. Use an alias instead./],
    ['a literal that looks like a reference',
      {phases: {a: ['GET [echo]/echo', {on: '$5.00'}]}},
      /must be supplied through given/],
    ['the retired service:action form',
      {phases: {a: ['echo:echo', {on: 1}]}},
      /uses the retired service:action form. Use 'GET \[echo\]\/echo'/],
    ['the retired service:action form in method syntax',
      {given: {x: 1}, phases: {a: ['$given.x', 'echo:echo']}},
      /uses the retired service:action form. Use 'GET \[echo\]\/echo'/],
    ['an unknown service',
      {phases: {a: ['GET [nope]/echo', {on: 1}]}},
      /Service 'nope' not found/],
    ['an unknown resource',
      {phases: {a: ['GET [echo]/nope', {on: 1}]}},
      /Resource '\/nope' not found on service 'echo'/],
    ['a method the resource does not declare',
      {phases: {a: ['POST [echo]/echo', {on: 1}]}},
      /Method 'POST' is not declared by \[echo\]\/echo \(declares GET\)/],
    ['a method missing from a several-method resource',
      {phases: {a: ['DELETE [echo]/items', {}]}},
      /Method 'DELETE' is not declared by \[echo\]\/items \(declares GET, POST\)/],
    ['an unknown phase in select',
      {phases: {a: ['GET [echo]/echo', {on: 1}]}, select: '$b'},
      /Unknown reference '\$b' in select/],
    ['a bare name in select',
      {phases: {a: ['GET [echo]/echo', {on: 1}]}, select: 'a'},
      /select takes references: '\$a'/]
  ]

  for (const [name, query, pattern] of cases) {
    it(`rejects ${name}`, () => {
      assert.throws(() => compileQuery(query), pattern)
    })
  }

  it('accepts a literal reference-like string supplied through given', () => {
    assert.doesNotThrow(() => compileQuery({given: {price: '$5.00'}, phases: {a: ['GET [echo]/echo', {on: '$given.price'}]}}))
  })

  it('dispatches each method of a several-method resource to its own function', () => {
    const {phases} = compileQuery({phases: {a: ['POST [echo]/items', {on: 1}], b: ['GET [echo]/items', {}]}})
    assert.equal(phases.a.steps[0].action, echo['/items'].POST)
    assert.equal(phases.b.steps[0].action, echo['/items'].GET)
  })

  it('warns, but compiles, when a binding shares a phase name', () => {
    const {warnings} = compileQuery({
      given: {xs: [1]},
      phases: {
        listing: ['$given.xs', 'GET [util]/each', {as: 'listing', service: ['GET [echo]/echo', {on: '@listing'}]}]
      }
    })
    assert.deepEqual(warnings, [{address: '$listing.@1', message: 'Binding \'@listing\' shares its name with \'$listing\''}])
  })
})
