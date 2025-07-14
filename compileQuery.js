/**
 * @fileoverview MicroQL Query Compilation
 * 
 * Compiles query configurations into an executable AST with all transformations,
 * wrapper applications, and dependency analysis done at compile time.
 */

import { inspect } from 'util'
import retrieve from './retrieve.js'

/**
 * Method syntax regex pattern
 */
const METHOD_REGEX = /^(\w+):(\w+)$/

/**
 * JSONPath dependency pattern for $.queryName references
 */
const DEP_REGEX = /\$\.(\w+)/

/**
 * Context reference pattern for @ symbols
 */
const AT_REGEX = /^@+/

/**
 * Generic utility to transform object properties asynchronously
 * @param {Object} obj - Object to transform
 * @param {Function} transform - Async transform function (value, key, context) => newValue
 * @param {*} context - Context to pass to transform function
 * @returns {Promise<Object>} Transformed object
 */
const transformObjectAsync = async (obj, transform, context) => {
  const result = {}
  for (const [key, value] of Object.entries(obj)) {
    result[key] = await transform(value, key, context)
  }
  return result
}

/**
 * Argument classification configuration
 */
const ARG_CATEGORIES = {
  reserved: ['timeout', 'retry', 'onError', 'ignoreErrors'],
  function: ['onError']
}

/**
 * Apply an array of wrapper functions to a base function
 * @param {Function} baseFunction - The base function to wrap
 * @param {Array} wrappers - Array of wrapper functions (applied in order)
 * @returns {Function} The composed function
 */
const applyWrappers = (baseFunction, wrappers) => {
  return wrappers.reduce((fn, wrapper) => wrapper(fn), baseFunction)
}

/**
 * Main compilation entry point
 * @param {Object} config - MicroQL configuration with services, queries, settings
 * @returns {Object} Compiled AST ready for execution
 */
export const compileQuery = (config) => {
  const ast = {
    queries: {},
    executionOrder: [],
    services: config.services || {},
    settings: config.settings || {},
    execution: {
      queryResults: new Map(),
      executing: new Map(),
      usedServices: new Set()
    }
  }
  
  // Phase 1: Add given as pre-resolved query if present
  if (config.given) {
    const givenNode = {
      type: 'resolved',
      reference: 'given',
      value: config.given,
      completed: true,
      dependencies: [],
      root: ast
    }
    
    // Add getQueryResult method
    givenNode.getQueryResult = async function(queryName) {
      const execution = this.root.execution
      
      // Check if result is already available
      if (execution.queryResults.has(queryName)) {
        return execution.queryResults.get(queryName)
      }
      
      // Check if query is currently executing and wait for it
      if (execution.executing.has(queryName)) {
        const result = await execution.executing.get(queryName)
        execution.queryResults.set(queryName, result)
        return result
      }
      
      throw new Error(`Query '${queryName}' has not been executed yet`)
    }
    
    ast.queries.given = givenNode
  }
  
  // Phase 2: Create base AST nodes for all queries
  for (const [queryName, queryDescriptor] of Object.entries(config.query || {})) {
    ast.queries[queryName] = compileQueryNode(queryName, queryDescriptor, config, null, ast)
  }
  
  // Phase 3: Resolve dependencies and determine execution order
  ast.executionOrder = resolveDependencies(ast.queries)
  
  return ast
}

/**
 * Compile individual query node
 */
const compileQueryNode = (queryName, descriptor, config, parentContextNode, ast) => {
  // Handle alias queries (string references)
  if (typeof descriptor === 'string') {
    const aliasNode = {
      type: 'alias',
      reference: queryName,
      target: descriptor,
      dependencies: [descriptor],
      root: ast
    }
    
    // Add getQueryResult method
    aliasNode.getQueryResult = async function(queryName) {
      const execution = this.root.execution
      
      // Check if result is already available
      if (execution.queryResults.has(queryName)) {
        return execution.queryResults.get(queryName)
      }
      
      // Check if query is currently executing and wait for it
      if (execution.executing.has(queryName)) {
        const result = await execution.executing.get(queryName)
        execution.queryResults.set(queryName, result)
        return result
      }
      
      throw new Error(`Query '${queryName}' has not been executed yet`)
    }
    
    return aliasNode
  }
  
  // Handle array descriptors
  if (Array.isArray(descriptor)) {
    // Check if this is a chain (array of arrays)
    if (descriptor.length > 0 && Array.isArray(descriptor[0])) {
      return compileChainNode(queryName, descriptor, config, parentContextNode, ast)
    } else {
      // Single service call
      return compileServiceNode(queryName, descriptor, config, parentContextNode, ast)
    }
  }
  
  throw new Error(`Invalid query descriptor for ${queryName}`)
}

/**
 * Compile chain node (array of service calls)
 */
const compileChainNode = (queryName, chainDescriptor, config, parentContextNode, ast) => {
  const node = {
    type: 'chain',
    reference: queryName,
    steps: [],
    dependencies: new Set(),
    parentContextNode,
    parent: null, // Will be set by calling context
    value: null,
    completed: false,
    root: ast
  }
  
  // Chain nodes have no current context - context getter should throw
  Object.defineProperty(node, 'context', {
    get() {
      throw new Error(`@ is not available at the chain level`)
    },
    configurable: true
  })
  
  // Mark that chain nodes don't have semantic context
  node.hasContext = false
  
  // Compile each step in the chain
  let previousStep = null
  for (const stepDescriptor of chainDescriptor) {
    const step = compileServiceNode(null, stepDescriptor, config, node, ast)
    
    // Set structural parent reference
    step.parent = node
    
    // Wire context for service nodes in chains
    if (previousStep) {
      // Service node in chain: context getter accesses previous step via AST
      Object.defineProperty(step, 'context', {
        get() {
          const myIndex = this.parent.steps.indexOf(this)
          if (myIndex === 0) {
            throw new Error(`@ is not available for the first step in a chain`)
          }
          const previousStep = this.parent.steps[myIndex - 1]
          if (!previousStep.completed) {
            throw new Error(`Previous step has not been executed yet - step ${myIndex} waiting for step ${myIndex - 1}`)
          }
          return previousStep.value
        },
        configurable: true
      })
      // Set parentContextNode to previous step (which has context), not the chain
      step.parentContextNode = previousStep
    } else {
      // First step in chain: context getter should throw (no previous step)
      Object.defineProperty(step, 'context', {
        get() {
          throw new Error(`@ is not available for the first step in a chain`)
        },
        configurable: true
      })
      // First step's parent should be the chain's parent (skipping chain node)
      step.parentContextNode = parentContextNode
    }
    
    // Mark that this node has semantic context
    step.hasContext = true
    
    // Collect dependencies from step
    if (step.dependencies) {
      step.dependencies.forEach(dep => node.dependencies.add(dep))
    }
    
    node.steps.push(step)
    previousStep = step
  }
  
  node.dependencies = Array.from(node.dependencies)
  
  // Add getQueryResult method for accessing query results with dependency coordination
  node.getQueryResult = async function(queryName) {
    const execution = this.root.execution
    
    // Check if result is already available
    if (execution.queryResults.has(queryName)) {
      return execution.queryResults.get(queryName)
    }
    
    // Check if query is currently executing and wait for it
    if (execution.executing.has(queryName)) {
      const result = await execution.executing.get(queryName)
      execution.queryResults.set(queryName, result)
      return result
    }
    
    throw new Error(`Query '${queryName}' has not been executed yet`)
  }
  
  return node
}

/**
 * Compile service node
 */
const compileServiceNode = (queryName, descriptor, config, parentContextNode, ast) => {
  const transformed = transformMethodSyntax(descriptor)
  const [serviceName, action, rawArgs = {}] = transformed.descriptor
  
  // Validate service exists at compile time - fail fast
  const service = config.services[serviceName]
  if (!service) {
    throw new Error(`Service '${serviceName}' not found`)
  }
  
  // Validate service type at compile time
  if (typeof service !== 'function' && (typeof service !== 'object' || service === null || Array.isArray(service))) {
    throw new Error(`Invalid service '${serviceName}': must be a function or object`)
  }
  
  // Validate method exists at compile time
  if (typeof service !== 'function' && !service[action]) {
    throw new Error(`Service method '${action}' not found`)
  }
  
  // Get service method for _argtypes
  const serviceMethod = typeof service === 'function' ? service : service[action]
  
  // Separate argument types
  const { staticArgs, dependentArgs, functionArgs, reservedArgs } = separateArguments(rawArgs, config, serviceMethod._argtypes, ast)
  
  // Extract dependencies from dependent args
  const dependencies = extractDependencies(dependentArgs)
  
  // Create the wrapped function with all wrappers applied
  const wrappedFunction = createWrappedFunction(
    serviceName,
    action,
    rawArgs,
    staticArgs,
    dependentArgs,
    functionArgs,
    reservedArgs,
    config,
    parentContextNode
  )
  
  const node = {
    type: 'service',
    reference: queryName,
    serviceName,
    action,
    wrappedFunction,
    staticArgs,
    dependentArgs,
    functionArgs,
    dependencies,
    parentContextNode,
    parent: null, // Will be set by calling context
    value: null,
    completed: false,
    root: ast
  }
  
  // Default: context is not defined for any node
  Object.defineProperty(node, 'context', {
    get() {
      throw new Error(`Context is not defined`)
    },
    configurable: true
  })
  
  // Add getQueryResult method for accessing query results with dependency coordination
  node.getQueryResult = async function(queryName) {
    const execution = this.root.execution
    
    // Check if result is already available
    if (execution.queryResults.has(queryName)) {
      return execution.queryResults.get(queryName)
    }
    
    // Check if query is currently executing and wait for it
    if (execution.executing.has(queryName)) {
      const result = await execution.executing.get(queryName)
      execution.queryResults.set(queryName, result)
      return result
    }
    
    throw new Error(`Query '${queryName}' has not been executed yet`)
  }
  
  // Mark that service nodes don't have semantic context by default
  node.hasContext = false
  
  return node
}

/**
 * Transform method syntax ['target', 'service:method', args] to standard form
 */
const transformMethodSyntax = (descriptor) => {
  if (!Array.isArray(descriptor) || descriptor.length < 2) {
    return { descriptor, hasOn: false }
  }
  
  const [target, serviceMethod, args = {}] = descriptor
  const match = typeof serviceMethod === 'string' && serviceMethod.match(METHOD_REGEX)
  
  if (!match) {
    return { descriptor, hasOn: false }
  }
  
  const [, serviceName, method] = match
  const newArgs = { ...args, on: target }
  
  return {
    descriptor: [serviceName, method, newArgs],
    hasOn: true
  }
}

/**
 * Compile function argument value based on type
 */
const compileFunctionArgument = (value, config, ast) => {
  if (Array.isArray(value) && value.length >= 2 && typeof value[0] === 'string') {
    // Service descriptor
    return compileServiceFunction(value, config, ast)
  } else if (typeof value === 'object' && !Array.isArray(value) && value !== null) {
    // Template syntax
    const templateDescriptor = ['util', 'template', value]
    return compileServiceFunction(templateDescriptor, config, ast)
  } else {
    // Not a compilable function
    return null
  }
}

/**
 * Separate arguments into different types for compile-time vs runtime resolution
 */
const separateArguments = (args, config, argtypes, ast) => {
  const staticArgs = {}
  const dependentArgs = {}
  const functionArgs = {}
  const reservedArgs = {}
  
  if (!args || typeof args !== 'object') {
    return { staticArgs: args, dependentArgs, functionArgs, reservedArgs }
  }
  
  for (const [key, value] of Object.entries(args)) {
    // Handle reserved wrapper arguments
    if (ARG_CATEGORIES.reserved.includes(key)) {
      reservedArgs[key] = value
      staticArgs[key] = value
    }
    
    // Check if this is a function argument (reserved or service-declared)
    if (ARG_CATEGORIES.function.includes(key)
      || argtypes?.[key]?.type === 'function') {
      functionArgs[key] = compileFunctionArgument(value, config, ast)
    }
    // Check for references
    else if (containsReferences(value)) {
      dependentArgs[key] = value
    } 
    // Everything else is static
    else {
      staticArgs[key] = value
    }
  }
  
  return { staticArgs, dependentArgs, functionArgs, reservedArgs }
}



/**
 * Compile service descriptor to function with context capture
 */
const compileServiceFunction = (descriptor, config, ast) => {
  const node = compileServiceNode(null, descriptor, config, null, ast)
  
  // Function/template nodes: override context getter - they get values directly from withArgs
  Object.defineProperty(node, 'context', {
    get() {
      throw new Error(`AST node context is not available in compiled function`)
    },
    configurable: true
  })
  
  // Return a function that executes the compiled node
  const compiledFunction = async (contextValue) => {
    // Create a temporary context function that returns the passed contextValue
    const contextFunction = () => contextValue
    
    // Create a new node with context getter for this execution
    const executionNode = Object.create(node)
    Object.defineProperty(executionNode, 'context', {
      get() { return contextValue }
    })
    // Execution node inherits root reference from base node
    
    // Bind the node with resolution context for execution
    const boundFunction = node.wrappedFunction.bind(executionNode)
    
    // Execute the wrapped function
    return await boundFunction()
  }
  
  // Store reference to the compiled node for nested function calls
  compiledFunction.__compiledNode = node
  
  return compiledFunction
}

/**
 * Check if value contains @ or $ references
 */
const containsReferences = (value) => {
  if (typeof value === 'string') {
    return AT_REGEX.test(value) || DEP_REGEX.test(value)
  }
  
  if (Array.isArray(value)) {
    return value.some(containsReferences)
  }
  
  if (value && typeof value === 'object') {
    return Object.values(value).some(containsReferences)
  }
  
  return false
}

/**
 * Extract dependencies from dependent arguments
 */
const extractDependencies = (dependentArgs) => {
  const deps = new Set()
  
  const extract = (value) => {
    if (typeof value === 'string') {
      const match = value.match(DEP_REGEX)
      if (match) {
        deps.add(match[1])
      }
    } else if (Array.isArray(value)) {
      value.forEach(extract)
    } else if (value && typeof value === 'object') {
      Object.values(value).forEach(extract)
    }
  }
  
  Object.values(dependentArgs).forEach(extract)
  return Array.from(deps)
}


/**
 * Create wrapped function with all wrappers applied at compile time
 */
const createWrappedFunction = (
  serviceName,
  action,
  rawArgs,
  staticArgs,
  dependentArgs,
  functionArgs,
  reservedArgs,
  config,
  parentContextNode
) => {
  const service = config.services[serviceName]
  
  // Create base function that calls the service (validation already done at compile time)
  let wrappedFunction = async function(resolvedArgs) {
    // Track service usage for tearDown
    if (this.root && this.root.execution) {
      this.root.execution.usedServices.add(serviceName)
    }
    
    if (typeof service === 'function') {
      return await service(action, resolvedArgs)
    } else {
      return await service[action](resolvedArgs)
    }
  }
  
  // Extract configuration values
  const timeoutMs = reservedArgs.timeout ?? 
    config.settings?.timeout?.[serviceName] ?? 
    config.settings?.timeout?.default
  const retryCount = reservedArgs.retry ?? config.settings?.retry?.default ?? 0
  
  // Build wrapper array in canonical order
  const wrappers = []
  
  // 1. withArgs - resolves @ and $ references
  wrappers.push(fn => withArgs(fn, staticArgs, dependentArgs, functionArgs))
  
  // 2. withGuard - debug logging
  if (config.settings?.debug) {
    wrappers.push(fn => withGuard(fn, serviceName, action, config.settings))
  }
  
  // 3. withTimeout
  if (timeoutMs && timeoutMs > 0) {
    wrappers.push(fn => withTimeout(fn, timeoutMs, serviceName, action))
  }
  
  // 4. withRetry
  if (retryCount > 0) {
    wrappers.push(fn => withRetry(fn, retryCount, serviceName, action))
  }
  
  // 5. withErrorHandling (outermost)
  if (reservedArgs.onError || reservedArgs.ignoreErrors) {
    wrappers.push(fn => withErrorHandling(fn, reservedArgs.onError, reservedArgs.ignoreErrors, serviceName, action, config, rawArgs))
  }
  
  // Apply all wrappers using functional composition
  wrappedFunction = applyWrappers(wrappedFunction, wrappers)
  
  // Return a function that can be called during execution
  return async function executeWrappedFunction() {
    // The 'this' context will be bound by the execution engine
    return await wrappedFunction.call(this)
  }
}

/**
 * Wrapper: Resolve @ and $ references at execution time
 */
const withArgs = (fn, staticArgs, dependentArgs, functionArgs) => {
  return async function() {
    const node = this
    
    // Resolve dependent arguments
    const resolvedDependent = {}
    for (const [key, value] of Object.entries(dependentArgs)) {
      resolvedDependent[key] = await resolveValue(value, node)
    }
    
    // Resolve function arguments
    const resolvedFunctions = {}
    for (const [key, func] of Object.entries(functionArgs)) {
      if (typeof func === 'function') {
        // For services that expect function arguments (like util.map), 
        // wrap the function to maintain context chain
        if (ARG_CATEGORIES.function.includes(key) || func.__compiledNode) {
          // Create a context-aware wrapper that creates virtual nodes for iteration
          resolvedFunctions[key] = async (itemValue) => {
            // Get the base compiled node
            const baseNode = func.__compiledNode
            
            if (baseNode) {
              // Create virtual node for this iteration using prototype chain
              const virtualNode = Object.create(baseNode)
              
              // Set up context getter to return iteration value
              Object.defineProperty(virtualNode, 'context', {
                get() { return itemValue },
                configurable: true
              })
              
              // Set up parent context getter to point to current executing node
              // CRITICAL: Use 'this' (the current executing node) as parent, 
              // which could be another virtual node from a parent iteration
              const currentNode = this
              
              // If the current node is a virtual node, we're in a nested iteration
              // and should chain to it. Otherwise use the base node.
              Object.defineProperty(virtualNode, 'parentContextNode', {
                get() { return currentNode }
              })
              
              // Add debugging flag and context marker
              virtualNode.isVirtual = true
              virtualNode.hasContext = true
              
              // Set root reference (virtual node inherits from parent)
              virtualNode.root = this.root
              
              // Add execute method for cleaner calling
              virtualNode.execute = () => virtualNode.wrappedFunction.call(virtualNode)
              
              // Execute using virtual node
              return await virtualNode.execute()
            } else {
              // Fallback for non-compiled functions (templates, etc.)
              return await func(itemValue)
            }
          }
        } else {
          // Call function with current context for other cases
          const contextValue = getContext(node, 0)  // @ = level 0
          // Templates and functions now have identical runtime signatures
          resolvedFunctions[key] = await func(contextValue)
        }
      }
    }
    
    // Combine all resolved arguments
    const resolvedArgs = {
      ...staticArgs,
      ...resolvedDependent,
      ...resolvedFunctions
    }
    
    // Auto-inject settings for services that expect them (like util.print)
    if (!resolvedArgs.settings && this.root?.settings) {
      resolvedArgs.settings = this.root.settings
    }
    
    return await fn.call(this, resolvedArgs)
  }
}

/**
 * Count @ symbols at start of string
 */
const countAtSymbols = (str) => {
  if (typeof str !== 'string') return 0
  const match = str.match(/^(@+)/)
  return match ? match[1].length : 0
}

/**
 * Get context at specified level using AST relationships
 * @param {Object} node - Current AST node
 * @param {number} level - Context level (0 = @, 1 = @@, 2 = @@@, etc.)
 * @param {string} path - Optional JSONPath for field access (e.g., '$.field')
 */
const getContext = (node, level, path) => {
  let current = node
  
  // Walk up the context chain
  for (let i = 0; i <= level; i++) {
    if (i === 0 && level === 0) {
      // @ = current context - use the node's context getter
      try {
        const value = current.context
        if (path) {
          return retrieve(path, value)
        }
        return value
      } catch (e) {
        throw new Error(`${'@'.repeat(level + 1)} not available - ${e.message}`)
      }
    } else if (i > 0) {
      // @@, @@@, etc. = walk up parent chain
      current = current.parentContextNode
      if (!current) {
        throw new Error(`${'@'.repeat(level + 1)} not available - context not deep enough (only ${i} levels available)`)
      }
    }
    // For i === 0 && level > 0, continue to next iteration to walk up
  }
  
  // For higher levels (@@, @@@, etc.), get the value from the parent node
  let value
  try {
    value = current.context
  } catch (e) {
    // If context getter fails, try using stored value
    if (current.value !== undefined) {
      value = current.value
    } else {
      throw new Error(`Context value not available for ${'@'.repeat(level + 1)}`)
    }
  }
  
  // Apply JSONPath if provided
  if (path) {
    return retrieve(path, value)
  }
  
  return value
}

/**
 * Resolve a value that may contain @ or $ references
 */
const resolveValue = async (value, node) => {
  if (typeof value === 'string') {
    // Handle @ references
    const atMatch = value.match(AT_REGEX)
    if (atMatch) {
      const atCount = countAtSymbols(value)
      const level = atCount - 1  // Convert to 0-based index
      const path = value.substring(atMatch[0].length)
      
      if (path) {
        // Handle field access like @.field or @@.field
        const jsonPath = path.startsWith('.') ? '$' + path : '$.' + path
        return getContext(node, level, jsonPath)
      } else {
        // Handle pure @ symbols
        return getContext(node, level)
      }
    }
    
    // Handle $ references
    const depMatch = value.match(DEP_REGEX)
    if (depMatch) {
      // Parse $.queryName.field notation
      if (node && node.getQueryResult) {
        const parts = value.substring(2).split('.')
        const queryName = parts[0]
        
        // Get the query result using the node's method
        const queryResult = await node.getQueryResult(queryName)
        
        if (parts.length === 1) {
          // Just $.queryName
          return queryResult
        } else {
          // $.queryName.field.subfield - use retrieve for field access
          const fieldPath = '$.' + parts.slice(1).join('.')
          return retrieve(fieldPath, queryResult)
        }
      }
      // Fallback - return as-is if no getQueryResult method
      return value
    }
    
    return value
  }
  
  if (Array.isArray(value)) {
    return Promise.all(value.map(v => resolveValue(v, node)))
  }
  
  if (value && typeof value === 'object') {
    return await transformObjectAsync(value, (val) => resolveValue(val, node), node)
  }
  
  return value
}

/**
 * Wrapper: Debug logging
 */
const withGuard = (fn, serviceName, action, settings) => {
  return async function(args) {
    const startTime = Date.now()
    
    if (settings.debug) {
      console.log(`[${serviceName}.${action}] Called with:`, inspect(args, settings.inspect || {}))
    }
    
    try {
      const result = await fn.call(this, args)
      
      if (settings.debug) {
        const duration = Date.now() - startTime
        console.log(`[${serviceName}.${action}] Completed in ${duration}ms:`, inspect(result, settings.inspect || {}))
      }
      
      return result
    } catch (error) {
      if (settings.debug) {
        const duration = Date.now() - startTime
        console.log(`[${serviceName}.${action}] Failed after ${duration}ms:`, error.message)
      }
      throw error
    }
  }
}

/**
 * Wrapper: Timeout
 */
const withTimeout = (fn, timeoutMs, serviceName, action) => {
  return async function(args) {
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Service '${serviceName}.${action}' timed out after ${timeoutMs}ms`))
      }, timeoutMs)
    })
    
    return Promise.race([fn.call(this, args), timeoutPromise])
  }
}

/**
 * Wrapper: Retry logic
 */
const withRetry = (fn, retryCount, serviceName, action) => {
  return async function(args) {
    let lastError
    
    for (let attempt = 1; attempt <= retryCount + 1; attempt++) {
      try {
        return await fn.call(this, args)
      } catch (error) {
        lastError = error
        
        if (attempt <= retryCount) {
          console.error(`Service '${serviceName}.${action}' failed (attempt ${attempt}/${retryCount + 1}), retrying...`)
        }
      }
    }
    
    throw lastError
  }
}

/**
 * Wrapper: Error handling
 */
const withErrorHandling = (fn, onErrorDescriptor, ignoreErrors, serviceName, action, config, rawArgs) => {
  return async function(resolvedArgs) {
    try {
      return await fn.call(this, resolvedArgs)
    } catch (error) {
      // Prepare complete args including defaults for error context
      const completeArgs = { ...rawArgs }
      
      // Add resolved timeout if applicable
      const timeoutMs = rawArgs.timeout ?? 
        config.settings?.timeout?.[serviceName] ?? 
        config.settings?.timeout?.default
      if (timeoutMs && timeoutMs > 0) {
        completeArgs.timeout = timeoutMs
      }
      
      // Add retry if applicable  
      const retryCount = rawArgs.retry ?? config.settings?.retry?.default ?? 0
      if (retryCount > 0) {
        completeArgs.retry = retryCount
      }
      
      // Prepare error context with complete args + query name
      const errorContext = {
        error: error.message,
        originalError: error,
        serviceName,
        action,
        args: completeArgs,
        queryName: this?.reference || 'unknown'
      }
      
      // Handle with onError if provided
      if (onErrorDescriptor) {
        try {
          // Compile the error handler
          const errorHandler = compileServiceFunction(onErrorDescriptor, config, this.root)
          const handlerResult = await errorHandler(errorContext)
          
          // If ignoreErrors is true, run handler for side effects but return null
          if (ignoreErrors) {
            return null
          }
          
          // Otherwise return the handler result
          return handlerResult
        } catch (handlerError) {
          // Error handler failed
          if (!ignoreErrors) {
            throw handlerError
          }
          return null
        }
      }
      
      // Ignore errors if requested
      if (ignoreErrors) {
        return null
      }
      
      // Re-throw original error
      throw error
    }
  }
}

/**
 * Resolve dependencies and determine execution order
 */
const resolveDependencies = (queries) => {
  const order = []
  const visited = new Set()
  const visiting = new Set()
  
  const visit = (queryName) => {
    if (visited.has(queryName)) return
    
    if (visiting.has(queryName)) {
      throw new Error(`Circular dependency detected involving query '${queryName}'`)
    }
    
    visiting.add(queryName)
    
    const query = queries[queryName]
    if (!query) {
      throw new Error(`Query '${queryName}' not found (referenced as dependency)`)
    }
    
    // Visit dependencies first
    if (query.dependencies) {
      for (const dep of query.dependencies) {
        visit(dep)
      }
    }
    
    visiting.delete(queryName)
    visited.add(queryName)
    order.push(queryName)
  }
  
  // Visit all queries
  for (const queryName of Object.keys(queries)) {
    visit(queryName)
  }
  
  return order
}
