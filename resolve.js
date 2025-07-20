import _ from 'lodash'
import {AT_REGEX} from './common.js'

// Helper function to resolve @ and $ references in values
const resolveValue = (queryResults, contextStack, value) => {
  if (typeof value !== 'string') return value

  // Handle bare $ - returns all completed queries
  if (value === '$') return _.omitBy(queryResults, (r, key) => key.startsWith('_'))

  // Handle $.path references (e.g., "$.given.value")
  if (value.startsWith('$.')) {
    const path = value.substring(2) // Remove "$."
    return _.get(queryResults, path)
  }

  //console.log('matching context for: [', value, '], with stack:', contextStack, 'stack contents:', contextStack.stack)

  // Handle @ references (current context)
  let m = value.match(AT_REGEX)
  if (m) {
    const [__, ats, _dotandpath, _dot, path] = m
    const atCount = ats.length
    //console.log('Resolving @:', value, 'atCount:', atCount, 'stack size:', contextStack.stack.length, 'stack:', contextStack.stack)
    const targetContext = contextStack.get(atCount)
    const result = path && path.length > 0 ? _.get(targetContext, path) : targetContext
    //console.log('ats:', ats, 'path:', path, 'result:', result)
    return result
  }

  return value
}

export default resolveValue
