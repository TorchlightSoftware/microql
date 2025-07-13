/**
 * @fileoverview MicroQL Query Compilation
 * 
 * Compiles query configurations into an executable AST with all transformations,
 * wrapper applications, and dependency analysis done at compile time.
 */

import { inspect } from 'util'

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
 * Main compilation entry point
 * @param {Object} config - MicroQL configuration with services, queries, settings
 * @returns {Object} Compiled AST ready for execution
 */
export const compileQuery = (config) => {
  const ast = {
    queries: {},
    executionOrder: [],
    given: config.given || {},
    services: config.services || {},
    settings: config.settings || {}
  }
  
  // Phase 1: Create base AST nodes for all queries
  for (const [queryName, queryDescriptor] of Object.entries(config.query || {})) {
    ast.queries[queryName] = compileQueryNode(queryName, queryDescriptor, config, null)
  }
  
  // Phase 2: Resolve dependencies and determine execution order
  ast.executionOrder = resolveDependencies(ast.queries)
  
  return ast
}

/**
 * Compile individual query node
 */
const compileQueryNode = (queryName, descriptor, config, parentContextNode) => {
  // Handle alias queries (string references)
  if (typeof descriptor === 'string') {
    return {
      type: 'alias',
      reference: queryName,
      target: descriptor,
      dependencies: [descriptor]
    }
  }
  
  // Handle array descriptors
  if (Array.isArray(descriptor)) {
    // Check if this is a chain (array of arrays)
    if (descriptor.length > 0 && Array.isArray(descriptor[0])) {
      return compileChainNode(queryName, descriptor, config, parentContextNode)
    } else {
      // Single service call
      return compileServiceNode(queryName, descriptor, config, parentContextNode)
    }
  }
  
  throw new Error(`Invalid query descriptor for ${queryName}`)
}

/**
 * Compile chain node (array of service calls)
 */
const compileChainNode = (queryName, chainDescriptor, config, parentContextNode) => {
  const node = {
    type: 'chain',
    reference: queryName,
    steps: [],
    dependencies: new Set(),
    parentContextNode,
    value: null
  }
  
  // Wire up context getter
  node.context = createContextGetter(node)
  
  // Compile each step in the chain
  let previousStep = null
  for (const stepDescriptor of chainDescriptor) {
    const step = compileServiceNode(null, stepDescriptor, config, node)
    
    // Wire context to previous step or parent
    if (previousStep) {
      step.contextSource = previousStep
    } else if (parentContextNode) {
      step.contextSource = parentContextNode
    }
    
    // Collect dependencies from step
    if (step.dependencies) {
      step.dependencies.forEach(dep => node.dependencies.add(dep))
    }
    
    node.steps.push(step)
    previousStep = step
  }
  
  node.dependencies = Array.from(node.dependencies)
  return node
}

/**
 * Compile service node
 */
const compileServiceNode = (queryName, descriptor, config, parentContextNode) => {
  const transformed = transformMethodSyntax(descriptor)
  const [serviceName, action, rawArgs = {}] = transformed.descriptor
  
  // Validate service exists at compile time - fail fast
  const service = config.services[serviceName]
  if (!service) {
    throw new Error(`Service '${serviceName}' not found`)
  }
  
  // Validate method exists at compile time
  if (typeof service !== 'function' && !service[action]) {
    throw new Error(`Service method '${action}' not found`)
  }
  
  // Separate argument types
  const { staticArgs, dependentArgs, functionArgs, specialArgs } = separateArguments(rawArgs, config)
  
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
    specialArgs,
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
    contextSource: null, // Set by parent chain if applicable
    value: null
  }
  
  // Wire up context getter
  node.context = createContextGetter(node)
  
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
 * Separate arguments into different types for compile-time vs runtime resolution
 */
const separateArguments = (args, config) => {
  const staticArgs = {}
  const dependentArgs = {}
  const functionArgs = {}
  const specialArgs = {}
  
  if (!args || typeof args !== 'object') {
    return { staticArgs: args, dependentArgs, functionArgs, specialArgs }
  }
  
  for (const [key, value] of Object.entries(args)) {
    // Reserved arguments
    if (['timeout', 'retry', 'onError', 'ignoreErrors'].includes(key)) {
      specialArgs[key] = value
      continue
    }
    
    // Check if value contains @ or $ references
    if (containsReferences(value)) {
      dependentArgs[key] = value
    } else if (typeof value === 'function') {
      functionArgs[key] = value
    } else if (Array.isArray(value) && value.length >= 2 && typeof value[0] === 'string') {
      // Might be a service descriptor for compilation
      try {
        const compiledFunction = compileServiceFunction(value, config)
        functionArgs[key] = compiledFunction
      } catch (e) {
        // Not a valid service descriptor, treat as static
        staticArgs[key] = value
      }
    } else {
      staticArgs[key] = value
    }
  }
  
  return { staticArgs, dependentArgs, functionArgs, specialArgs }
}

/**
 * Compile service descriptor to function
 */
const compileServiceFunction = (descriptor, config) => {
  const node = compileServiceNode(null, descriptor, config, null)
  
  // Return a function that executes the compiled node
  return async (contextValue) => {
    // Create a temporary context node
    const tempContextNode = {
      value: Promise.resolve(contextValue),
      context: () => contextValue
    }
    
    node.contextSource = tempContextNode
    
    // Bind the node with resolution context for execution
    const boundFunction = node.wrappedFunction.bind({
      ...node,
      resolutionContext: { 
        queryResults: new Map(),
        inputData: contextValue
      }
    })
    
    // Execute the wrapped function
    return await boundFunction()
  }
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
 * Create a context getter for @ resolution
 */
const createContextGetter = (node) => {
  return function() {
    // Runtime resolution - check this (the bound execution context)
    if (this && this.contextSource && this.contextSource.context) {
      // Use the context function from stepContext
      return this.contextSource.context()
    }
    
    // For service nodes in a chain, use contextSource
    if (node.contextSource && node.contextSource.context) {
      return node.contextSource.context()
    }
    
    // For chain nodes or top-level services, context not available
    throw new Error(`@ is not available at the query level`)
  }
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
  specialArgs,
  config,
  parentContextNode
) => {
  const service = config.services[serviceName]
  
  // Create base function that calls the service (validation already done at compile time)
  let wrappedFunction = async (resolvedArgs) => {
    if (typeof service === 'function') {
      return await service(action, resolvedArgs)
    } else {
      return await service[action](resolvedArgs)
    }
  }
  
  // Apply wrappers in canonical order
  
  // 1. withArgs - resolves @ and $ references
  wrappedFunction = withArgs(wrappedFunction, staticArgs, dependentArgs, functionArgs)
  
  // 2. withGuard - debug logging
  if (config.settings?.debug) {
    wrappedFunction = withGuard(wrappedFunction, serviceName, action, config.settings)
  }
  
  // 3. withTimeout
  const timeoutMs = specialArgs.timeout ?? 
    config.settings?.timeout?.[serviceName] ?? 
    config.settings?.timeout?.default
    
  if (timeoutMs && timeoutMs > 0) {
    wrappedFunction = withTimeout(wrappedFunction, timeoutMs, serviceName, action)
  }
  
  // 4. withRetry
  const retryCount = specialArgs.retry ?? config.settings?.retry?.default ?? 0
  if (retryCount > 0) {
    wrappedFunction = withRetry(wrappedFunction, retryCount, serviceName, action)
  }
  
  // 5. withErrorHandling (outermost)
  if (specialArgs.onError || specialArgs.ignoreErrors) {
    wrappedFunction = withErrorHandling(
      wrappedFunction,
      specialArgs.onError,
      specialArgs.ignoreErrors,
      serviceName,
      action,
      config
    )
  }
  
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
        // Call function with current context
        const contextValue = await resolveContextValue(node)
        resolvedFunctions[key] = await func(contextValue)
      }
    }
    
    // Combine all resolved arguments
    const resolvedArgs = {
      ...staticArgs,
      ...resolvedDependent,
      ...resolvedFunctions
    }
    
    return await fn.call(this, resolvedArgs)
  }
}

/**
 * Resolve a value that may contain @ or $ references
 */
const resolveValue = async (value, node) => {
  if (typeof value === 'string') {
    // Handle @ references
    const atMatch = value.match(AT_REGEX)
    if (atMatch) {
      const contextValue = await resolveContextValue(node)
      const path = value.substring(atMatch[0].length)
      
      if (path) {
        // Access nested property
        return getNestedProperty(contextValue, path)
      }
      return contextValue
    }
    
    // Handle $ references
    const depMatch = value.match(DEP_REGEX)
    if (depMatch) {
      // Resolve through the resolution context
      if (node && node.resolutionContext && global.__microqlResolver) {
        return global.__microqlResolver(value)
      }
      // Try direct resolution if we have the global resolver
      if (global.__microqlResolver) {
        return global.__microqlResolver(value)
      }
      // Fallback - return as-is
      return value
    }
    
    return value
  }
  
  if (Array.isArray(value)) {
    return Promise.all(value.map(v => resolveValue(v, node)))
  }
  
  if (value && typeof value === 'object') {
    const resolved = {}
    for (const [key, val] of Object.entries(value)) {
      resolved[key] = await resolveValue(val, node)
    }
    return resolved
  }
  
  return value
}

/**
 * Resolve context value for @ references
 */
const resolveContextValue = async (node) => {
  try {
    // If we have a context getter, use it with the node as context
    if (node.context) {
      const result = node.context.call(node)
      return result // Don't await - the context getter returns the value directly
    }
    
    // If we have contextSource, use its value
    if (node.contextSource) {
      return await node.contextSource.value
    }
    
    throw new Error('No context available')
  } catch (error) {
    throw new Error(`@ is not available at this level`)
  }
}

/**
 * Get nested property from object
 */
const getNestedProperty = (obj, path) => {
  // Remove leading dot if present
  const cleanPath = path.startsWith('.') ? path.slice(1) : path
  
  if (!cleanPath) return obj
  
  const parts = cleanPath.split('.')
  let current = obj
  
  for (const part of parts) {
    if (current == null) return undefined
    current = current[part]
  }
  
  return current
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
const withErrorHandling = (fn, onErrorDescriptor, ignoreErrors, serviceName, action, config) => {
  return async function(args) {
    try {
      return await fn.call(this, args)
    } catch (error) {
      // Prepare error context
      const errorContext = {
        error: error.message,
        originalError: error,
        serviceName,
        action,
        args
      }
      
      // Handle with onError if provided
      if (onErrorDescriptor) {
        try {
          // Compile the error handler
          const errorHandler = compileServiceFunction(onErrorDescriptor, config)
          return await errorHandler(errorContext)
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
      // Special case: 'given' is not a query but input data
      if (queryName === 'given') {
        visiting.delete(queryName)
        return
      }
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