import assert from 'node:assert'
import { describe, it } from 'mocha'
import query from '../query.js'

describe('Service This Binding Tests', () => {
  it('should allow services to use this for internal state', async () => {
    // Create a service that uses this to access internal state
    const testService = {
      internalState: 'service-internal-data',
      internalMethod() {
        return 'internal-method-result'
      },

      async testMethod({ input }) {
        // This should refer to the service object, not AST node
        assert.strictEqual(this.internalState, 'service-internal-data')
        assert.strictEqual(this.internalMethod(), 'internal-method-result')

        return {
          input,
          fromInternal: this.internalState,
          fromMethod: this.internalMethod(),
        }
      },
    }

    const result = await query({
      given: { value: 'test-input' },
      services: { testService },
      query: {
        result: ['testService', 'testMethod', { input: '$.given.value' }],
      },
      select: 'result',
    })

    assert.deepStrictEqual(result, {
      input: 'test-input',
      fromInternal: 'service-internal-data',
      fromMethod: 'internal-method-result',
    })
  })

  it('should work with stateful services', async () => {
    // Service with mutable state
    const counterService = {
      count: 0,

      async increment({ by = 1 }) {
        this.count += by
        return this.count
      },

      async getCount() {
        return this.count
      },
    }

    const result = await query({
      services: { counterService },
      query: {
        first: ['counterService', 'increment', { by: 5 }],
        second: ['counterService', 'increment', { by: 3 }],
        final: ['counterService', 'getCount', {}],
      },
      select: ['first', 'second', 'final'],
    })

    assert.deepStrictEqual(result, {
      first: 5,
      second: 8,
      final: 8,
    })
  })
})
