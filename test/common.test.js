import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import {DEP_REGEX, METHOD_REGEX, AT_REGEX, BARE_DOLLAR_REGEX} from '../common.js'

describe('Common Regex Tests', () => {
  describe('DEP_REGEX - matches dollar dependency patterns', () => {
    it('should match valid dollar dependency patterns', () => {
  // Valid matches
  const validCases = [
    ['$.foo', '$.foo', 'foo'],
    ['$.bar', '$.bar', 'bar'],
    ['$.service123', '$.service123', 'service123'],
    ['$.camelCase', '$.camelCase', 'camelCase'],
    ['$.snake_case', '$.snake_case', 'snake_case'],
    ['$.UPPERCASE', '$.UPPERCASE', 'UPPERCASE'],
    ['$.a1b2c3', '$.a1b2c3', 'a1b2c3']
  ]

  validCases.forEach(([input, expectedMatch, expectedCapture]) => {
    const match = input.match(DEP_REGEX)
    assert(match, `Should match: ${input}`)
    assert.equal(match[0], expectedMatch)
    assert.equal(match[1], expectedCapture)
  })

  // Invalid cases (should not match)
  const invalidCases = [
    '$',
    '$.',
    '$.-foo',
    '$ .foo',
    '$..foo'
  ]

  invalidCases.forEach(input => {
    const match = input.match(DEP_REGEX)
    assert.equal(match, null, `Should not match: ${input}`)
  })

  // Partial matches (matches only the valid part)
  const partialMatches = [
    ['$.foo-bar', '$.foo', 'foo'],
    ['$.foo.bar', '$.foo', 'foo'],
    ['$.foo bar', '$.foo', 'foo'],
    ['foo$.bar', '$.bar', 'bar'] // DEP_REGEX can match within a string
  ]

  partialMatches.forEach(([input, expectedMatch, expectedCapture]) => {
    const match = input.match(DEP_REGEX)
    assert(match, `Should partially match: ${input}`)
    assert.equal(match[0], expectedMatch)
    assert.equal(match[1], expectedCapture)
  })
    })
  })

  describe('METHOD_REGEX - matches method syntax', () => {
    it('should match valid method syntax patterns', () => {
  // Valid matches
  const validCases = [
    ['service:method', 'service:method', 'service', 'method'],
    ['foo:bar', 'foo:bar', 'foo', 'bar'],
    ['service123:method456', 'service123:method456', 'service123', 'method456'],
    ['a:b', 'a:b', 'a', 'b'],
    ['CamelCase:method', 'CamelCase:method', 'CamelCase', 'method'],
    ['service:camelMethod', 'service:camelMethod', 'service', 'camelMethod']
  ]

  validCases.forEach(([input, expectedMatch, expectedService, expectedMethod]) => {
    const match = input.match(METHOD_REGEX)
    assert(match, `Should match: ${input}`)
    assert.equal(match[0], expectedMatch)
    assert.equal(match[1], expectedService)
    assert.equal(match[2], expectedMethod)
  })

  // Invalid cases
  const invalidCases = [
    'service',
    ':method',
    'service:',
    'service::method',
    'service:method:extra',
    'service-name:method',
    'service:method-name',
    'service.name:method',
    'service:method.name',
    ' service:method',
    'service:method ',
    'service: method',
    'service :method'
  ]

  invalidCases.forEach(input => {
    const match = input.match(METHOD_REGEX)
    assert.equal(match, null, `Should not match: ${input}`)
  })
    })
  })

  describe('AT_REGEX - matches context references', () => {
    it('should match valid context reference patterns', () => {
  // Valid matches - new regex structure: group 1 = @s, group 2 = entire optional part, group 3 = dot, group 4 = content
  const validCases = [
    ['@', '@', '@', undefined, undefined, undefined],
    ['@@', '@@', '@@', undefined, undefined, undefined],
    ['@@@', '@@@', '@@@', undefined, undefined, undefined],
    ['@.', '@.', '@', '.', '.', ''],
    ['@@.', '@@.', '@@', '.', '.', ''],
    ['@.property', '@.property', '@', '.property', '.', 'property'],
    ['@@.property', '@@.property', '@@', '.property', '.', 'property'],
    ['@@@.property', '@@@.property', '@@@', '.property', '.', 'property'],
    ['@.foo', '@.foo', '@', '.foo', '.', 'foo'],
    ['@@.foo', '@@.foo', '@@', '.foo', '.', 'foo'],
    ['@.property.nested', '@.property.nested', '@', '.property.nested', '.', 'property.nested'],
    ['@@.property.nested.deep', '@@.property.nested.deep', '@@', '.property.nested.deep', '.', 'property.nested.deep'],
    ['@.123', '@.123', '@', '.123', '.', '123'],
    ['@._underscore', '@._underscore', '@', '._underscore', '.', '_underscore'],
    ['@.-dash', '@.-dash', '@', '.-dash', '.', '-dash'],
    ['@.[0]', '@.[0]', '@', '.[0]', '.', '[0]'],
    ['@.["key"]', '@.["key"]', '@', '.["key"]', '.', '["key"]'],
    ['@.[complex.path]', '@.[complex.path]', '@', '.[complex.path]', '.', '[complex.path]']
  ]

  validCases.forEach(([input, expectedMatch, expectedAts, expectedGroup2, expectedDot, expectedPath]) => {
    const match = input.match(AT_REGEX)
    assert(match, `Should match: ${input}`)
    assert.equal(match[0], expectedMatch)
    assert.equal(match[1], expectedAts)
    assert.equal(match[2], expectedGroup2)
    assert.equal(match[3], expectedDot)
    assert.equal(match[4], expectedPath)
  })

  // Invalid cases - patterns without dot after @ no longer match (except bare @)
  const invalidCases = [
    '',
    '@property',
    '@@property',
    '@foo',
    '@@foo',
    '@123',
    '@_underscore',
    '@-dash',
    '@[0]',
    'not@',
    'before@after'
  ]

  invalidCases.forEach(input => {
    const match = input.match(AT_REGEX)
    assert.equal(match, null, `Should not match: ${input}`)
  })
    })
  })

  describe('BARE_DOLLAR_REGEX - matches bare dollar sign', () => {
    it('should match only bare dollar sign', () => {
  // Valid matches
  assert('$'.match(BARE_DOLLAR_REGEX), 'Should match bare $')

  // Invalid cases
  const invalidCases = [
    '',
    '$$',
    '$.foo',
    '$foo',
    'a$',
    '$a',
    ' $',
    '$ ',
    '\n$',
    '$\n'
  ]

  invalidCases.forEach(input => {
    const match = input.match(BARE_DOLLAR_REGEX)
    assert.equal(match, null, `Should not match: ${input}`)
  })
    })
  })

  describe('Regex edge cases', () => {
    it('should handle edge cases correctly', () => {
  // Testing empty strings
  assert.equal(''.match(DEP_REGEX), null)
  assert.equal(''.match(METHOD_REGEX), null)
  assert.equal(''.match(AT_REGEX), null)
  assert.equal(''.match(BARE_DOLLAR_REGEX), null)

  // Testing whitespace handling
  assert.equal(' $.foo'.match(DEP_REGEX)?.[0], '$.foo')
  assert.equal('$.foo '.match(DEP_REGEX)?.[0], '$.foo')
  assert.equal(' service:method'.match(METHOD_REGEX), null) // METHOD_REGEX uses ^ and $ anchors
  assert.equal('service:method '.match(METHOD_REGEX), null) // METHOD_REGEX uses ^ and $ anchors
  assert.equal(' @.prop'.match(AT_REGEX), null) // AT_REGEX uses ^ anchor
  assert.equal('@.prop '.match(AT_REGEX)?.[0], '@.prop ') // AT_REGEX captures trailing space in group 4

  // Testing partial matches within larger strings
  assert.equal('prefix$.foo'.match(DEP_REGEX)?.[0], '$.foo')
  assert.equal('$.foo suffix'.match(DEP_REGEX)?.[0], '$.foo')
  assert.equal('prefixservice:method'.match(METHOD_REGEX)?.[0], 'prefixservice:method') // Valid because 'prefixservice' is a word
  assert.equal('service:methodsuffix'.match(METHOD_REGEX)?.[0], 'service:methodsuffix') // Valid because 'methodsuffix' is a word
  assert.equal('prefix@.prop'.match(AT_REGEX), null)
  assert.equal('@.prop suffix'.match(AT_REGEX)?.[0], '@.prop suffix') // AT_REGEX doesn't use $ anchor
    })
  })

  describe('Regex unicode and special characters', () => {
    it('should handle unicode and special characters', () => {
  // DEP_REGEX only allows word characters (\w)
  assert.equal('$.émoji'.match(DEP_REGEX), null)
  assert.equal('$.🚀'.match(DEP_REGEX), null)

  // METHOD_REGEX only allows word characters
  assert.equal('sérviçe:method'.match(METHOD_REGEX), null)
  assert.equal('service:méthød'.match(METHOD_REGEX), null)

  // AT_REGEX captures anything after @. (with new capture group structure)
  assert.equal('@.émoji'.match(AT_REGEX)?.[4], 'émoji')
  assert.equal('@.🚀'.match(AT_REGEX)?.[4], '🚀')
  assert.equal('@.property[🔑]'.match(AT_REGEX)?.[4], 'property[🔑]')
    })
  })
})
