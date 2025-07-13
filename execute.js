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
  
  // Track query results for $ references
  const queryResults = new Map()
  
  // Track executing promises to avoid duplicate execution
  const executing = new Map()
  
  // Pre-populate resolved queries (like given) in queryResults
  for (const [queryName, queryNode] of Object.entries(ast.queries)) {
    if (queryNode.type === 'resolved') {
      queryResults.set(queryName, queryNode.value)
    }
  }
  
  // Create context for $ resolution
  const resolutionContext = {
    queryResults,
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
    queryNode.completed = true
    queryResults.set(queryName, result)
    
    return result
  }
  
  /**
   * Execute a query node (handles different node types)
   */
  const executeQueryNode = async (node, context) => {
    switch (node.type) {
      case 'resolved':
        // Pre-resolved queries (like given) - return stored value
        return node.value
        
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
    let result = null // Start with null
    
    // Execute each step in sequence
    for (let i = 0; i < chainNode.steps.length; i++) {
      const step = chainNode.steps[i]
      
      // Context is now set up at compile time as getter, no runtime override needed
      
      // Execute the step with updated context (preserve getters)
      step.resolutionContext = context
      const boundFunction = step.wrappedFunction.bind(step)
      
      step.value = await boundFunction()
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

