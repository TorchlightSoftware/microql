import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import {ERRORS, errorOf, locate, reasonOf, isCatalogued} from '../src/common/error-catalog.js'

const HTTP_STATUSES = [400, 404, 405, 422, 500, 501, 502, 504]

// The codes reported rather than raised: plan()'s type issues, which have no status.
const REPORTED = ['type-mismatch', 'maybe-missing', 'type-narrowing']

describe('the error catalog', () => {
  for (const [code, {status}] of Object.entries(ERRORS)) {
    if (REPORTED.includes(code)) it(`gives ${code}, which is reported, no status`, () => assert.equal(status, undefined))
    else it(`gives ${code} an HTTP status`, () => assert.ok(HTTP_STATUSES.includes(status)))
  }
})

// Every code's wording, said once: what a person reads for these details.
// Tests elsewhere name an error by its code and details, never its message.
// [code, details, message]
const WORDING = [
  // compile: the Query's grammar
  ['invalid-descriptor', {descriptor: '["nope"]'}, '["nope"] is not a service descriptor.\n\nWrite a call as [\'[METHOD] [service]/resource\', {...}].'],
  ['invalid-arguments', {key: '[echo]/echo'}, 'The arguments of [echo]/echo are not an object.'],
  ['retired-key', {retired: 'onError', replacement: 'Use catch:.'}, '\'onError\' is retired.\n\nUse catch:.'],
  ['raw-function', {key: '[util]/map', path: 'service'}, '\'service\' of [util]/map is a JavaScript function.\n\nHold a service descriptor there instead, as in [\'[service]/resource\', {arg: \'@\'}].'],
  ['unreachable-input', {field: 'service'}, 'The chain in \'service\' can\'t reach its input.\n\nName it with as: and reference it as @name.'],
  ['misplaced-as', {key: '[echo]/echo'}, 'as: names an iteration, but [echo]/echo takes no call.'],
  ['misplaced-catch', {key: '[echo]/echo'}, 'catch: handles failures of the calls a call holds, but [echo]/echo holds none.\n\nTo catch a single call, hold it in [util]/try.'],
  ['reserved-name', {reserved: 'err', naming: 'an iteration'}, '\'err\' is reserved, and can\'t name an iteration.'],
  ['duplicate-binding', {binding: 'x'}, 'Binding name \'x\' is used more than once.\n\nBinding names are Query-scoped.'],
  ['invalid-select', {select: 'a'}, 'select takes references, not \'a\'.\n\nUse \'$a\'.'],
  ['circular-dependency', {phases: ['a', 'b']}, 'Phases \'a\', \'b\' depend on each other.'],
  ['malformed-schema', {validation: 'Service Call Validation', order: 'precheck', details: 'Unknown type name \'nope\''}, 'The Service Call Validation precheck schema is malformed:\nUnknown type name \'nope\''],
  ['no-target', {key: '[util]/when'}, 'Method syntax was used for [util]/when, which declares no target field.'],
  ['shared-handle', {key: '[scraper]/open', field: 'session', value: 'default', phases: ['$a', '$b']}, 'session \'default\' of [scraper]/open is in $a and $b: what it names belongs to one phase.\n\nA phase replays as a whole, so a later one can\'t count on the state an earlier one left: give each phase its own.'],
  ['unknown-field', {key: '[echo]/echo', field: 'extra', declared: ['on']}, '\'extra\' is not a field of [echo]/echo.\n\nIt takes \'on\'.'],
  ['unknown-field', {key: '[echo]/none', field: 'extra', declared: []}, '\'extra\' is not a field of [echo]/none.\n\nIt takes no fields.'],

  // compile: references
  ['invalid-reference', {reference: '$5.00'}, '\'$5.00\' is not a reference.\n\nA literal string beginning with $ or @ must be supplied through given.'],
  ['bare-reference', {}, '\'$\' names no phase.\n\nReference a phase by name: $name.'],
  ['address-reference', {reference: '$a.@1'}, '\'$a.@1\' names a Service Call Address.\n\nAddresses change when calls are reordered; name the value with as: and reference that instead.'],
  ['unknown-reference', {reference: '$missing'}, '\'$missing\' names no phase or node.'],
  ['unknown-binding', {reference: '@item', binding: 'item'}, '\'@item\' names \'item\', which no enclosing iteration names with as:.'],
  ['unknown-error', {reference: '@err', catches: 0}, '\'@err\' is inside no catch.'],
  ['unknown-error', {reference: '@@err', catches: 1}, '\'@@err\' is inside only 1 catch.'],
  ['nothing-flows', {reference: '@'}, '\'@\' reads what flows into this call, and nothing does.\n\nThe first call of a phase or chain receives nothing; name an iteration with as: to reach its item.'],

  // compile: services and their keys
  ['unknown-service', {service: 'nope'}, 'Service \'nope\' is not registered in this scope.'],
  ['not-a-service', {service: 'plain'}, 'Service \'plain\' lacks lookup(key), supportedCalls() or init(env).\n\nA service definition gets them from defineService.'],
  ['missing-capability', {service: 'browser', capability: 'chrome'}, 'Service \'browser\' requires env.chrome, which this runtime doesn\'t provide.'],
  ['missing-capability', {service: 'scraper', capability: 'browser', handle: true}, 'Service \'scraper\' works on handles of kind browser, which this runtime doesn\'t offer.'],
  ['unknown-resource', {key: '[echo]/nope'}, '[echo]/nope is not a resource of this service.'],
  ['confined-key', {key: '[@util]/each'}, '[@util]/each is confined, and this service answers no confined calls.'],
  ['unconfined-key', {key: '[shop]/secret', confinedKey: '[@shop]/secret'}, '[shop]/secret isn\'t confined, and this service answers only confined calls.\n\nUse [@shop]/secret.'],
  ['method-required', {key: '[shop]/orders', methods: ['GET', 'POST']}, '[shop]/orders needs a method.\n\nIt answers GET, POST.'],
  ['method-not-allowed', {key: '[shop]/orders', method: 'DELETE', methods: ['GET', 'POST']}, '[shop]/orders doesn\'t answer DELETE.\n\nIt answers GET, POST.'],
  ['method-not-allowed', {key: '[util]/each', method: 'GET', methods: []}, '[util]/each takes no method, and got GET.'],
  ['refused-key', {key: '[shop]/x', reason: 'no'}, '[shop]/x was refused by its service: no'],

  // a service's declaration
  ['malformed-declaration', {key: '[echo]/broken', reason: 'Unknown tag \'targte\' on \'on\'.'}, 'The declaration of [echo]/broken is malformed: Unknown tag \'targte\' on \'on\'.'],
  ['malformed-document', {document: 'input', reason: 'Unknown type name \'nope\''}, 'Unknown type name \'nope\', in input'],
  ['function-type', {}, 'A service call is typed \'call\', not \'function\''],
  ['unknown-tag', {tag: 'targte', path: 'on'}, 'Unknown tag \'targte\' on \'on\'.'],
  ['unnamed-handle', {path: 'session'}, '\'session\' is a handle without a kind.\n\nA handle names the kind of resource it is, one a runtime offers: [\'handle\', \'browser\'].'],
  ['multiple-targets', {paths: ['a', 'b']}, 'Fields \'a\', \'b\' are each tagged target.\n\nOnly one field can be the target.'],
  ['malformed-source', {source: '{fromWhere: "a"}', kinds: ['fromField', 'fromList']}, '{fromWhere: "a"} is not a source, which has exactly one of fromField, fromList'],
  ['malformed-source-operand', {kind: 'merged', takes: 'a pair of sources'}, 'merged takes a pair of sources'],
  ['invalid-field-path', {path: 'a..'}, 'Field path \'a..\' names an empty field.'],

  // a runtime and its config
  ['missing-scope', {}, '\'scope\' is missing.\n\nCompile a Query in the scope runtime.scopeOf gives.'],
  ['invalid-scope', {details: 'tenantId: Invalid input'}, 'The scope doesn\'t fit the scope schema:\ntenantId: Invalid input'],
  ['invalid-config', {service: 'notes', details: 'vault: Too small'}, 'Service \'notes\' can\'t use this config:\nvault: Too small'],
  ['malformed-config-declaration', {service: 'broken', reason: 'Unknown type name \'nope\''}, 'Service \'broken\' has a malformed config declaration: Unknown type name \'nope\''],
  ['malformed-oauth', {}, 'oauth takes {authorizeUrl, tokenUrl, scopes}'],
  ['missing-config', {service: 'vault'}, 'Service \'vault\' declares config, and none is filed for it in this scope.'],

  // plan: type issues
  ['type-mismatch', {expects: 'string', receives: 'array of number'}, 'Expects string but receives array of number.'],
  ['maybe-missing', {expects: 'string', receives: 'string | undefined'}, 'Expects string but may receive nothing: string | undefined.'],
  ['type-narrowing', {expects: 'string', receives: 'any'}, 'Expects string but receives any, which is only checked when it runs.'],

  // execute
  ['missing-run-state', {}, '\'scope.run\' does not contain a valid RunState.'],
  ['invalid-target', {target: '$a.@1', phase: 'a'}, 'Target \'$a.@1\' is not a phase reference.\n\nUse \'$a\'.'],
  ['invalid-target', {target: '@item'}, 'Target \'@item\' is not a phase reference.\n\nName a phase as \'$phase\'.'],
  ['unknown-target', {target: '$nope'}, 'Target \'$nope\' names no phase.'],
  ['invalid-trigger', {details: 'id: Invalid input'}, 'The trigger payload doesn\'t fit the trigger schema:\nid: Invalid input'],
  ['invalid-ttl', {ttl: 'soon'}, 'Cache ttl \'soon\' is not a duration.\n\nWrite a number and a unit, s, m, h, D or M, as in \'7D\'.'],
  ['precheck-failed', {validation: 'Service Call Validation', details: 'on: Too small'}, 'Service Call Validation precheck failed:\non: Too small'],
  ['postcheck-failed', {validation: 'Service Defined Validation', details: 'images: Too small'}, 'Service Defined Validation postcheck failed:\nimages: Too small'],
  ['timeout', {timeout: 5}, 'Timed out after 5ms.'],
  ['gave-up', {tries: 3, miss: '- n: 1 => Too small'}, 'Gave up after 3 tries. The last:\n- n: 1 => Too small']
]

describe('the catalog\'s wording', () => {
  for (const [code, details, message] of WORDING) {
    it(`words ${code} for ${JSON.stringify(details)}`, () => assert.equal(errorOf(code, details).message, message))
  }

  it('words every code in the catalog', () => {
    const worded = new Set(WORDING.map(([code]) => code))
    assert.deepEqual(Object.keys(ERRORS).filter(code => !worded.has(code)), [])
  })
})

describe('errorOf', () => {
  // [code, details, where, what the error carries]
  const errors = [
    ['unknown-service',
      {service: 'nope'},
      undefined,
      {code: 'unknown-service', status: 404, service: 'nope', baseMessage: 'Service \'nope\' is not registered in this scope.', message: 'Service \'nope\' is not registered in this scope.'}],
    ['missing-run-state',
      {},
      'execute:',
      {code: 'missing-run-state', status: 500, baseMessage: 'execute: \'scope.run\' does not contain a valid RunState.', message: 'execute: \'scope.run\' does not contain a valid RunState.'}],
    ['retired-key',
      {retired: 'onError', replacement: 'Use catch:.'},
      '[$a.@1]',
      {code: 'retired-key', status: 400, retired: 'onError', replacement: 'Use catch:.', hint: 'Use catch:.', baseMessage: '[$a.@1] \'onError\' is retired.', message: '[$a.@1] \'onError\' is retired.\n\nUse catch:.'}]
  ]

  for (const [code, details, where, carries] of errors) {
    it(`makes ${code}${where ? ` at ${where}` : ''}`, () => {
      const error = errorOf(code, details, {where})
      assert.ok(error instanceof Error)
      assert.deepEqual({...error, message: error.message}, carries)
    })
  }

  it('keeps the error behind it as its cause, and gives that cause\'s hint when it has none of its own', () => {
    const cause = errorOf('multiple-targets', {paths: ['a', 'b']})
    const error = errorOf('malformed-declaration', {key: '[x]/y', reason: reasonOf(cause)}, {cause})
    assert.equal(error.cause, cause)
    assert.equal(error.message, 'The declaration of [x]/y is malformed: Fields \'a\', \'b\' are each tagged target.\n\nOnly one field can be the target.')
  })
})

describe('locate', () => {
  it('places a catalogued error, before its hint', () => {
    const error = locate(errorOf('misplaced-catch', {key: '[x]/y'}), '[$a.@1]')
    assert.equal(error.baseMessage, '[$a.@1] catch: handles failures of the calls a call holds, but [x]/y holds none.')
    assert.equal(error.message, `${error.baseMessage}\n\nTo catch a single call, hold it in [util]/try.`)
  })

  it('places an error MicroQL didn\'t raise, giving it a base message', () => {
    const error = locate(new Error('Service failed'), '[$a.@1 - [x]/y]')
    assert.deepEqual({message: error.message, baseMessage: error.baseMessage}, {message: '[$a.@1 - [x]/y] Service failed', baseMessage: '[$a.@1 - [x]/y] Service failed'})
  })
})

describe('isCatalogued', () => {
  // [error, whether MicroQL raised it]
  const errors = [
    [errorOf('timeout', {timeout: 5}), true],
    [new Error('Service failed'), false],
    [Object.assign(new Error('no such file'), {code: 'ENOENT'}), false],
    ['a string', false]
  ]

  for (const [error, catalogued] of errors) {
    it(`${catalogued ? 'knows' : 'doesn\'t know'} ${error.code ?? error.message ?? error}`, () => assert.equal(isCatalogued(error), catalogued))
  }
})
