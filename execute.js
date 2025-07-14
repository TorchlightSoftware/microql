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
  
  /**
   * Execute a single query by name
   */
  const executeQuery = async (queryName) => {
    const queryNode = ast.queries[queryName]
    if (!queryNode) {
      throw new Error(`Query '${queryName}' not found`)
    }
    
    // Return existing result if already completed
    if (queryNode.completed) {
      return queryNode.value
    }
    
    // Return existing promise if already executing
    if (queryNode.executing) {
      return queryNode.executing
    }
    
    // Create promise for this execution
    const promise = executeQueryNode(queryNode)
    
    // Track the promise on the node
    queryNode.executing = promise
    
    // Store result when complete
    const result = await promise
    queryNode.value = result
    queryNode.completed = true
    delete queryNode.executing // Clean up the promise
    
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
    let result = null
    
    // Find the first uncompleted step, or start from beginning
    let startIndex = 0
    for (let i = 0; i < chainNode.steps.length; i++) {
      if (chainNode.steps[i].completed) {
        result = chainNode.steps[i].value
        startIndex = i + 1
      } else {
        break
      }
    }
    
    // Execute remaining steps in sequence
    for (let i = startIndex; i < chainNode.steps.length; i++) {
      const step = chainNode.steps[i]
      
      // Execute the step (step has direct AST access)
      step.value = await step.wrappedFunction.call(step)
      step.completed = true
      result = step.value
    }
    
    return result
  }
  
  // Start all uncompleted queries in parallel - dependency resolution will coordinate automatically
  const uncompletedQueries = ast.executionOrder.filter(queryName => !ast.queries[queryName].completed)
  const allPromises = uncompletedQueries.map(queryName => executeQuery(queryName))
  await Promise.all(allPromises)
  
  // Return selected query or all results
  if (select) {
    if (Array.isArray(select)) {
      // Select multiple queries
      const selectedResults = {}
      for (const queryName of select) {
        const query = ast.queries[queryName]
        if (!query) {
          throw new Error(`Query '${queryName}' not found`)
        }
        selectedResults[queryName] = query.value
      }
      return selectedResults
    } else {
      // Select single query
      const query = ast.queries[select]
      if (!query) {
        throw new Error(`Query '${select}' not found`)
      }
      return query.value
    }
  }
  
  // Convert AST results to object for return
  const results = {}
  for (const [queryName, queryNode] of Object.entries(ast.queries)) {
    if (queryNode.completed) {
      results[queryName] = queryNode.value
    }
  }
  return results
}
