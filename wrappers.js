import _ from 'lodash'
import resolveValue from './resolve.js'
import {getServiceColor} from './common.js'
import {inspect} from 'util'

import utilService from './services/util.js'

const withArgs = (fn) => {
  return async function (args = {}) {
    //console.log('withArgs this:', this)
    let {queryResults, contextStack} = this

    const resolvedArgs = _.cloneDeepWith(args, (value) => {

      // Recursively resolve all @ and $ references in the arguments
      if (typeof value === 'string') {
        return resolveValue(queryResults, contextStack, value)
      }

      // Set up a function prepared to receive context from the calling service
      if (typeof value === 'function') {
        const currentStack = contextStack.extend(null)
        return (ctx) => {
          currentStack.setCurrent(ctx)
          return value(queryResults, contextStack)
        }
      }

      // Let cloneDeepWith handle objects and arrays recursively
      return undefined
    })

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
    const {settings} = this

    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Timed out after ${settings.timeout}ms`))
      }, settings.timeout)
    })

    return Promise.race([fn.call(this, args), timeoutPromise])
  }
}

const withRetry = (fn) => {
  return async function (args) {
    //console.log('withRetry this:', this)
    const {settings} = this
    const {retryCount} = settings

    let lastError

    for (let attempt = 1; attempt <= retryCount + 1; attempt++) {
      try {
        return await fn.call(this, args)
      } catch (error) {
        lastError = error

        if (attempt <= retryCount) {
          console.error(
            `Failed (attempt ${attempt}/${retryCount + 1}), retrying...`
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
    const {queryName, serviceName, action, queryResults} = this
    let {contextStack} = this

    try {
      return await fn.call(this, args)
    } catch (error) {
      error.message = `[${queryName} - ${serviceName}:${action}] ${error.message}`

      // Handle with onError if provided
      if (args.onError) {

        contextStack = contextStack.extend(null)
        const handler = (ctx) => {
          contextStack.setCurrent(ctx)
          return args.onError(queryResults, contextStack)
        }

        try {
          args.onError(handler)

        } catch (handlerError) {
          // Error handler failed
          if (!args.ignoreErrors) {
            handlerError.message = `[${serviceName}:${action}] onError handler failed: ${handlerError.message}`
            throw handlerError
          }
        }
      }

      // Re-throw original error
      if (!args.ignoreErrors) {
        throw error
      }

      return null
    }
  }
}


const applyWrappers = (def, config) => {
  const {queryName, serviceName, action, args} = def
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
  return (queryResults, contextStack) => wrapped.call({queryName, serviceName, action, settings, queryResults, contextStack}, args)
}

export default applyWrappers
