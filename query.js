/**
 * @fileoverview MicroQL query execution engine
 * 
 * Core module that orchestrates service execution with sophisticated context management,
 * method syntax transformation, and parallel task execution. Supports complex nested
 * data transformations with @ symbol context chaining.
 * 
 * Key features:
 * - Promise-based async service orchestration
 * - Context stack for nested @ symbol resolution (@, @@, @@@)
 * - Method syntax sugar: ['@.data', 'service:method', args]
 * - Automatic service object wrapping
 * - Comprehensive error context for debugging
 * - Parallel execution with dependency management
 */

import retrieve from './retrieve.js'

/** @type {RegExp} JSONPath dependency pattern for $.taskName references */
const DEP_REGEX = /\$\.(\w+)/

/** @type {RegExp} Context reference pattern for @ symbols */
const AT_REGEX = /^@+/

/**
 * Wrap a promise with a timeout for service execution
 * @param {Promise} promise - The promise to wrap
 * @param {number} timeoutMs - Timeout in milliseconds
 * @param {string} serviceName - Service name for error context
 * @param {string} action - Action name for error context
 * @returns {Promise} Promise that rejects if timeout is exceeded
 */
const withTimeout = (promise, timeoutMs, serviceName, action) => {
  if (!timeoutMs || timeoutMs <= 0) {
    return promise
  }
  
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Service '${serviceName}.${action}' timed out after ${timeoutMs}ms`))
      }, timeoutMs)
    })
  ])
}

/**
 * Auto-wrap service objects to make them compatible with function-based services
 * Converts object-based services { action1() {}, action2() {} } to function-based
 * services that can be called as service(action, args)
 * 
 * @param {Object} serviceObj - Service object with method implementations
 * @returns {Function} Wrapped service function with _originalService metadata
 */
const wrapServiceObject = (serviceObj) => {
  const wrapper = async (action, args) => {
    if (typeof serviceObj[action] !== 'function') {
      throw new Error(`Service method '${action}' not found`)
    }
    return await serviceObj[action](args)
  }
  
  // Preserve metadata from original service object
  wrapper._originalService = serviceObj
  
  return wrapper
}

/**
 * Prepare services by auto-wrapping objects and validating functions
 * Ensures all services can be called uniformly as async functions
 * 
 * @param {Object} services - Raw services object from query config
 * @returns {Object} Prepared services with consistent function interface
 * @throws {Error} If service is invalid type
 */
const prepareServices = (services) => {
  const prepared = {}
  for (const [name, service] of Object.entries(services)) {
    if (typeof service === 'function') {
      prepared[name] = service
    } else if (typeof service === 'object' && service !== null) {
      prepared[name] = wrapServiceObject(service)
    } else {
      throw new Error(`Invalid service '${name}': must be function or object`)
    }
  }
  return prepared
}

/**
 * Parse method syntax: ['@data', 'service:method', {...}] or ['$.path', 'service:method', {...}]
 */
/**
 * Transform method syntax to regular service call syntax
 * Core normalization function that enables elegant method syntax sugar
 * 
 * @example
 * // Input: Method syntax
 * ['@.departments', 'util:flatMap', { fn: [...] }]
 * 
 * // Output: Regular syntax  
 * ['util', 'flatMap', { on: '@.departments', fn: [...] }]
 * 
 * @param {Array} descriptor - Service descriptor array [dataSource, method, args]
 * @returns {Object|null} Transformation result with serviceName, action, dataSource and transformedDescriptor, or null if not method syntax
 */
const transformMethodSyntax = (descriptor) => {
  if (!Array.isArray(descriptor) || descriptor.length !== 3) {
    return null
  }
  
  const [dataSource, methodName, args] = descriptor
  
  // Check if it's method syntax (starts with @ or $.)
  if (typeof dataSource !== 'string' || (!AT_REGEX.test(dataSource) && !dataSource.startsWith('$.'))) {
    return null
  }
  
  // Parse service:method notation
  if (typeof methodName !== 'string' || !methodName.includes(':')) {
    return null
  }
  
  const [serviceName, action] = methodName.split(':')
  
  return {
    serviceName,
    action, 
    dataSource,
    transformedDescriptor: [serviceName, action, { on: dataSource, ...args }]
  }
}

/**
 * Parse and validate method syntax for task-level execution
 * Uses transformMethodSyntax and adds validation against methods whitelist
 * 
 * @param {Array} descriptor - Service descriptor to parse
 * @param {Array} methods - Array of service names allowed for method syntax
 * @returns {Object|null} Parsed method call with serviceName, action, dataSource, args or null
 */
const parseMethodCall = (descriptor, methods) => {
  const transformed = transformMethodSyntax(descriptor)
  if (!transformed) {
    return null
  }
  
  // Verify service is in methods array
  if (!methods.includes(transformed.serviceName)) {
    return null
  }
  
  return {
    serviceName: transformed.serviceName,
    action: transformed.action,
    dataSource: transformed.dataSource,
    args: { on: transformed.dataSource, ...descriptor[2] }
  }
}

/**
 * Check if a value contains @ symbols that need function compilation
 * Used to detect when service descriptors need to be compiled into functions
 * 
 * @param {*} value - Value to check (typically service descriptor array)
 * @returns {boolean} True if value contains @ symbols requiring compilation
 */
const containsAtSymbols = (value) => {
  if (typeof value === 'string' && AT_REGEX.test(value)) {
    return true
  }
  if (Array.isArray(value)) {
    return value.some(containsAtSymbols)
  }
  if (typeof value === 'object' && value !== null) {
    return Object.values(value).some(containsAtSymbols)
  }
  return false
}

/**
 * Count the number of @ symbols at the start of a string
 * Used for context stack indexing: @ = 0, @@ = 1, @@@ = 2, etc.
 * 
 * @param {string} str - String to analyze
 * @returns {number} Number of consecutive @ symbols at start
 */
const countAtSymbols = (str) => {
  if (typeof str !== 'string') return 0
  const match = str.match(/^(@+)/)
  return match ? match[1].length : 0
}

/**
 * Compile a service descriptor into a function that accepts iteration context
 */
const compileServiceFunction = (serviceDescriptor, services, source, contextStack = []) => {
  return async (iterationItem) => {
    const newContextStack = [...contextStack, iterationItem]
    
    // Check if this is a chain (array of arrays)
    if (Array.isArray(serviceDescriptor) && serviceDescriptor.length > 0 && Array.isArray(serviceDescriptor[0])) {
      // Execute as chain
      return await executeChain(serviceDescriptor, services, source, {}, newContextStack)
    } else if (Array.isArray(serviceDescriptor) && serviceDescriptor.length >= 3) {
      // Transform method syntax to regular syntax if needed
      const transformed = transformMethodSyntax(serviceDescriptor)
      const actualDescriptor = transformed ? transformed.transformedDescriptor : serviceDescriptor
      
      // Execute as regular service call
      const [serviceName, action, args] = actualDescriptor
      const resolvedArgs = resolveArgsWithContext(args, source, null, newContextStack)
      return await executeService(serviceName, action, resolvedArgs, services, source, null, {}, newContextStack)
    }
    
    throw new Error('Invalid service descriptor for function compilation')
  }
}

/**
 * Resolve @ symbols and JSONPath in arguments with context stack support
 * @param {*} args - Arguments to resolve (can be object, array, or primitive)
 * @param {Object} source - Source data object containing query results
 * @param {*} chainResult - Result from previous step in a chain (unused currently)
 * @param {Array} contextStack - Stack of context items for @ symbol resolution
 * @param {Set} skipParams - Set of parameter names to skip resolution for
 * @returns {*} Resolved arguments with @ symbols and JSONPath replaced
 */
export const resolveArgsWithContext = (args, source, chainResult = null, contextStack = [], skipParams = new Set()) => {
  const resolve = (value) => {
    if (typeof value !== 'string') return value
    
    // Handle @ symbol with context stack
    if (AT_REGEX.test(value)) {
      const atCount = countAtSymbols(value)
      
      if (value === '@'.repeat(atCount)) {
        // Pure @ symbols - use absolute indexing
        const contextIndex = atCount - 1 // @ = index 0, @@ = index 1, etc.
        
        if (contextIndex >= contextStack.length) {
          throw new Error(`${'@'.repeat(atCount)} used but only ${contextStack.length} context levels available (@ through ${'@'.repeat(contextStack.length)})`)
        }
        
        return contextStack[contextIndex] || null
      }
      
      // Handle @.field with context stack
      if (value.startsWith('@'.repeat(atCount) + '.')) {
        const fieldPath = value.slice(atCount + 1) // Remove @ symbols and dot
        const contextIndex = atCount - 1 // @ = index 0, @@ = index 1, etc.
        
        if (contextIndex >= contextStack.length) {
          throw new Error(`${'@'.repeat(atCount)} used but only ${contextStack.length} context levels available (@ through ${'@'.repeat(contextStack.length)})`)
        }
        
        const contextItem = contextStack[contextIndex] || null
        
        if (contextItem && fieldPath) {
          const path = '$.' + fieldPath
          return retrieve(path, contextItem)
        }
        
        return contextItem
      }
    }
    
    // Handle regular JSONPath
    const match = value.match(DEP_REGEX)
    return match ? retrieve(value, source) : value
  }

  if (Array.isArray(args)) {
    return args.map(resolve)
  }
  
  if (typeof args === 'object' && args !== null) {
    const resolved = {}
    for (const [key, value] of Object.entries(args)) {
      if (skipParams.has(key)) {
        // Skip resolution for this parameter - keep as-is
        resolved[key] = value
      } else if (typeof value === 'object' && value !== null) {
        resolved[key] = resolveArgsWithContext(value, source, chainResult, contextStack, skipParams)
      } else {
        resolved[key] = resolve(value)
      }
    }
    return resolved
  }
  
  return resolve(args)
}

/**
 * Resolve @ symbols and JSONPath in arguments (backward compatibility)
 */
const resolveArgs = (args, source, chainResult = null) => {
  return resolveArgsWithContext(args, source, chainResult, [], new Set())
}

/**
 * Guard function for service execution - provides context about where errors occur
 */
const guardServiceExecution = async (serviceName, action, args, service, taskContext) => {
  try {
    const result = await service(action, args)
    return result
  } catch (error) {
    // Enhance error with query context
    const taskInfo = taskContext ? ` in query task '${taskContext.taskName}'` : ''
    const serviceInfo = `${serviceName}.${action}`
    const argsInfo = `Args: ${JSON.stringify(args, null, 2)}`
    
    // Create a more helpful error message focusing on the query location
    const enhancedMessage = `Error in service ${serviceInfo}${taskInfo}: ${error.message}\n${argsInfo}`
    const enhancedError = new Error(enhancedMessage)
    enhancedError.originalError = error
    enhancedError.serviceName = serviceName
    enhancedError.action = action
    enhancedError.taskName = taskContext?.taskName
    
    throw enhancedError
  }
}

/**
 * Execute a single service call
 */
const executeService = async (serviceName, action, args, services, source, chainResult = null, timeouts = {}, contextStack = [], taskContext = null) => {
  const service = services[serviceName]
  if (!service) {
    const taskInfo = taskContext ? ` in query task '${taskContext.taskName}'` : ''
    const descriptorInfo = taskContext?.descriptor ? `\nService descriptor: ${JSON.stringify(taskContext.descriptor)}` : ''
    throw new Error(`Service '${serviceName}' not found${taskInfo}${descriptorInfo}`)
  }
  
  // Check for parameter metadata to determine function compilation
  let paramMetadata = {}
  if (typeof service === 'function' && service._originalService) {
    // This is a wrapped service object, get metadata from the original
    paramMetadata = service._originalService[action]?._params || {}
  } else if (typeof service === 'object') {
    // Direct service object access
    const serviceMethod = service[action]
    paramMetadata = serviceMethod?._params || {}
  }
  
  // Build set of parameters that should skip resolution
  const skipParams = new Set()
  const functionsToCompile = {}
  
  for (const [key, value] of Object.entries(args)) {
    const paramInfo = paramMetadata[key]
    
    if (paramInfo?.type === 'function' && Array.isArray(value)) {
      // Mark for function compilation
      functionsToCompile[key] = value
      skipParams.add(key)
    } else if (paramInfo?.type === 'template') {
      // Mark to skip resolution
      skipParams.add(key)
    }
  }
  
  // Resolve arguments while skipping special parameters
  const finalArgs = resolveArgsWithContext(args, source, chainResult, contextStack, skipParams)
  
  // Now handle function compilation
  for (const [key, value] of Object.entries(functionsToCompile)) {
    finalArgs[key] = compileServiceFunction(value, services, source, contextStack)
  }
  
  // Special handling for util service (legacy)
  if (serviceName === 'util') {
    // Provide util service with access to other services and context
    finalArgs._services = services
    finalArgs._context = source
  }
  
  // Handle timeout logic
  let timeoutMs = null
  let argsWithoutTimeout = finalArgs
  
  // Extract timeout from arguments if present
  if (finalArgs && typeof finalArgs === 'object' && finalArgs.timeout !== undefined) {
    timeoutMs = finalArgs.timeout
    // Create new args object without timeout for service execution
    argsWithoutTimeout = { ...finalArgs }
    delete argsWithoutTimeout.timeout
  }
  
  // Use service-specific timeout if no arg timeout provided
  if (timeoutMs === null && timeouts[serviceName] !== undefined) {
    timeoutMs = timeouts[serviceName]
  }
  
  // Use default timeout if no other timeout specified
  if (timeoutMs === null && timeouts.default !== undefined) {
    timeoutMs = timeouts.default
  }
  
  // Add timeout back to args so service can see it
  if (timeoutMs !== null && argsWithoutTimeout && typeof argsWithoutTimeout === 'object') {
    argsWithoutTimeout.timeout = timeoutMs
  }
  
  // Execute service with guard and timeout
  const servicePromise = guardServiceExecution(serviceName, action, argsWithoutTimeout, service, taskContext)
  return await withTimeout(servicePromise, timeoutMs, serviceName, action)
}

/**
 * Execute a chain of service calls
 */
const executeChain = async (chain, services, source, timeouts = {}, contextStack = [], taskContext = null) => {
  let result = null
  let currentContextStack = [...contextStack]
  
  for (let i = 0; i < chain.length; i++) {
    const descriptor = chain[i]
    const [serviceName, action, args] = descriptor
    
    // Add step context to task context
    const stepContext = taskContext ? {
      ...taskContext,
      chainStep: i + 1,
      chainTotal: chain.length,
      descriptor: descriptor
    } : null
    
    try {
      result = await executeService(serviceName, action, args, services, source, result, timeouts, currentContextStack, stepContext)
    } catch (error) {
      // Enhance error with chain step info
      const stepInfo = taskContext ? ` at step ${i + 1}/${chain.length} of chain in task '${taskContext.taskName}'` : ` at step ${i + 1}/${chain.length} of chain`
      error.message = `${error.message}${stepInfo}`
      throw error
    }
    
    // Add chain result to context stack for subsequent steps
    currentContextStack = [...currentContextStack, result]
  }
  
  return result
}

/**
 * Get dependencies from arguments recursively
 */
const getDependencies = (args) => {
  const deps = new Set()
  
  const findDeps = (value) => {
    if (typeof value === 'string') {
      const match = value.match(DEP_REGEX)
      if (match) {
        deps.add(match[1])
      }
    } else if (Array.isArray(value)) {
      value.forEach(findDeps)
    } else if (typeof value === 'object' && value !== null) {
      Object.values(value).forEach(findDeps)
    }
  }
  
  findDeps(args)
  return Array.from(deps)
}

/**
 * Promise-based query execution
 */
export default async function query(config) {
  const { services, given, query: jobs, methods = [], select, timeouts = {} } = config
  
  // Prepare services (auto-wrap objects)
  const preparedServices = prepareServices(services)
  
  const results = {}
  const tasks = new Map()
  
  // Add given data to results immediately
  if (given) {
    results.given = given
  }
  
  // Process each job to create task definitions
  for (const [jobName, descriptor] of Object.entries(jobs)) {
    
    // Handle alias jobs (simple references)
    if (typeof descriptor === 'string' && descriptor.match(DEP_REGEX)) {
      const deps = getDependencies(descriptor)
      tasks.set(jobName, {
        deps,
        execute: () => retrieve(descriptor, results)
      })
      continue
    }
    
    // Handle service chains
    if (Array.isArray(descriptor) && descriptor.length > 0 && Array.isArray(descriptor[0])) {
      const chain = descriptor
      const allDeps = new Set()
      
      // Collect dependencies from all steps in the chain
      chain.forEach(step => {
        if (Array.isArray(step) && step.length >= 3) {
          getDependencies(step[2]).forEach(dep => allDeps.add(dep))
        }
      })
      
      tasks.set(jobName, {
        deps: Array.from(allDeps),
        execute: () => executeChain(chain, preparedServices, results, timeouts, [], { taskName: jobName, descriptor: chain })
      })
      continue
    }
    
    // Handle method syntax calls
    const methodCall = parseMethodCall(descriptor, methods)
    if (methodCall) {
      const { serviceName, action, dataSource, args } = methodCall
      
      // For method calls, we need to resolve the data source dependency
      const deps = []
      if (dataSource.startsWith('$.')) {
        const match = dataSource.match(DEP_REGEX)
        if (match) deps.push(match[1])
      }
      deps.push(...getDependencies(args))
      
      tasks.set(jobName, {
        deps,
        execute: async () => {
          // Resolve the data source first
          const data = dataSource.startsWith('$.') ? retrieve(dataSource, results) : dataSource
          const finalArgs = { ...args, on: data }
          return await executeService(serviceName, action, finalArgs, preparedServices, results, null, timeouts, [], { taskName: jobName, descriptor: descriptor })
        }
      })
      continue
    }
    
    // Handle traditional service calls
    if (Array.isArray(descriptor) && descriptor.length >= 3) {
      const [serviceName, action, args] = descriptor
      const deps = getDependencies(args)
      
      tasks.set(jobName, {
        deps,
        execute: () => executeService(serviceName, action, args, preparedServices, results, null, timeouts, [], { taskName: jobName, descriptor: descriptor })
      })
      continue
    }
    
    throw new Error(`Invalid job descriptor for '${jobName}': ${JSON.stringify(descriptor)}`)
  }
  
  // Execute tasks in dependency order using topological sort
  const executed = new Set()
  const executing = new Map()
  
  const executeTask = async (taskName) => {
    // If already executed, return cached result
    if (executed.has(taskName)) {
      return results[taskName]
    }
    
    // If currently executing, wait for it
    if (executing.has(taskName)) {
      return await executing.get(taskName)
    }
    
    const task = tasks.get(taskName)
    if (!task) {
      // Check if it's a built-in value like 'given'
      if (taskName === 'given' && given) {
        executed.add(taskName)
        return given
      }
      throw new Error(`Task '${taskName}' not found`)
    }
    
    const promise = (async () => {
      try {
        // Execute dependencies first
        for (const depName of task.deps) {
          await executeTask(depName)
        }
        
        // Execute this task
        const result = await task.execute()
        results[taskName] = result
        executed.add(taskName)
        return result
      } catch (error) {
        // If error doesn't already have task context, add it
        if (!error.taskName) {
          const enhancedMessage = `Error in query task '${taskName}': ${error.message}`
          const enhancedError = new Error(enhancedMessage)
          enhancedError.originalError = error
          enhancedError.taskName = taskName
          throw enhancedError
        }
        throw error
      }
    })()
    
    executing.set(taskName, promise)
    return await promise
  }
  
  // Execute all tasks
  const allTaskNames = Array.from(tasks.keys())
  await Promise.all(allTaskNames.map(name => executeTask(name)))
  
  // Select specified results if user requests
  if (Array.isArray(select)) {
    return Object.fromEntries(
      select.map(key => [key, results[key]])
    )
  } else if (typeof select === 'string') {
    return results[select]
  }
  
  return results
}