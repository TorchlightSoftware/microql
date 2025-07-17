import _ from 'lodash'

const withDebug = (fn) => {
  const {serviceName, action, settings} = this
  return async function (args) {
    const startTime = Date.now()

    if (settings.debug) {
      const color = getServiceColor(serviceName)
      const colorCode = ANSI_COLORS[color] || ''
      const resetCode = colorCode ? ANSI_COLORS.reset : ''

      console.log(
        `${colorCode}[${serviceName}.${action}] Called with:${resetCode}`,
        inspect(args, settings.inspect || {})
      )
    }

    try {
      const result = await fn.call(this, args)

      if (settings.debug) {
        const duration = Date.now() - startTime
        const color = getServiceColor(serviceName)
        const colorCode = ANSI_COLORS[color] || ''
        const resetCode = colorCode ? ANSI_COLORS.reset : ''

        console.log(
          `${colorCode}[${serviceName}.${action}] Completed in ${duration}ms:${resetCode}`,
          inspect(result, settings.inspect || {})
        )
      }

      return result
    } catch (error) {
      if (settings.debug) {
        const duration = Date.now() - startTime
        const color = getServiceColor(serviceName)
        const colorCode = ANSI_COLORS[color] || ''
        const resetCode = colorCode ? ANSI_COLORS.reset : ''

        console.log(
          `${colorCode}[${serviceName}.${action}] Failed after ${duration}ms:${resetCode}`,
          error.message
        )
      }
      throw error
    }
  }
}

const withTimeout = (fn) => {
  const {settings, serviceName, action} = this
  return async function (args) {
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => {
        reject(
          new Error(
            `Service '${serviceName}.${action}' timed out after ${settings.timeout}ms`
          )
        )
      }, settings.timeout)
    })

    return Promise.race([fn.call(this, args), timeoutPromise])
  }
}

const withRetry = (fn) => {
  const {settings, serviceName, action} = this
  const {retryCount} = settings

  return async function (args) {
    let lastError

    for (let attempt = 1; attempt <= retryCount + 1; attempt++) {
      try {
        return await fn.call(this, args)
      } catch (error) {
        lastError = error

        if (attempt <= retryCount) {
          console.error(
            `Service '${serviceName}.${action}' failed (attempt ${attempt}/${retryCount + 1}), retrying...`
          )
        }
      }
    }

    throw lastError
  }
}

const withErrorHandling = (fn) => {
  const {serviceName, action, config} = this
  return async function (args) {
    try {
      return await fn.call(this, args)
    } catch (error) {

      // Prepare error context with complete args + query name
      const errorContext = {
        error: error.message,
        originalError: error,
        serviceName,
        action,
        args,
        queryName: this?.reference || 'unknown'
      }

      // Handle with onError if provided
      if (args.onError) {
        try {
          // Compile the error handler
          const errorHandler = compileServiceFunction(
            args.onError,
            config,
            this.root,
            this
          )

          // Create a virtual node for the error handler with error context
          let handlerResult
          if (errorHandler.__compiledNode) {
            const virtualNode = createVirtualNode(errorHandler.__compiledNode, errorContext, this)
            handlerResult = await virtualNode.execute()
          } else {
            // Fallback for handlers without compiled nodes
            handlerResult = await errorHandler(errorContext)
          }

          // If ignoreErrors is true, run handler for side effects but return null
          if (args.ignoreErrors) {
            return null
          }

          // Otherwise return the handler result
          return handlerResult
        } catch (handlerError) {
          // Error handler failed
          if (!args.ignoreErrors) {
            throw handlerError
          }
          return null
        }
      }

      // Re-throw original error
      if (!args.ignoreErrors) {
        throw error
      }
    }
  }
}

const withArgs = (fn) => {
  return async function (args) {
    const {contextStack} = this
    
    // If no contextStack provided, pass args through unchanged
    if (!contextStack || !contextStack.length) {
      return await fn.call(this, args)
    }
    
    // Get the current context (top of stack) and query results (from root)
    const currentContext = contextStack[contextStack.length - 1]
    const queryResults = contextStack[0] // Root context contains all query results
    
    // Helper function to resolve @ and $ references in values
    const resolveValue = (value) => {
      if (typeof value !== 'string') return value
      
      // Handle bare $ - returns all completed queries
      if (value === '$') {
        const allQueries = {}
        for (const [key, val] of Object.entries(queryResults)) {
          if (!key.startsWith('_')) {
            allQueries[key] = val
          }
        }
        return allQueries
      }
      
      // Handle $.path references (e.g., "$.given.value")
      if (value.startsWith('$.')) {
        const path = value.substring(2) // Remove "$."
        return _.get(queryResults, path)
      }
      
      // Handle @ references (current context)
      if (value === '@') {
        return currentContext
      }
      
      // Handle @.path references (e.g., "@.field")
      if (value.startsWith('@.')) {
        const path = value.substring(2) // Remove "@."
        return _.get(currentContext, path)
      }
      
      return value
    }
    
    // Recursively resolve all @ and $ references in the arguments
    const resolvedArgs = _.cloneDeepWith(args, (value) => {
      if (typeof value === 'string') {
        return resolveValue(value)
      }
      // Let cloneDeepWith handle objects and arrays recursively
      return undefined
    })
    
    return await fn.call(this, resolvedArgs)
  }
}

const applyWrappers = (def, config) => {
  const {serviceName, action, args} = def
  const settings = _.merge({}, config.settings, args.settings)
  const service = config.services[serviceName]

  // `this` context is preserved so service can call other sibling services
  const serviceCall = service[action].bind(service)

  // Build wrapper array in canonical order
  const wrappers = []

  // 1. withArgs - resolves @ and $ references (outermost, called first)
  wrappers.push(withArgs)

  if (settings.debug) {
    wrappers.push(withDebug)
  }
  if (settings.timeout && settings.timeout > 0) {
    wrappers.push(withTimeout)
  }
  if (settings.retry > 0) {
    wrappers.push(withRetry)
  }
  if (settings.onError || settings.ignoreErrors) {
    wrappers.push(withErrorHandling)
  }

  // Apply all wrappers using functional composition
  const wrapped = wrappers.reduce((fn, wrapper) => wrapper(fn), serviceCall)

  // give all wrappers access to the full calling context so they don't have to fish for it
  // allow the contextStack to be passed at execution time
  return (contextStack) => wrapped.call({serviceName, action, settings, contextStack})
}

export default applyWrappers
