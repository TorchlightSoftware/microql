import retrieve from './retrieve.js'

/**
 * Resolve @ symbols in template values (now uses MicroQL's context system)
 */
const resolveTemplate = (template, currentItem) => {
  const result = {}
  for (const [key, path] of Object.entries(template)) {
    if (typeof path === 'string') {
      if (path === '@') {
        result[key] = currentItem
      } else if (path.startsWith('@.')) {
        const fieldPath = path.slice(2) // Remove '@.'
        const jsonPath = '$.' + fieldPath
        result[key] = retrieve(jsonPath, currentItem)
      } else if (path.startsWith('$.')) {
        result[key] = retrieve(path, currentItem)
      } else {
        result[key] = path
      }
    } else {
      result[key] = path
    }
  }
  return result
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
      return items.map(item => resolveTemplate(template, item))
    }
    
    // Function-based mapping - fn is now a compiled function from MicroQL
    if (fn && typeof fn === 'function') {
      const results = await Promise.all(
        items.map(item => fn(item))
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
    
    if (!predicate || typeof predicate !== 'function') {
      throw new Error('Predicate function is required for filter operation')
    }
    
    const results = await Promise.all(
      items.map(async item => {
        const keep = await predicate(item)
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
    
    if (!fn || typeof fn !== 'function') {
      throw new Error('Function is required for flatMap operation')
    }
    
    const results = await Promise.all(
      items.map(item => fn(item))
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
    } else if (typeof test === 'function') {
      // Compiled function - call with context
      testResult = await test(_context)
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

// Parameter metadata for MicroQL function compilation
util.map._params = {
  fn: { type: 'function' },
  template: { type: 'template' }  // Templates also need @ resolution
}

util.filter._params = {
  predicate: { type: 'function' }
}

util.flatMap._params = {
  fn: { type: 'function' }
}

util.when._params = {
  test: { type: 'function' }  // Test can be a service call
}

export default util