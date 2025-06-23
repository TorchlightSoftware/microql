import retrieve from './retrieve.js'

/**
 * Resolve JSONPath or @ symbols in a template value
 */
const resolvePath = (path, source) => {
  if (typeof path !== 'string') return path
  
  // Handle @ symbol (reference to current item)
  if (path === '@') {
    return source
  }
  
  // Handle @.field - direct property access
  if (path.startsWith('@.')) {
    const fieldPath = path.slice(2) // Remove '@.'
    const fields = fieldPath.split('.')
    let result = source
    
    for (const field of fields) {
      if (result && typeof result === 'object') {
        result = result[field]
      } else {
        return null
      }
    }
    
    return result
  }
  
  // Handle regular JSONPath  
  if (path.startsWith('$.')) {
    return retrieve(path, source)
  }
  
  return path
}

/**
 * Execute a service call with current item as @ context
 */
const executeServiceCall = async (serviceCall, currentItem, services = {}) => {
  if (!Array.isArray(serviceCall) || serviceCall.length < 3) {
    throw new Error('Invalid service call format')
  }
  
  const [serviceName, action, args] = serviceCall
  const service = services[serviceName]
  
  if (!service) {
    throw new Error(`Service '${serviceName}' not found`)
  }
  
  // Simple resolution: @ refers to currentItem
  const resolvedArgs = {}
  for (const [key, value] of Object.entries(args)) {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      resolvedArgs[key] = {}
      for (const [subKey, subValue] of Object.entries(value)) {
        resolvedArgs[key][subKey] = resolvePath(subValue, currentItem)
      }
    } else {
      resolvedArgs[key] = resolvePath(value, currentItem)
    }
  }
  
  return await service(action, resolvedArgs)
}

/**
 * Utility service for common data transformations
 */
const util = {
  /**
   * Transform each item in a collection using a function or template
   */
  async map({ on, collection, fn, template, _services }) {
    const items = on || collection || []
    if (!Array.isArray(items)) return []
    
    // Template-based mapping
    if (template) {
      return items.map(item => {
        const result = {}
        for (const [key, path] of Object.entries(template)) {
          result[key] = resolvePath(path, item)
        }
        return result
      })
    }
    
    // Function-based mapping
    if (fn) {
      const results = await Promise.all(
        items.map(item => executeServiceCall(fn, item, _services || {}))
      )
      return results
    }
    
    throw new Error('Either template or fn must be provided for map operation')
  },
  
  /**
   * Filter collection based on a predicate function
   */
  async filter({ on, collection, predicate, _services }) {
    const items = on || collection || []
    if (!Array.isArray(items)) return []
    
    if (!predicate) {
      throw new Error('Predicate is required for filter operation')
    }
    
    const results = await Promise.all(
      items.map(async item => {
        const keep = await executeServiceCall(predicate, item, _services || {})
        return { item, keep }
      })
    )
    
    return results.filter(({ keep }) => keep).map(({ item }) => item)
  },
  
  /**
   * Map and then flatten the results
   */
  async flatMap({ on, collection, fn, _services }) {
    const items = on || collection || []
    if (!Array.isArray(items)) return []
    
    if (!fn) {
      throw new Error('Function is required for flatMap operation')
    }
    
    const results = await Promise.all(
      items.map(item => executeServiceCall(fn, item, _services || {}))
    )
    
    // Flatten the results
    return results.flat()
  },
  
  /**
   * Concatenate multiple arrays into a single array
   */
  async concat({ args }) {
    if (!Array.isArray(args)) {
      throw new Error('Args must be an array of arrays')
    }
    
    const result = []
    for (const arr of args) {
      if (Array.isArray(arr)) {
        result.push(...arr)
      }
    }
    
    return result
  },
  
  /**
   * Conditional logic - return different values based on test
   */
  async when({ test, then, or, _services, _context }) {
    let testResult
    
    if (typeof test === 'boolean') {
      testResult = test
    } else if (Array.isArray(test)) {
      // Service call - need to resolve JSONPath arguments using context
      const [serviceName, action, args] = test
      const resolvedArgs = {}
      
      for (const [key, value] of Object.entries(args)) {
        if (typeof value === 'string' && value.startsWith('$.')) {
          resolvedArgs[key] = retrieve(value, _context || {})
        } else {
          resolvedArgs[key] = value
        }
      }
      
      testResult = await _services[serviceName](action, resolvedArgs)
    } else {
      testResult = Boolean(test)
    }
    
    return testResult ? then : or
  },
  
  /**
   * Equality comparison
   */
  async eq({ l, r }) {
    return l === r
  },
  
  /**
   * Greater than comparison
   */
  async gt({ l, r }) {
    return l > r
  },
  
  /**
   * Less than comparison
   */
  async lt({ l, r }) {
    return l < r
  },
  
  /**
   * Check if value exists (not null/undefined)
   */
  async exists({ value }) {
    return value != null
  },
  
  /**
   * Get length of array or string
   */
  async length({ value }) {
    return value?.length || 0
  }
}

export default util