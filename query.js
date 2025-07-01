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
 * - Context stack for nested @ symbol resolution (@, @@, @@@)
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

/** @type {RegExp} JSONPath dependency pattern for $.queryName references */
const DEP_REGEX = /\$\.(\w+)/

/** @type {RegExp} Context reference pattern for @ symbols */
const AT_REGEX = /^@+/

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
 * Always uses util service - no defensive programming needed since it's in same codebase
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
    // Inspector already handles filtering hidden properties
    const argsStr = inspect(args, inspectSettings)
    return `${errorLine}\nArgs: ${argsStr}`
  }

  return errorLine
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
 * @param {Array} contextStack - Current context stack
 * @throws {Error} If context index is invalid
 */
const validateContextIndex = (atCount, contextIndex, contextStack) => {
  if (contextIndex < 0 || contextIndex >= contextStack.length) {
    throw new Error(`${'@'.repeat(atCount)} used but only ${contextStack.length} context levels available (@ through ${'@'.repeat(contextStack.length)})`)
  }
}

/**
 * Compile a service descriptor into a function that accepts iteration context
 */
const compileServiceFunction = (serviceDescriptor, services, source, contextStack = [], querySettings = {}) => {
  return async (iterationItem) => {
    const newContextStack = [...contextStack, iterationItem]

    // Check if this is a chain (array of arrays)
    if (Array.isArray(serviceDescriptor) && serviceDescriptor.length > 0 && Array.isArray(serviceDescriptor[0])) {
      // Execute as chain
      return await executeChain(serviceDescriptor, services, source, newContextStack, null, querySettings)
    } else if (Array.isArray(serviceDescriptor) && serviceDescriptor.length >= 3) {
      // Transform method syntax to regular syntax if needed
      const transformed = transformMethodSyntax(serviceDescriptor)
      const actualDescriptor = transformed ? transformed.transformedDescriptor : serviceDescriptor

      // Execute as regular service call
      const [serviceName, action, args] = actualDescriptor
      // Pass args without resolving - executeService will handle resolution while preserving special parameters
      return await executeService(serviceName, action, args, services, source, newContextStack, null, querySettings)
    }

    throw new Error('Invalid service descriptor for function compilation')
  }
}

/**
 * Resolve @ symbols and JSONPath in arguments with context stack support
 * @param {*} args - Arguments to resolve (can be object, array, or primitive)
 * @param {Object} source - Source data object containing query results
 * @param {Array} contextStack - Stack of context items for @ symbol resolution (absolute indexing)
 * @param {Set} skipParams - Set of parameter names to skip resolution for
 * @returns {*} Resolved arguments with @ symbols and JSONPath replaced
 */
export const resolveArgsWithContext = (args, source, contextStack = [], skipParams = new Set()) => {
  const resolve = (value) => {
    if (typeof value !== 'string') return value

    // Handle @ symbol with context stack
    if (AT_REGEX.test(value)) {
      const atCount = countAtSymbols(value)

      if (value === '@'.repeat(atCount)) {
        // Pure @ symbols - @ refers to absolute context indexing
        // @ = first context (contextStack[0]), @@ = second context (contextStack[1]), etc.
        const contextIndex = atCount - 1

        validateContextIndex(atCount, contextIndex, contextStack)

        return contextStack[contextIndex] || null
      }

      // Handle @.field with context stack
      if (value.startsWith('@'.repeat(atCount) + '.')) {
        const fieldPath = value.slice(atCount + 1) // Remove @ symbols and dot
        // @ refers to context level
        const contextIndex = atCount - 1

        validateContextIndex(atCount, contextIndex, contextStack)

        const contextItem = contextStack[contextIndex] || null

        // $ sign here represents JSONPath syntax, not MicroQL
        // We're using JSONPath to query the path, even though
        // @ context is the target
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
        resolved[key] = resolveArgsWithContext(value, source, contextStack, skipParams)
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
 * Execute a single service call
 */
const executeService = async (serviceName, action, args, services, source, contextStack = [], queryContext = null, querySettings = {}) => {
  const service = services[serviceName]
  if (!service) {
    const queryInfo = queryContext ? ` in query '${queryContext.queryName}'` : ''
    const descriptorInfo = queryContext?.descriptor ? `\nService descriptor: ${JSON.stringify(queryContext.descriptor)}` : ''
    throw new Error(`Service '${serviceName}' not found${queryInfo}${descriptorInfo}`)
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
  const settingsToCompile = {}

  // Add reserved MicroQL parameters to skip list
  skipParams.add('timeout')
  skipParams.add('retry')
  skipParams.add('onError')
  skipParams.add('ignoreErrors')

  for (const [key, value] of Object.entries(args)) {
    const paramInfo = paramMetadata[key]

    if (paramInfo?.type === 'function' && Array.isArray(value)) {
      // Mark for function compilation
      functionsToCompile[key] = value
      skipParams.add(key)
    } else if (paramInfo?.type === 'template' && typeof value === 'object' && value !== null) {
      // Mark template for compilation to function
      functionsToCompile[key] = value
      skipParams.add(key)
    } else if (paramInfo?.type === 'settings') {
      // Mark for settings compilation
      settingsToCompile[key] = value
      skipParams.add(key)
    }
  }

  // Resolve arguments while skipping special parameters
  const finalArgs = resolveArgsWithContext(args, source, contextStack, skipParams)

  // Now handle function compilation
  for (const [key, value] of Object.entries(functionsToCompile)) {
    const paramInfo = paramMetadata[key]

    if (paramInfo?.type === 'template') {
      // Compile template to function with context layer
      finalArgs[key] = async (iterationItem) => {
        const newContextStack = [...contextStack, iterationItem]
        return resolveArgsWithContext(value, source, newContextStack)
      }
    } else {
      // Compile service descriptor to function
      finalArgs[key] = compileServiceFunction(value, services, source, contextStack, querySettings)
    }
  }

  // Handle settings compilation - pass the resolved settings
  for (const [key, value] of Object.entries(settingsToCompile)) {
    // Always pass the full resolved settings
    finalArgs[key] = querySettings
  }

  // Handle timeout, retry, onError, and ignoreErrors logic
  // ARCHITECTURAL NOTE: timeout, retry, onError, and ignoreErrors are MicroQL-interpreted parameters.
  // We extract them here but pass them through to services so they can
  // optionally use them for their own logic (e.g., logging).
  let timeoutMs = null
  let retryCount = 0
  let onErrorFunction = null
  let ignoreErrors = false
  let argsWithoutReserved = finalArgs

  // Extract timeout, retry, onError, and ignoreErrors from arguments if present
  if (finalArgs && typeof finalArgs === 'object') {
    if (finalArgs.timeout !== undefined) {
      timeoutMs = finalArgs.timeout
    }
    if (finalArgs.retry !== undefined) {
      retryCount = Math.max(0, parseInt(finalArgs.retry) || 0)
    }
    if (finalArgs.onError !== undefined) {
      // Store the onError descriptor for later compilation when we have error context
      if (Array.isArray(finalArgs.onError)) {
        onErrorFunction = finalArgs.onError  // Store the descriptor, not the compiled function
      }
    }
    if (finalArgs.ignoreErrors !== undefined) {
      ignoreErrors = Boolean(finalArgs.ignoreErrors)
    }

    // Create new args object without reserved fields for service execution
    if (finalArgs.timeout !== undefined || finalArgs.retry !== undefined || finalArgs.onError !== undefined || finalArgs.ignoreErrors !== undefined) {
      argsWithoutReserved = { ...finalArgs }
      delete argsWithoutReserved.timeout
      delete argsWithoutReserved.retry
      delete argsWithoutReserved.onError
      delete argsWithoutReserved.ignoreErrors
    }
  }

  // Use service-specific timeout from settings if no arg timeout provided
  if (timeoutMs === null && querySettings?.timeout?.[serviceName] !== undefined) {
    timeoutMs = querySettings.timeout[serviceName]
  }

  // Use default timeout from settings if nothing else specified
  if (timeoutMs === null && querySettings?.timeout?.default !== undefined) {
    timeoutMs = querySettings.timeout.default
  }

  // Add timeout and retry back to args so service can see them
  if (finalArgs && typeof finalArgs === 'object') {
    if (timeoutMs !== null) {
      argsWithoutReserved.timeout = timeoutMs
    }
    if (retryCount > 0) {
      argsWithoutReserved.retry = retryCount
    }
  }

  // Create unified debug printer if debug mode is enabled
  const debugPrinter = querySettings?.debug ? createDebugPrinter(querySettings) : null

  // Execute service with retry, guard, timeout, and error handling
  const executeWithRetry = async () => {
    try {
      const servicePromise = guardServiceExecution(serviceName, action, argsWithoutReserved, service, queryContext, debugPrinter, querySettings)
      return await withTimeout(servicePromise, timeoutMs, serviceName, action, argsWithoutReserved, queryContext)
    } catch (error) {
      // If onError descriptor is defined, compile and call it with error context
      if (onErrorFunction) {
        const errorContext = {
          error: error.message,
          originalError: error,
          serviceName,
          action,
          args: argsWithoutReserved,
          queryName: queryContext?.queryName
        }

        try {
          // Now compile the onError function with error context as the context stack
          const compiledOnError = compileServiceFunction(onErrorFunction, services, source, [errorContext], querySettings)
          // Call it with the error context as the iteration item (becomes @)
          await compiledOnError(errorContext)
        } catch (onErrorErr) {
          console.error(`onError handler failed: ${onErrorErr.message}`)
        }
      }

      // If ignoreErrors is true, return null instead of throwing
      if (ignoreErrors) {
        return null
      }

      // Re-throw the original error to maintain normal error flow
      throw error
    }
  }

  return await withRetry(executeWithRetry, retryCount, serviceName, action)
}

/**
 * Execute a chain of service calls
 */
const executeChain = async (chain, services, source, contextStack = [], queryContext = null, querySettings = {}) => {
  let result = null

  for (let i = 0; i < chain.length; i++) {
    const descriptor = chain[i]

    // Transform method syntax to regular syntax if needed
    const transformed = transformMethodSyntax(descriptor)
    const actualDescriptor = transformed ? transformed.transformedDescriptor : descriptor

    const [serviceName, action, args] = actualDescriptor

    // Add step context to query context
    const stepContext = queryContext ? {
      ...queryContext,
      chainStep: i + 1,
      chainTotal: chain.length,
      descriptor: descriptor
    } : null

    // For chains, update the iteration value at the current nesting level
    // Each chain step's result becomes the new iteration value at this level
    const currentContextStack = result !== null ? [result, ...contextStack.slice(1)] : contextStack

    try {
      result = await executeService(serviceName, action, args, services, source, currentContextStack, stepContext, querySettings)
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
    settings = {}
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

  // Prepare services (auto-wrap objects)
  const servicesWithUtil = { ...services }

  // Auto-include util service for debug functionality if not already present
  if (resolvedSettings.debug && !servicesWithUtil.util) {
    servicesWithUtil.util = utilService
  }

  const preparedServices = prepareServices(servicesWithUtil)

  // Create unified debug printer for all debug output
  const debugPrinter = resolvedSettings.debug ?
    createDebugPrinter(resolvedSettings) : null


  const results = {}
  const queryMap = new Map()

  // Add given data to results immediately
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
        execute: () => executeChain(chain, preparedServices, results, [], { queryName: queryName, descriptor: chain }, resolvedSettings)
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
          return await executeService(serviceName, action, finalArgs, preparedServices, results, [], { queryName: queryName, descriptor: descriptor }, resolvedSettings)
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
        execute: () => executeService(serviceName, action, args, preparedServices, results, [], { queryName: queryName, descriptor: descriptor }, resolvedSettings)
      })
      continue
    }

    throw new Error(`Invalid query descriptor for '${queryName}': ${JSON.stringify(descriptor)}`)
  }

  // Execute queries in dependency order using topological sort
  const executed = new Set()
  const executing = new Map()
  executed.add('given')

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

        const compiledOnError = compileServiceFunction(queryOnError, preparedServices, results, [errorContext], resolvedSettings)
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
