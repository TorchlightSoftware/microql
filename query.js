/**
 * @fileoverview MicroQL query execution engine
 *
 * Core module that orchestrates service execution with sophisticated context management,
 * method syntax transformation, and parallel query execution. Supports complex nested
 * data transformations with @ symbol context chaining.
 *
 * ARCHITECTURAL SEPARATION:
 * - MicroQL core is completely self-contained within the microql/ directory
 * - Services know nothing about MicroQL internals and vice versa
 * - The only coupling point is the query execution interface
 * - This separation ensures services remain portable and reusable
 *
 * Key features:
 * - Promise-based async service orchestration
 * - Chain stack for nested @ symbol resolution (@, @@, @@@)
 * - Method syntax sugar: ['@.data', 'service:method', args]
 * - Automatic service object wrapping
 * - Comprehensive error context for debugging
 * - Parallel execution with dependency management
 * - Built-in retry and timeout mechanisms
 */

import retrieve from './retrieve.js'
import { COLOR_NAMES } from './util.js'
import utilService from './util.js'
import { inspect } from 'util'
import { ExecutionContext } from './executionContext.js'
import { processParameters, setCompileServiceFunction } from './processParameters.js'

/** @type {RegExp} JSONPath dependency pattern for $.queryName references */
const DEP_REGEX = /\$\.(\w+)/

/** @type {RegExp} Context reference pattern for @ symbols */
const AT_REGEX = /^@+/

/**
 * Returns precise type instead of just "object" for arrays, dates, etc.
 */
const getType = (obj) => {
  return Object.prototype.toString.call(obj).slice(8, -1)
}

/**
 * Service color assignment for debug logging
 * Maintains consistent colors for each service across the session
 */
const serviceColors = new Map()
let colorIndex = 0

/**
 * Get assigned color for a service, creating one if needed
 */
const getServiceColor = (serviceName) => {
  if (!serviceColors.has(serviceName)) {
    serviceColors.set(serviceName, COLOR_NAMES[colorIndex % COLOR_NAMES.length])
    colorIndex++
  }
  return serviceColors.get(serviceName)
}

/**
 * Create unified debug printer for all MicroQL debug output
 * @param {Object} querySettings - Query settings with inspect configuration
 * @returns {Object} Debug functions
 */
const createDebugPrinter = (querySettings = {}) => {
  return {
    // Service debug messages: serviceName, action, message, value
    async service(serviceName, action, status, value) {
      const color = getServiceColor(serviceName)
      const formattedMessage = `${status} ${serviceName}:${action}`

      await utilService.print({
        on: formattedMessage,
        color,
        settings: querySettings
      })

      if (typeof value !== 'string') {
        await utilService.print({
          on: value,
          color,
          settings: querySettings,
          ts: false
        })
      }
    },

    // Query debug messages: queryName, status, result
    async query(queryName, status, result = null) {
      await utilService.print({
        on: `${status} ${queryName}`,
        color: 'white',
      })

      if (result !== null) {
        await utilService.print({
          on: result,
          settings: querySettings,
          color: 'white',
          ts: false
        })
      }
    }
  }
}

/**
 * Format error with consistent MicroQL format
 * @param {Error} error - The error to format
 * @param {Object} inspectSettings - Inspect settings for formatting args
 * @returns {string} Formatted error message
 */
const formatError = (error, inspectSettings) => {
  const {queryName, serviceName, action, args, serviceChain} = error
  const queryPrefix = queryName ? `:${queryName}: ` : ''
  const chainStr = serviceChain.length > 0 ? serviceChain.map(s => `[${s}]`).join('') : ''
  const serviceStr = `[${serviceName}:${action}]`

  let message = error.originalError?.message || error.message

  // Remove existing MicroQL context from message if present
  message = message.replace(/^Error in service .+?: /, '')

  const errorLine = `Error: ${queryPrefix}${chainStr}${serviceStr} ${message}`

  if (args && typeof args === 'object' && Object.keys(args).length > 0) {
    const argsStr = inspect(args, inspectSettings)
    return `${errorLine}\nArgs: ${argsStr}`
  }

  return errorLine
}

/**
 * Deep merge two objects, with the second object taking precedence
 * @param {Object} target - The target object (query settings)
 * @param {Object} source - The source object (service call settings)
 * @returns {Object} Merged object
 */
const deepMerge = (target, source) => {
  if (!source || typeof source !== 'object') return target
  if (!target || typeof target !== 'object') return source
  
  const result = { ...target }
  
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === 'object' && value !== null && !Array.isArray(value) && 
        typeof result[key] === 'object' && result[key] !== null && !Array.isArray(result[key])) {
      result[key] = deepMerge(result[key], value)
    } else {
      result[key] = value
    }
  }
  
  return result
}

/**
 * Default error handler - prints error in red and exits
 * @param {Error} error - The error to handle
 * @param {string} context - Error context (e.g., query name)
 * @param {Object} settings - Query settings including inspect config
 */
const defaultErrorHandler = (error, context, settings = {}) => {
  const red = '\x1b[31m'
  const reset = '\x1b[0m'

  // Note: we can't pass services here as it would create circular dependency
  // defaultErrorHandler doesn't need debug printing anyway
  let formattedError
  if (error.serviceName && error.action && error.queryName) {
    formattedError = formatError(error, settings.inspect)
  } else {
    formattedError = `${context ? `In ${context}: ` : ''}${error.message}`
  }

  // Only print and exit if not in test environment
  if (process.env.NODE_ENV !== 'test' && !process.env.MOCHA) {
    console.error(`${red}${formattedError}${reset}`)
    process.exit(1)
  }
}

/**
 * Wrap a promise with a timeout for service execution
 * @param {Promise} promise - The promise to wrap
 * @param {number} timeoutMs - Timeout in milliseconds
 * @param {string} serviceName - Service name for error context
 * @param {string} action - Action name for error context
 * @param {Object} args - Service arguments for error context
 * @param {Object} queryContext - Query context for error context
 * @returns {Promise} Promise that rejects if timeout is exceeded
 */
const withTimeout = (promise, timeoutMs, serviceName, action, args, queryContext) => {
  if (!timeoutMs || timeoutMs <= 0) {
    return promise
  }

  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => {
        // Create enhanced timeout error with same structure as service errors
        const timeoutError = new Error(`Service '${serviceName}.${action}' timed out after ${timeoutMs}ms`)
        timeoutError.serviceName = serviceName
        timeoutError.action = action
        timeoutError.args = args
        timeoutError.queryName = queryContext?.queryName
        timeoutError.serviceChain = queryContext?.serviceChain || []
        reject(timeoutError)
      }, timeoutMs)
    })
  ])
}

/**
 * Execute a function with retry logic
 * @param {Function} fn - The function to execute
 * @param {number} retries - Number of retry attempts (0 = no retry, just run once)
 * @param {string} serviceName - Service name for error context
 * @param {string} action - Action name for error context
 * @returns {Promise} Result from successful execution
 */
const withRetry = async (fn, retries, serviceName, action) => {
  let lastError

  // Try up to retries + 1 times (initial attempt + retries)
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error

      if (attempt < retries) {
        console.log(`Service '${serviceName}.${action}' failed (attempt ${attempt + 1}/${retries + 1}), retrying...`)
        // Optional: Add exponential backoff here if desired
        // await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 100))
      }
    }
  }

  // All attempts failed
  throw lastError
}

/**
 * Wrap a function with guard execution (debug logging and error context)
 * @param {Function} fn - Function to wrap
 * @param {Object} context - Execution context
 * @returns {Function} Wrapped function with guard logic
 */
const withGuard = (fn, { serviceName, action, debugPrinter, querySettings, queryContext }) => {
  let callCount = 0
  const maxCalls = querySettings.inspect?.maxArrayLength || Infinity
  
  return async (...args) => {
    callCount++
    
    // Only debug the first maxCalls iterations, then go silent
    if (querySettings?.debug && debugPrinter && callCount <= maxCalls) {
      await debugPrinter.service(serviceName, action, '🔵 ENTERING', args[0])
    }
    
    try {
      const result = await fn(...args)
      
      if (querySettings?.debug && debugPrinter && callCount <= maxCalls) {
        await debugPrinter.service(serviceName, action, '🟢 LEAVING', result)
      }
      
      return result
    } catch (error) {
      // Always show errors, regardless of maxCalls
      if (querySettings?.debug && debugPrinter) {
        await debugPrinter.service(serviceName, action, '🔴 ERROR', `Error: ${error.message}`)
      }
      
      // Enhance error with context
      error.serviceName = serviceName
      error.action = action  
      error.queryName = queryContext?.queryName
      error.args = args[0]
      error.serviceChain = queryContext?.serviceChain || []
      
      throw error
    }
  }
}

/**
 * Wrap a function with timeout logic
 * @param {Function} fn - Function to wrap
 * @param {number} timeoutMs - Timeout in milliseconds
 * @param {string} serviceName - Service name for error context
 * @param {string} action - Action name for error context
 * @param {Object} queryContext - Query context for error context
 * @returns {Function} Wrapped function with timeout logic
 */
const withTimeoutWrapper = (fn, timeoutMs, serviceName, action, queryContext) => {
  if (!timeoutMs || timeoutMs <= 0) {
    return fn
  }
  
  return async (...args) => {
    return Promise.race([
      fn(...args),
      new Promise((_, reject) => {
        setTimeout(() => {
          const timeoutError = new Error(`Service '${serviceName}.${action}' timed out after ${timeoutMs}ms`)
          timeoutError.serviceName = serviceName
          timeoutError.action = action
          timeoutError.args = args[0]
          timeoutError.queryName = queryContext?.queryName
          timeoutError.serviceChain = queryContext?.serviceChain || []
          reject(timeoutError)
        }, timeoutMs)
      })
    ])
  }
}

/**
 * Wrap a function with retry logic
 * @param {Function} fn - Function to wrap
 * @param {number} retries - Number of retry attempts
 * @param {string} serviceName - Service name for error context
 * @param {string} action - Action name for error context
 * @returns {Function} Wrapped function with retry logic
 */
const withRetryWrapper = (fn, retries, serviceName, action) => {
  if (retries <= 0) {
    return fn
  }
  
  return async (...args) => {
    let lastError
    
    // Try up to retries + 1 times (initial attempt + retries)
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await fn(...args)
      } catch (error) {
        lastError = error
        
        if (attempt < retries) {
          console.log(`Service '${serviceName}.${action}' failed (attempt ${attempt + 1}/${retries + 1}), retrying...`)
        }
      }
    }
    
    throw lastError
  }
}

/**
 * Wrap a function with error handling logic (onError and ignoreErrors)
 * @param {Function} fn - Function to wrap
 * @param {Array|null} onErrorFunction - onError handler service call descriptor
 * @param {boolean} ignoreErrors - Whether to ignore errors (return null instead of throwing)
 * @param {Object} ctx - Execution context
 * @param {string} serviceName - Service name for error context
 * @param {string} action - Action name for error context
 * @param {Object} args - Original service arguments for error context
 * @returns {Function} Wrapped function with error handling logic
 */
const withErrorHandling = (fn, onErrorFunction, ignoreErrors, ctx, serviceName, action, args) => {
  if (!onErrorFunction && !ignoreErrors) {
    return fn
  }
  
  return async (...fnArgs) => {
    try {
      return await fn(...fnArgs)
    } catch (error) {
      // Handle onError if defined
      if (onErrorFunction) {
        // DEBUG: Log current ctx.chainStack before error
        console.log('🔍 DEBUG - Current ctx.chainStack before error:', ctx.chainStack)
        
        // Create args for error context with resolved timeout but without reserved params
        const argsForErrorContext = { ...args }
        delete argsForErrorContext.onError
        delete argsForErrorContext.ignoreErrors
        delete argsForErrorContext.retry
        
        // Add resolved timeout if it was determined
        const timeoutMs = ctx.getTimeout(serviceName, args?.timeout)
        if (timeoutMs !== null) {
          argsForErrorContext.timeout = timeoutMs
        }
        
        const errorContext = {
          error: error.message,
          originalError: error,
          serviceName,
          action,
          args: argsForErrorContext,
          queryName: ctx.queryName
        }

        // DEBUG: Log what gets passed to the error handler
        console.log('🔍 DEBUG - Error context passed to handler:', errorContext)

        try {
          // Preserve original chainStack and add errorContext
          const errorCtx = ctx.with({ chainStack: [...ctx.chainStack, errorContext] })
          
          // DEBUG: Log what @, @@, @@@ would resolve to
          console.log('🔍 DEBUG - Context resolution:')
          console.log('  @ would resolve to:', errorCtx.chainStack[0] || 'undefined')
          console.log('  @@ would resolve to:', errorCtx.chainStack[1] || 'undefined')
          console.log('  @@@ would resolve to:', errorCtx.chainStack[2] || 'undefined')
          
          const compiledOnError = compileServiceFunction(onErrorFunction, errorCtx)
          await compiledOnError(errorContext)
        } catch (onErrorErr) {
          console.error(`onError handler failed: ${onErrorErr.message}`)
        }
      }

      // If ignoreErrors is true, return null instead of throwing
      if (ignoreErrors) {
        return null
      }

      throw error
    }
  }
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
 * ARCHITECTURAL NOTE:
 * Services are provided by the application layer and MicroQL treats them
 * as black boxes. We only wrap them to ensure a consistent interface,
 * but make no assumptions about their internal implementation.
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
    transformedDescriptor: [serviceName, action, withOnParameter(args, dataSource)]
  }
}

/**
 * Parse and validate method syntax for query-level execution
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
    args: withOnParameter(descriptor[2], transformed.dataSource)
  }
}

/**
 * Merge arguments with 'on' parameter (common pattern in MicroQL)
 * Used for method syntax transformation and service argument preparation
 * @param {Object} args - Base arguments object
 * @param {*} onValue - Value for the 'on' parameter
 * @returns {Object} Merged arguments with 'on' parameter
 */
const withOnParameter = (args, onValue) => ({ on: onValue, ...args })

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
 * Validate context index for @ symbol resolution
 * Ensures proper error messages when context stack depth is insufficient
 * @param {number} atCount - Number of @ symbols (1 for @, 2 for @@, etc.)
 * @param {number} contextIndex - Calculated context index (atCount - 1)
 * @param {Array} chainStack - Current chain stack
 * @throws {Error} If context index is invalid
 */
const validateContextIndex = (atCount, contextIndex, chainStack) => {
  if (contextIndex < 0 || contextIndex >= chainStack.length) {
    throw new Error(`${'@'.repeat(atCount)} used but only ${chainStack.length} context levels available (@ through ${'@'.repeat(chainStack.length)})`)
  }
}

/**
 * Compile a service descriptor into a wrapped function that accepts iteration context
 */
const compileServiceFunction = (serviceDescriptor, ctx) => {
  // Extract service information for wrapper metadata
  let serviceName, action, args, timeoutMs = null, retryCount = 0, onErrorFunction = null, ignoreErrors = false
  
  if (Array.isArray(serviceDescriptor) && serviceDescriptor.length >= 3) {
    const transformed = transformMethodSyntax(serviceDescriptor)
    const actualDescriptor = transformed ? transformed.transformedDescriptor : serviceDescriptor
    ;[serviceName, action, args] = actualDescriptor
    
    // Extract wrapper parameters from args if present
    if (args && typeof args === 'object') {
      if (args.timeout !== undefined) {
        timeoutMs = args.timeout
      }
      if (args.retry !== undefined) {
        retryCount = Math.max(0, parseInt(args.retry) || 0)
      }
      onErrorFunction = args.onError
      ignoreErrors = Boolean(args.ignoreErrors)
    }
    
    // Use service-specific timeout from settings if no arg timeout provided
    if (timeoutMs === null && ctx.querySettings?.timeout?.[serviceName] !== undefined) {
      timeoutMs = ctx.querySettings.timeout[serviceName]
    }
    
    // Use default timeout from settings if nothing else specified
    if (timeoutMs === null && ctx.querySettings?.timeout?.default !== undefined) {
      timeoutMs = ctx.querySettings.timeout.default
    }
  }

  // Create base function
  const baseFunction = async (iterationItem) => {
    const newChainStack = [...ctx.chainStack, iterationItem]

    // Check if this is a chain (array of arrays)
    if (Array.isArray(serviceDescriptor) && serviceDescriptor.length > 0 && Array.isArray(serviceDescriptor[0])) {
      // Execute as chain  
      return await executeChain(serviceDescriptor, ctx.with({ chainStack: newChainStack }))
    } else if (Array.isArray(serviceDescriptor) && serviceDescriptor.length >= 3) {
      // Execute as regular service call - but use simplified executeService without wrappers
      return await executeServiceCore(serviceName, action, args, newChainStack, ctx)
    }

    throw new Error('Invalid service descriptor for function compilation')
  }
  
  // Apply wrappers if we have service metadata
  if (serviceName && action) {
    const queryContext = { queryName: 'compiled-function' }
    
    // Apply wrappers in order: errorHandling -> retry -> timeout -> guard
    let wrappedFunction = baseFunction
    
    // Apply error handling wrapper first to catch all errors
    wrappedFunction = withErrorHandling(wrappedFunction, onErrorFunction, ignoreErrors, ctx, serviceName, action, args)
    
    if (retryCount > 0) {
      wrappedFunction = withRetryWrapper(wrappedFunction, retryCount, serviceName, action)
    }
    
    if (timeoutMs && timeoutMs > 0) {
      wrappedFunction = withTimeoutWrapper(wrappedFunction, timeoutMs, serviceName, action, queryContext)
    }
    
    if (ctx.debugPrinter) {
      wrappedFunction = withGuard(wrappedFunction, {
        serviceName,
        action,
        debugPrinter: ctx.debugPrinter,
        querySettings: ctx.querySettings,
        queryContext
      })
    }
    
    return wrappedFunction
  }
  
  return baseFunction
}

/**
 * Resolve @ symbols and JSONPath in arguments with context stack support
 * @param {*} args - Arguments to resolve (can be object, array, or primitive)
 * @param {Object} source - Source data object containing query results
 * @param {Array} chainStack - Stack of chain items for @ symbol resolution (absolute indexing)
 * @param {Set} skipParams - Set of parameter names to skip resolution for
 * @returns {*} Resolved arguments with @ symbols and JSONPath replaced
 */
export const resolveArgsWithContext = (args, source, chainStack = [], skipParams = new Set()) => {
  const resolve = (value) => {
    if (typeof value !== 'string') return value

    // Handle @ symbol with chain stack
    if (AT_REGEX.test(value)) {
      const atCount = countAtSymbols(value)

      if (value === '@'.repeat(atCount)) {
        // Pure @ symbols - @ refers to absolute context indexing
        // @ = first chain level (chainStack[0]), @@ = second chain level (chainStack[1]), etc.
        const contextIndex = atCount - 1

        validateContextIndex(atCount, contextIndex, chainStack)

        return chainStack[contextIndex] || null
      }

      // Handle @.field with chain stack
      if (value.startsWith('@'.repeat(atCount) + '.')) {
        const fieldPath = value.slice(atCount + 1) // Remove @ symbols and dot
        // @ refers to chain level
        const contextIndex = atCount - 1

        validateContextIndex(atCount, contextIndex, chainStack)

        const contextItem = chainStack[contextIndex] || null

        // $ sign here represents JSONPath syntax, not MicroQL
        // We're using JSONPath to query the path, even though
        // @ chain item is the target
        if (contextItem && fieldPath) {
          const path = '$.' + fieldPath
          return retrieve(path, contextItem)
        }

        return contextItem
      }
    }

    // Handle regular JSONPath - including bare $ for entire results
    if (value === '$') {
      return source
    }
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
        resolved[key] = resolveArgsWithContext(value, source, chainStack, skipParams)
      } else {
        resolved[key] = resolve(value)
      }
    }
    return resolved
  }

  return resolve(args)
}

/**
 * Guard function for service execution - provides context about where errors occur
 */
const guardServiceExecution = async (serviceName, action, args, service, queryContext, debugPrinter, querySettings) => {
  try {
    // Debug logging when entering service
    if (querySettings?.debug && debugPrinter) {
      await debugPrinter.service(serviceName, action, '🔵 ENTERING', args)
    }

    const result = await service(action, args)

    // Debug logging when leaving service
    if (querySettings?.debug && debugPrinter) {
      await debugPrinter.service(serviceName, action, '🟢 LEAVING', result)
    }

    return result
  } catch (error) {
    // Debug logging when service throws error
    if (querySettings?.debug && debugPrinter) {
      await debugPrinter.service(serviceName, action, '🔴 ERROR', `Error: ${error.message}`)
    }

    // Enhance error with MicroQL context while preserving stack trace
    error.serviceName = serviceName
    error.action = action
    error.queryName = queryContext?.queryName
    error.args = args
    error.serviceChain = queryContext?.serviceChain || []

    throw error
  }
}

/**
 * Core service execution without wrappers - used by compiled functions
 */
const executeServiceCore = async (serviceName, action, args, chainStack, ctx) => {
  const service = ctx.services[serviceName]
  if (!service) {
    const queryInfo = ctx.queryName ? ` in query '${ctx.queryName}'` : ''
    throw new Error(`Service '${serviceName}' not found${queryInfo}`)
  }

  // Extract timeout and retry values using context methods
  const timeoutMs = ctx.getTimeout(serviceName, args?.timeout)
  const retryCount = ctx.getRetry(args?.retry)

  // Process parameters using the new parameter processor
  const processCtx = ctx.with({ chainStack })
  const finalArgs = processParameters(args, service, action, processCtx)

  // Remove non-service reserved parameters for service execution
  // timeout and retry are passed to services according to SERVICE_WRITER_GUIDE.md
  const argsWithoutReserved = { ...finalArgs }
  delete argsWithoutReserved.onError
  delete argsWithoutReserved.ignoreErrors
  
  // Ensure resolved timeout and retry are in args if they were determined
  if (timeoutMs !== null) {
    argsWithoutReserved.timeout = timeoutMs
  }
  if (retryCount > 0) {
    argsWithoutReserved.retry = retryCount
  }

  // Track service usage for tearDown
  ctx.trackService(serviceName)

  // Execute the service directly
  return await service(action, argsWithoutReserved)
}

/**
 * Execute a single service call with full wrapper support
 */
const executeService = async (serviceName, action, args, chainStack, ctx) => {
  // Extract wrapper parameters
  const timeoutMs = ctx.getTimeout(serviceName, args?.timeout)
  const retryCount = ctx.getRetry(args?.retry)
  const onErrorFunction = args?.onError
  const ignoreErrors = Boolean(args?.ignoreErrors)

  // Create base service execution function
  const baseFunction = async () => {
    return await executeServiceCore(serviceName, action, args, chainStack, ctx)
  }

  // Apply wrappers in order: errorHandling -> retry -> timeout -> guard
  let wrappedFunction = baseFunction

  // Apply error handling wrapper first to catch all errors
  wrappedFunction = withErrorHandling(wrappedFunction, onErrorFunction, ignoreErrors, ctx, serviceName, action, args)

  if (retryCount > 0) {
    wrappedFunction = withRetryWrapper(wrappedFunction, retryCount, serviceName, action)
  }

  if (timeoutMs && timeoutMs > 0) {
    wrappedFunction = withTimeoutWrapper(wrappedFunction, timeoutMs, serviceName, action, { queryName: ctx.queryName })
  }

  if (ctx.debugPrinter) {
    wrappedFunction = withGuard(wrappedFunction, {
      serviceName,
      action,
      debugPrinter: ctx.debugPrinter,
      querySettings: ctx.querySettings,
      queryContext: { queryName: ctx.queryName }
    })
  }

  return await wrappedFunction()
}

/**
 * Execute a chain of service calls
 */
const executeChain = async (chain, ctx) => {
  let result = null

  for (let i = 0; i < chain.length; i++) {
    const descriptor = chain[i]

    // Transform method syntax to regular syntax if needed
    const transformed = transformMethodSyntax(descriptor)
    const actualDescriptor = transformed ? transformed.transformedDescriptor : descriptor

    const [serviceName, action, args] = actualDescriptor

    // For chains, update the iteration value at the current nesting level
    // Each chain step's result becomes the new iteration value at this level
    const currentChainStack = result !== null ? [result, ...ctx.chainStack.slice(1)] : ctx.chainStack

    try {
      result = await executeService(serviceName, action, args, currentChainStack, ctx.with({ queryName: `${ctx.queryName}-chain-${i+1}` }))
    } catch (error) {
      // Add chain step to service chain for error context
      if (!error.serviceChain) {
        error.serviceChain = []
      }
      error.serviceChain.push(`${serviceName}:${action}`)
      throw error
    }
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
  const {
    services,
    given,
    query: queries,
    methods = [],
    select,
    onError: queryOnError,
    settings = {},
    snapshot: snapshotFile
  } = config

  // Setup default settings
  const defaultSettings = {
    timeout: { default: 5000 },
    inspect: {
      depth: 2,
      maxArrayLength: 3,
      maxStringLength: 140,
      colors: false
    }
  }

  const resolvedSettings = {
    timeout: { ...defaultSettings.timeout, ...settings.timeout },
    inspect: { ...defaultSettings.inspect, ...settings.inspect },
    debug: settings.debug
  }

  const preparedServices = prepareServices(services)

  // Track which services are actually used for tearDown
  const usedServices = new Set()

  // Create unified debug printer for all debug output
  const debugPrinter = resolvedSettings.debug ?
    createDebugPrinter(resolvedSettings) : null


  const results = {}
  const queryMap = new Map()

  // Load snapshot if provided
  if (snapshotFile) {
    try {
      const fs = await import('fs-extra')
      if (await fs.default.pathExists(snapshotFile)) {
        const snapshotData = JSON.parse(await fs.default.readFile(snapshotFile, 'utf8'))
        if (snapshotData.results) {
          Object.assign(results, snapshotData.results)
          if (debugPrinter) {
            await debugPrinter.query('snapshot', 'loaded', `from ${snapshotFile}`)
          }
        }
      }
    } catch (error) {
      throw new Error(`Failed to load snapshot from ${snapshotFile}: ${error.message}`)
    }
  }

  // Add given data to results immediately (may override snapshot data)
  if (given) {
    results.given = given
  }

  // Process each query to create query definitions
  for (const [queryName, descriptor] of Object.entries(queries)) {

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

      queryMap.set(queryName, {
        deps: Array.from(allDeps),
        execute: () => {
          const ctx = new ExecutionContext({
            services: preparedServices,
            source: results,
            chainStack: [],
            querySettings: resolvedSettings,
            debugPrinter,
            queryName,
            usedServices
          })
          return executeChain(chain, ctx)
        }
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

      queryMap.set(queryName, {
        deps,
        execute: async () => {
          // Resolve the data source first
          const data = dataSource.startsWith('$.') ? retrieve(dataSource, results) : dataSource
          const finalArgs = withOnParameter(args, data)
          const ctx = new ExecutionContext({
            services: preparedServices,
            source: results,
            chainStack: [],
            querySettings: resolvedSettings,
            debugPrinter,
            queryName,
            usedServices
          })
          return await executeService(serviceName, action, finalArgs, [], ctx)
        }
      })
      continue
    }

    // Handle traditional service calls
    if (Array.isArray(descriptor) && descriptor.length >= 3) {
      const [serviceName, action, args] = descriptor
      const deps = getDependencies(args)

      queryMap.set(queryName, {
        deps,
        execute: () => {
          const ctx = new ExecutionContext({
            services: preparedServices,
            source: results,
            chainStack: [],
            querySettings: resolvedSettings,
            debugPrinter,
            queryName,
            usedServices
          })
          return executeService(serviceName, action, args, [], ctx)
        }
      })
      continue
    }

    throw new Error(`Invalid query descriptor for '${queryName}': ${JSON.stringify(descriptor)}`)
  }

  // Execute queries in dependency order using topological sort
  const executed = new Set()
  const executing = new Map()
  executed.add('given')

  // Mark snapshot-loaded queries as executed
  if (snapshotFile) {
    for (const key of Object.keys(results)) {
      if (key !== 'given') { // given is already added above
        executed.add(key)
      }
    }
  }

  const executeQuery = async (queryName) => {
    // If already executed, return cached result
    if (executed.has(queryName)) {
      return results[queryName]
    }

    // If currently executing, wait for it
    if (executing.has(queryName)) {
      return await executing.get(queryName)
    }

    const query = queryMap.get(queryName)
    if (!query) {
      throw new Error(`Query '${queryName}' not found`)
    }

    const promise = (async () => {
      try {
        if (debugPrinter) {
          await debugPrinter.query(queryName, '🔄 Starting QUERY')
        }

        // Execute dependencies first
        for (const depName of query.deps) {
          await executeQuery(depName)
        }

        // Execute this query
        const result = await query.execute()
        results[queryName] = result
        executed.add(queryName)

        if (debugPrinter) {
          await debugPrinter.query(queryName, '✅ Completed QUERY', result)
        }

        return result
      } catch (error) {
        // If error doesn't already have query context, add it
        if (!error.queryName) {
          // Preserve stack trace by modifying the existing error
          error.message = `Error in query '${queryName}': ${error.message}`
          error.queryName = queryName
        }
        throw error
      }
    })()

    executing.set(queryName, promise)
    return await promise
  }

  try {
    // Execute all queries
    const allQueryNames = Array.from(queryMap.keys())

    await Promise.all(allQueryNames.map(name => executeQuery(name)))

    if (settings?.debug) {
      console.log(`📊 RESULTS SUMMARY:`)
      for (const [key, value] of Object.entries(results)) {
        console.log(`   ${key}: ${Array.isArray(value) ? `Array(${value.length})` : typeof value}`)
      }
    }

    // Select specified results if user requests
    if (Array.isArray(select)) {
      const selectedResults = Object.fromEntries(
        select.map(key => [key, results[key]])
      )
      if (settings?.debug) {
        console.log(`🎯 SELECTING: ${select.join(', ')}`)
        console.log(`📤 FINAL RESULT:`, JSON.stringify(selectedResults, null, 2))
      }
      return selectedResults
    } else if (typeof select === 'string') {
      const selectedResult = results[select]
      if (settings?.debug) {
        console.log(`🎯 SELECTING: ${select}`)
        console.log(`📤 FINAL RESULT:`, Array.isArray(selectedResult) ? `Array(${selectedResult.length})` : JSON.stringify(selectedResult, null, 2))
      }
      return selectedResult
    }

    if (settings?.debug) {
      console.log(`📤 FINAL RESULT: All results returned`)
    }

    return results
  } catch (error) {
    // Handle query-level errors
    if (queryOnError && Array.isArray(queryOnError)) {
      try {
        // Compile and execute the query-level onError handler
        const errorContext = {
          error: error.message,
          originalError: error,
          queryName: error.queryName,
          query: queries
        }

        const ctx = new ExecutionContext({
          services: preparedServices,
          source: results,
          chainStack: [errorContext],
          querySettings: resolvedSettings,
          debugPrinter,
          queryName: 'query-error-handler',
          usedServices
        })
        const compiledOnError = compileServiceFunction(queryOnError, ctx)
        await compiledOnError(errorContext)
      } catch (onErrorErr) {
        console.error(`Query-level onError handler failed: ${onErrorErr.message}`)
      }
    } else {
      // If we have a query-level onError handler, still throw to maintain flow
      // If no handler, default handler will exit the process
      defaultErrorHandler(error, 'query execution', resolvedSettings)
    }

    // Re-throw the error to maintain normal flow
    throw error
  }
}

// Set up circular dependency for parameter processing
setCompileServiceFunction(compileServiceFunction)
