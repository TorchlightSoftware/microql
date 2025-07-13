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
  
  // Validate service type at compile time
  if (typeof service !== 'function' && (typeof service !== 'object' || service === null || Array.isArray(service))) {
    throw new Error(`Invalid service '${serviceName}': must be a function or object`)
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
    
    // Check if this looks like a service descriptor first
    if (Array.isArray(value) && value.length >= 2 && typeof value[0] === 'string') {
      // Try to compile as service descriptor
      try {
        const compiledFunction = compileServiceFunction(value, config)
        functionArgs[key] = compiledFunction
      } catch (e) {
        // Not a valid service descriptor, check for references
        if (containsReferences(value)) {
          dependentArgs[key] = value
        } else {
          staticArgs[key] = value
        }
      }
    } else if (typeof value === 'function') {
      functionArgs[key] = value
    } else if (containsReferences(value)) {
      // For template-like arguments (objects/arrays with @ symbols), 
      // create a function that resolves @ symbols at execution time
      if (['template', 'predicate', 'condition'].includes(key) && typeof value === 'object') {
        functionArgs[key] = createTemplateFunction(value)
      } else {
        dependentArgs[key] = value
      }
    } else {
      staticArgs[key] = value
    }
  }
  
  return { staticArgs, dependentArgs, functionArgs, specialArgs }
}

/**
 * Create a template function that resolves @ symbols at execution time
 */
const createTemplateFunction = (template) => {
  return async (contextValue, parentContext = null) => {
    // Create a temporary context node for @ resolution that matches getContext expectations
    const contextSource = {
      value: Promise.resolve(contextValue),
      context: () => contextValue
    }
    
    const tempContextNode = {
      contextSource: contextSource,
      parentContextNode: parentContext
    }
    
    // Resolve all @ symbols in the template using the current context
    return await resolveTemplate(template, tempContextNode)
  }
}

/**
 * Recursively resolve @ symbols in a template object/array
 */
const resolveTemplate = async (template, contextNode) => {
  if (typeof template === 'string') {
    // Handle @ references
    const atMatch = template.match(AT_REGEX)
    if (atMatch) {
      const atCount = countAtSymbols(template)
      const level = atCount - 1  // Convert to 0-based index
      const path = template.substring(atMatch[0].length)
      
      if (path) {
        // Handle field access like @.field or @@.field
        const jsonPath = path.startsWith('.') ? '$' + path : '$.' + path
        return getContext(contextNode, level, jsonPath)
      } else {
        // Handle pure @ symbols
        return getContext(contextNode, level)
      }
    }
    return template
  }
  
  if (Array.isArray(template)) {
    return Promise.all(template.map(item => resolveTemplate(item, contextNode)))
  }
  
  if (template && typeof template === 'object') {
    const resolved = {}
    for (const [key, value] of Object.entries(template)) {
      resolved[key] = await resolveTemplate(value, contextNode)
    }
    return resolved
  }
  
  return template
}

/**
 * Compile service descriptor to function with context capture
 */
const compileServiceFunction = (descriptor, config) => {
  const node = compileServiceNode(null, descriptor, config, null)
  
  // Return a function that executes the compiled node
  return async (contextValue, parentContext = null) => {
    // Create a temporary context node
    const tempContextNode = {
      value: Promise.resolve(contextValue),
      context: () => contextValue
    }
    
    node.contextSource = tempContextNode
    node.parentContextNode = parentContext  // Use provided parent context
    
    // Bind the node with resolution context for execution
    const boundFunction = node.wrappedFunction.bind({
      ...node,
      contextSource: tempContextNode,
      parentContextNode: parentContext,
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
      config,
      rawArgs  // Pass original args for error context
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
        // For services that expect function arguments (like util.map), 
        // wrap the function to maintain context chain
        if (['fn', 'template', 'predicate', 'mapFunction', 'filterFunction'].includes(key)) {
          // Create a context-aware wrapper that captures the current execution context
          resolvedFunctions[key] = async (itemValue) => {
            // For template functions, we need to set up the context chain properly
            // The itemValue becomes the current context (@)
            // The service's context (if any) becomes the parent context (@@)
            
            let parentContextNode = null
            
            // Try to create a parent context node from the service's context
            try {
              let parentContextValue = null
              if (node.context && typeof node.context === 'function') {
                parentContextValue = node.context()
              } else if (node.contextSource && node.contextSource.context) {
                parentContextValue = node.contextSource.context()
              }
              
              if (parentContextValue !== null) {
                parentContextNode = {
                  value: Promise.resolve(parentContextValue),
                  context: () => parentContextValue,
                  parentContextNode: node.parentContextNode
                }
              }
            } catch (e) {
              // If context is not available, parent will be null
            }
            
            return await func(itemValue, parentContextNode)
          }
        } else {
          // Call function with current context for other cases
          const contextValue = getContext(node, 0)  // @ = level 0
          // Pass parent context for compiled service functions
          resolvedFunctions[key] = await func(contextValue, node)
        }
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
    if (i === 0) {
      // @ = current context from contextSource
      current = current.contextSource
    } else {
      // @@, @@@, etc. = walk up parent chain
      current = current.parentContextNode
    }
    
    if (!current) {
      throw new Error(`${'@'.repeat(level + 1)} not available - context not deep enough (only ${i} levels available)`)
    }
  }
  
  // Get the actual value
  let value
  if (current.context && typeof current.context === 'function') {
    value = current.context()
  } else if (current.value !== undefined) {
    value = current.value
  } else {
    throw new Error(`Context value not available for ${'@'.repeat(level + 1)}`)
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
      // Resolve through the resolution context
      if (node && node.resolutionContext && global.__microqlResolver) {
        return await global.__microqlResolver(value)
      }
      // Try direct resolution if we have the global resolver
      if (global.__microqlResolver) {
        return await global.__microqlResolver(value)
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

// resolveContextValue removed - replaced with getContext helper

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
          const errorHandler = compileServiceFunction(onErrorDescriptor, config)
          const handlerResult = await errorHandler(errorContext, this)
          
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