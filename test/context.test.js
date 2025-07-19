import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import ContextStack from '../context.js'

describe('ContextStack Tests', () => {
  it('should construct with empty or provided arrays', () => {
    const empty = new ContextStack()
    assert.deepEqual(empty.stack, [])

    const withData = new ContextStack(['a', 'b', 'c'])
    assert.deepEqual(withData.stack, ['a', 'b', 'c'])

    // Should copy array, not share reference
    const original = [1, 2, 3]
    const stack = new ContextStack(original)
    original.push(4)
    assert.deepEqual(stack.stack, [1, 2, 3])
  })

  it('should get values by depth from end', () => {
    const stack = new ContextStack(['a', 'b', 'c'])

    assert.equal(stack.get(1), 'c') // Last item
    assert.equal(stack.get(2), 'b') // Second to last
    assert.equal(stack.get(3), 'a') // Third to last

    // Invalid depth should throw
    assert.throws(() => stack.get(4), /Invalid stack reference/)

    // Depth 0 should throw
    assert.throws(() => stack.get(0), /Depth must be 1 or greater/)
  })

  it('should get and set current value', () => {
    const stack = new ContextStack(['a', 'b', 'c'])

    assert.equal(stack.getCurrent(), 'c')

    stack.setCurrent('new-c')
    assert.equal(stack.getCurrent(), 'new-c')
    assert.deepEqual(stack.stack, ['a', 'b', 'new-c'])

    // Should throw on empty stack
    const empty = new ContextStack()
    assert.throws(() => empty.getCurrent(), /Invalid stack reference/)
    assert.throws(() => empty.setCurrent('value'), /Invalid stack reference/)
  })

  it('should extend with new values', () => {
    const original = new ContextStack(['a', 'b'])
    const extended = original.extend('c')

    // Extended should have new value
    assert.deepEqual(extended.stack, ['a', 'b', 'c'])

    // Original should be unchanged
    assert.deepEqual(original.stack, ['a', 'b'])

    // Should be different objects
    assert.notEqual(extended, original)

    // Should handle null/undefined
    const withNull = original.extend(null)
    assert.deepEqual(withNull.stack, ['a', 'b', null])

    const withUndefined = original.extend(undefined)
    assert.deepEqual(withUndefined.stack, ['a', 'b', undefined])
  })

  it('should maintain isolation between instances', () => {
    const stack1 = new ContextStack(['a', 'b'])
    const stack2 = stack1.extend('c')

    // Modifying one should not affect the other
    stack1.setCurrent('modified-b')
    stack2.setCurrent('modified-c')

    assert.equal(stack1.getCurrent(), 'modified-b')
    assert.equal(stack2.getCurrent(), 'modified-c')
    assert.equal(stack2.get(2), 'b') // Original value preserved
  })
})
