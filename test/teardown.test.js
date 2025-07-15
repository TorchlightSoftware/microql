import assert from 'node:assert'
import { describe, it } from 'mocha'
import query from '../query.js'

describe('TearDown Tests', () => {
  it('should call tearDown on services that have it', async () => {
    let tearDownCalled = false

    // Mock service with tearDown method
    const mockService = {
      async testAction() {
        return 'test result'
      },

      async tearDown() {
        tearDownCalled = true
      },
    }

    await query({
      services: { mockService },
      query: {
        test: ['mockService', 'testAction', {}],
      },
    })

    assert.strictEqual(tearDownCalled, true, 'tearDown should have been called')
  })

  it('should not fail if service does not have tearDown', async () => {
    // Service without tearDown method
    const serviceWithoutTearDown = {
      async testAction() {
        return 'test result'
      },
    }

    // This should not throw an error
    const result = await query({
      services: { serviceWithoutTearDown },
      query: {
        test: ['serviceWithoutTearDown', 'testAction', {}],
      },
    })

    assert.deepStrictEqual(result, { test: 'test result' })
  })

  it('should call tearDown on multiple services', async () => {
    const tearDownCalls = []

    const service1 = {
      async action() {
        return 'result1'
      },
      async tearDown() {
        tearDownCalls.push('service1')
      },
    }

    const service2 = {
      async action() {
        return 'result2'
      },
      async tearDown() {
        tearDownCalls.push('service2')
      },
    }

    await query({
      services: { service1, service2 },
      query: {
        test1: ['service1', 'action', {}],
        test2: ['service2', 'action', {}],
      },
    })

    assert.strictEqual(
      tearDownCalls.length,
      2,
      'Both services should have tearDown called'
    )
    assert(
      tearDownCalls.includes('service1'),
      'service1 tearDown should be called'
    )
    assert(
      tearDownCalls.includes('service2'),
      'service2 tearDown should be called'
    )
  })

  it('should call tearDown even if query fails', async () => {
    let tearDownCalled = false

    const serviceWithError = {
      async failingAction() {
        throw new Error('Test error')
      },

      async tearDown() {
        tearDownCalled = true
      },
    }

    try {
      await query({
        services: { serviceWithError },
        query: {
          test: ['serviceWithError', 'failingAction', {}],
        },
      })
      assert.fail('Query should have thrown an error')
    } catch (error) {
      // Expected error
      assert(error.message.includes('Test error'), 'Should get the test error')
    }

    assert.strictEqual(
      tearDownCalled,
      true,
      'tearDown should be called even when query fails'
    )
  })

  it('should not call tearDown for unused services', async () => {
    let tearDownCalled = false

    const usedService = {
      async action() {
        return 'result'
      },
    }

    const unusedService = {
      async action() {
        return 'unused'
      },
      async tearDown() {
        tearDownCalled = true
      },
    }

    await query({
      services: { usedService, unusedService },
      query: {
        test: ['usedService', 'action', {}],
      },
    })

    assert.strictEqual(
      tearDownCalled,
      false,
      'tearDown should not be called for unused services'
    )
  })

  it('should handle tearDown errors gracefully', async () => {
    const _queryCompleted = false

    const serviceWithBadTearDown = {
      async action() {
        return 'result'
      },
      async tearDown() {
        throw new Error('TearDown failed')
      },
    }

    // Should not throw despite tearDown error
    const result = await query({
      services: { serviceWithBadTearDown },
      query: {
        test: ['serviceWithBadTearDown', 'action', {}],
      },
    })

    assert.deepStrictEqual(result, { test: 'result' })
  })
})
