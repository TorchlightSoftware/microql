import _ from 'lodash'
import resolveValue from './resolve.js'
import {getServiceColor} from './common.js'
import {inspect} from 'util'

import utilService from './services/util.js'

const withArgs = (fn) => {
  return async function (args = {}) {
    //console.log('withArgs this:', this)
    let {queryResults, contextStack} = this
    //let {queryName, serviceName, action} = this
    //console.log(`withArgs for [${queryName} - ${serviceName}:${action}] received:`, args, 'stack:', contextStack.stack)

    const resolvedArgs = _.cloneDeepWith(args, (value) => {

      // Recursively resolve all @ and $ references in the arguments
      if (typeof value === 'string') {
        const resolved = resolveValue(queryResults, contextStack, value)
        return resolved
      }

      // Set up a function prepared to receive context from the calling service
      // {type: 'function'} args are now just responsible for calling with (ctx)
      if (typeof value === 'function') {
        return (ctx) => {
          return value(queryResults, contextStack.extend(ctx))
        }
      }

      // is it a chain?
      if (Array.isArray(value) && _.every(value, v => typeof v === 'function')) {
        return async (ctx) => {
          // we need to push two layers of stack for the `fn` and the `chain`
          // @ will refer to chain, @@ will refer to fn
          const chainStack = contextStack.extend(ctx).extend(null)
          for (const fn of value) {
            chainStack.setCurrent(await fn(queryResults, chainStack))
          }
          return chainStack.getCurrent()
        }
      }

      // Let cloneDeepWith handle objects and arrays recursively
      return undefined
    })
    //console.log(`withArgs for [${queryName} - ${serviceName}:${action}] resolved as:`, resolvedArgs)

    return await fn.call(this, resolvedArgs)
  }
}

const withDebug = (fn) => {
  return async function (args) {
    //console.log('withDebug this:', this)
    const {queryName, serviceName, action, settings} = this
    const startTime = Date.now()
    const [color, reset] = getServiceColor(serviceName)

    if (settings.debug) {
      const printArgs = inspect(args, settings.inspect)
      utilService.print({on: `${color}[${queryName} - ${serviceName}:${action}] Called with args:\n${printArgs}${reset}`, settings})
    }

    // no try/catch - let errors be handled by withError
    const result = await fn.call(this, args)

    if (settings.debug) {
      const duration = Date.now() - startTime
      const printResult = inspect(result, settings.inspect)
      utilService.print({on: `${color}[${queryName} - ${serviceName}:${action}] Completed in ${duration}ms returning:\n${printResult}${reset}`, settings})
    }

    return result
  }
}

const withTimeout = (fn) => {
  return async function (args) {
    //console.log('withTimeout this:', this)
    const {timeout} = this.settings

    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Timed out after ${timeout}ms`))
      }, timeout)
    })

    return Promise.race([fn.call(this, args), timeoutPromise])
  }
}

const withRetry = (fn) => {
  return async function (args) {
    //console.log('withRetry this:', this)
    const retry = this.settings.retry || 0

    let lastError

    for (let attempt = 1; attempt <= retry + 1; attempt++) {
      try {
        return await fn.call(this, args)
      } catch (error) {
        lastError = error

        if (attempt <= retry) {
          console.error(
            `Failed (attempt ${attempt}/${retry + 1}), retrying...`
          )
        }
      }
    }

    throw lastError
  }
}

const withErrorHandling = (fn) => {
  return async function (args) {
    //console.log('withErrorHandling this:', this)
    const {queryName, serviceName, action, settings, queryResults, contextStack} = this

    try {
      return await fn.call(this, args)
    } catch (error) {
      error.message = `[${queryName} - ${serviceName}:${action}] ${error.message}`
      error.queryName = queryName
      error.serviceName = serviceName
      error.action = action
      error.args = args

      // Handle with onError if provided
      if (settings.onError) {
        const errorContextStack = contextStack.extend(error)
        try {
          return settings.onError(queryResults, errorContextStack)

        } catch (handlerError) {
          // Error handler failed
          if (!settings.ignoreErrors) {
            const errorMessage = typeof handlerError === 'string' ? handlerError : handlerError.message
            throw new Error(`[${serviceName}:${action}] onError handler failed: ${errorMessage}`)
          }
        }
      }

      // Re-throw original error
      if (!settings.ignoreErrors) {
        throw error
      }

      return null
    }
  }
}

const applyWrappers = (def, config) => {
  const {queryName, serviceName, action, args, settings} = def

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

  wrappers.push(withErrorHandling)

  if (settings.retry > 0) {
    wrappers.push(withRetry)
  }
  if (settings.timeout && settings.timeout > 0) {
    wrappers.push(withTimeout)
  }

  //console.log('wrappers:', wrappers.map(f => f.name))

  // Apply all wrappers using functional composition
  const wrapped = wrappers.reduceRight((fn, wrapper) => wrapper(fn), serviceCall)

  // give all wrappers access to the full calling context so they don't have to fish for it
  // allow the contextStack to be passed at execution time
  return (queryResults, contextStack) =>
    wrapped.call({queryName, serviceName, action, settings, queryResults, contextStack}, args)
}

export default applyWrappers
