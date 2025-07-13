/**
 * @fileoverview MicroQL AST Execution Engine
 * 
 * Simple traversal and execution of pre-compiled AST nodes.
 * All compilation, transformation, and wrapper application happens at compile time.
 */

/**
 * Execute a compiled AST
 * @param {Object} ast - Compiled AST from compileQuery
 * @param {Object} given - Input data (can override ast.given)
 * @param {string} select - Optional query to select as result
 * @returns {*} Query results
 */
export const executeAST = async (ast, given, select) => {
  // Use provided given or fall back to AST's given
  const inputData = given !== undefined ? given : ast.given
  
  // Track query results for $ references
  const queryResults = new Map()
  
  // Track executing promises to avoid duplicate execution
  const executing = new Map()
  
  // Create context for $ resolution
  const resolutionContext = {
    queryResults,
    inputData,
    executing,
    settings: ast.settings
  }
  
  /**
   * Execute a single query by name
   */
  const executeQuery = async (queryName) => {
    // Return existing promise if already executing
    if (executing.has(queryName)) {
      return executing.get(queryName)
    }
    
    const queryNode = ast.queries[queryName]
    if (!queryNode) {
      throw new Error(`Query '${queryName}' not found`)
    }
    
    // Create promise for this execution
    const promise = executeQueryNode(queryNode, resolutionContext)
    
    // Track the promise
    executing.set(queryName, promise)
    
    // Store result when complete
    const result = await promise
    queryNode.value = result        // Store actual value, not promise
    queryResults.set(queryName, result)
    
    return result
  }
  
  /**
   * Execute a query node (handles different node types)
   */
  const executeQueryNode = async (node, context) => {
    switch (node.type) {
      case 'alias':
        // Execute the target query
        return await executeQuery(node.target)
        
      case 'service':
        // Bind the resolution context and execute
        const boundFunction = node.wrappedFunction.bind({
          ...node,
          resolutionContext: context
        })
        return await boundFunction()
        
      case 'chain':
        return await executeChainNode(node, context)
        
      default:
        throw new Error(`Unknown node type: ${node.type}`)
    }
  }
  
  /**
   * Execute a chain node
   */
  const executeChainNode = async (chainNode, context) => {
    let result = context.inputData // Start with input data
    
    // Execute each step in sequence
    for (let i = 0; i < chainNode.steps.length; i++) {
      const step = chainNode.steps[i]
      
      // Update context function to return the current result
      if (i > 0) {
        // For steps after the first, update context to return previous result
        step.context = () => result
      }
      
      // Execute the step with updated context
      const boundFunction = step.wrappedFunction.bind({
        ...step,
        resolutionContext: context
      })
      
      step.value = boundFunction()
      result = await step.value
    }
    
    return result
  }
  
  // Override the global resolver for $ references
  const originalResolver = global.__microqlResolver
  global.__microqlResolver = createDollarResolver(resolutionContext)
  
  try {
    // Start all queries in parallel - dependency resolution will coordinate automatically
    const allPromises = ast.executionOrder.map(queryName => executeQuery(queryName))
    await Promise.all(allPromises)
    
    // Return selected query or all results
    if (select) {
      if (Array.isArray(select)) {
        // Select multiple queries
        const selectedResults = {}
        for (const queryName of select) {
          if (!queryResults.has(queryName)) {
            throw new Error(`Query '${queryName}' not found`)
          }
          selectedResults[queryName] = queryResults.get(queryName)
        }
        return selectedResults
      } else {
        // Select single query
        if (!queryResults.has(select)) {
          throw new Error(`Query '${select}' not found`)
        }
        return queryResults.get(select)
      }
    }
    
    // Convert Map to object for return
    const results = {}
    for (const [key, value] of queryResults) {
      results[key] = value
    }
    return results
    
  } finally {
    // Restore original resolver
    global.__microqlResolver = originalResolver
  }
}

/**
 * Create a resolver for $ references
 */
const createDollarResolver = (context) => {
  return async (path) => {
    // Parse $.queryName.field notation
    if (!path.startsWith('$.')) {
      return path
    }
    
    const parts = path.substring(2).split('.')
    const queryName = parts[0]
    
    // Special case for $.given
    if (queryName === 'given') {
      let value = context.inputData
      
      // Navigate nested path
      for (let i = 1; i < parts.length; i++) {
        if (value == null) return undefined
        value = value[parts[i]]
      }
      
      return value
    }
    
    // Check if query result is available
    if (!context.queryResults.has(queryName)) {
      // Check if query is currently executing and wait for it
      if (context.executing && context.executing.has(queryName)) {
        const result = await context.executing.get(queryName)
        context.queryResults.set(queryName, result)
      } else {
        throw new Error(`Query '${queryName}' has not been executed yet (referenced as '${path}')`)
      }
    }
    
    let value = context.queryResults.get(queryName)
    
    // Navigate nested path
    for (let i = 1; i < parts.length; i++) {
      if (value == null) return undefined
      value = value[parts[i]]
    }
    
    return value
  }
}

// Temporary integration with withArgs wrapper
// This will be called during execution to resolve $ references
export const resolveDollarReference = (value) => {
  if (typeof value === 'string' && value.startsWith('$.')) {
    const resolver = global.__microqlResolver
    if (resolver) {
      return resolver(value)
    }
  }
  return value
}