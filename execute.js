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
  // If given is provided at execution time, update the given query
  if (given !== undefined && ast.queries.given) {
    ast.queries.given.value = given
  }
  
  // Use AST's execution state
  const { queryResults, executing } = ast.execution
  
  // Pre-populate resolved queries (like given) in queryResults
  for (const [queryName, queryNode] of Object.entries(ast.queries)) {
    if (queryNode.type === 'resolved') {
      queryResults.set(queryName, queryNode.value)
    }
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
    const promise = executeQueryNode(queryNode)
    
    // Track the promise
    executing.set(queryName, promise)
    
    // Store result when complete
    const result = await promise
    queryNode.value = result        // Store actual value, not promise
    queryNode.completed = true
    queryResults.set(queryName, result)
    
    return result
  }
  
  /**
   * Execute a query node (handles different node types)
   */
  const executeQueryNode = async (node) => {
    switch (node.type) {
      case 'resolved':
        // Pre-resolved queries (like given) - return stored value
        return node.value
        
      case 'alias':
        // Execute the target query
        return await executeQuery(node.target)
        
      case 'service':
        // Execute the wrapped function (node has direct AST access)
        return await node.wrappedFunction.call(node)
        
      case 'chain':
        return await executeChainNode(node)
        
      default:
        throw new Error(`Unknown node type: ${node.type}`)
    }
  }
  
  /**
   * Execute a chain node
   */
  const executeChainNode = async (chainNode) => {
    let result = null // Start with null
    
    // Execute each step in sequence
    for (let i = 0; i < chainNode.steps.length; i++) {
      const step = chainNode.steps[i]
      
      // Execute the step (step has direct AST access)
      step.value = await step.wrappedFunction.call(step)
      step.completed = true
      result = step.value
    }
    
    return result
  }
  
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
}

