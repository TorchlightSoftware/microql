import _ from 'lodash'
import resolveValue from './resolve.js'
import {getServiceColorName} from './common.js'
import {inspect} from 'util'

import utilService from './services/util.js'
import {validate} from './validation.js'

const withArgs = (fn) => {
  return async function (args = {}) {
    let {queryResults, contextStack} = this

    const resolveArg = (value) => {

      // Recursively resolve all @ and $ references in the arguments
      if (typeof value === 'string') {
        const resolved = resolveValue(queryResults, contextStack, value)
        return resolved
      }

      // Set up a service prepared to receive context from the calling service
      if (typeof value === 'function') {
        return (ctx) => {
          return value(queryResults, contextStack.extend(ctx))
        }
      }

      // is it a chain?
      if (
        Array.isArray(value) &&
        value.length > 0 &&
        _.every(value, v => typeof v === 'function')
      ) {
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
    }

    const resolvedArgs = _.cloneDeepWith(args, resolveArg)
    this.settings.onError = resolveArg(this.settings.onError)

    return await fn.call(this, resolvedArgs)
  }
}

const withDebug = (fn) => {
  return async function (args) {
    const {queryName, serviceName, action, settings} = this
    const startTime = Date.now()
    const color = getServiceColorName(serviceName)

    if (settings.debug) {
      const printArgs = inspect(args, settings.inspect)
      utilService.print({on: `[${queryName} - ${serviceName}:${action}] Called with args:\n${printArgs}`, settings, color})
    }

    // no try/catch - let errors be handled by withError
    const result = await fn.call(this, args)

    if (settings.debug) {
      const duration = Date.now() - startTime
      const printResult = inspect(result, settings.inspect)
      utilService.print({on: `[${queryName} - ${serviceName}:${action}] Completed in ${duration}ms returning:\n${printResult}`, settings, color})
    }

    return result
  }
}

const withCache = (fn) => async function (args) {
  const {serviceName, action, cache} = this

  // getOrCompute internally eliminates race conditions between cache, memory, disk,
  // and concurrent calls
  return await cache.getOrCompute(serviceName, action, args, fn.bind(this, args))
}

const withRateLimit = (fn) => async function (args) {
  return this.rateLimit.push(fn.bind(this, args))
}

const withRetry = (fn) => {
  return async function (args) {
    const {queryName, serviceName, action} = this
    const retry = this.settings.retry || 0

    let lastError

    for (let attempt = 1; attempt <= retry + 1; attempt++) {
      try {
        return await fn.call(this, args)
      } catch (error) {
        lastError = error

        if (attempt <= retry) {
          console.error(
            `[${queryName} - ${serviceName}:${action}] Failed (attempt ${attempt}/${retry + 1}), retrying...`
          )
        }
      }
    }

    throw lastError
  }
}

const withTimeout = (fn) => {
  return async function (args) {
    const {timeout} = this.settings
    let timeoutId

    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error(`Timed out after ${timeout}ms`))
      }, timeout)
    })

    try {
      return await Promise.race([fn.call(this, args), timeoutPromise])
    } finally {
      clearTimeout(timeoutId)
    }
  }
}


const withErrorHandling = (fn) => {
  return async function (args) {
    const {queryName, serviceName, action, settings} = this

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
        try {
          const result = settings.onError(error)
          if (settings.ignoreErrors) return result

        } catch (handlerError) {
          const errorMessage = `[${serviceName}:${action}] onError handler failed: ${handlerError.message}`
          console.warn(errorMessage)
          // Error handler failed
          if (!settings.ignoreErrors) {
            throw new Error(errorMessage)
          }
        }
      }

      if (settings.ignoreErrors) {
        return null
        // return error //should we?
      }

      // Re-throw original error
      throw error
    }
  }
}

const withValidation = (fn) => {
  return async function (args) {
    const {validators, settings} = this

    function runValidator(args, order, designation) {
      const schema = validators[order][designation]
      if (!schema) return
      try {
        validate(schema, args, settings)
      } catch (error) {
        error.message = `${designation} ${order} validation failed:\n${error.message}`
        throw error
      }
    }

    // Run prechecks
    runValidator(args, 'precheck', 'query')
    runValidator(args, 'precheck', 'service')

    // Execute the actual service function
    const result = await fn.call(this, args)

    // Run postchecks
    runValidator(result, 'postcheck', 'service')
    runValidator(result, 'postcheck', 'query')

    return result
  }
}

const applyWrappers = (def, config) => {
  const {queryName, serviceName, action, args, settings, validators, rateLimit, noTimeout} = def
  const {cache} = config

  const service = config.services[serviceName]

  // `this` context is preserved so service can call other sibling services
  const serviceCall = service[action].bind(service)

  // Build wrapper array in canonical order
  // We use reduceRight on these wrappers, so they get applied last-first,
  // and when they execute, they execute in the order listed here.
  const wrappers = []

  // 1. withArgs - resolves @ and $ references (outermost, called first)
  wrappers.push(withArgs)

  if (settings.debug) {
    wrappers.push(withDebug)
  }

  wrappers.push(withErrorHandling)

  if (settings.cache) {
    wrappers.push(withCache)
  }
  // Add validation wrapper if validators are defined
  if (validators) {
    wrappers.push(withValidation)
  }
  if (rateLimit) {
    wrappers.push(withRateLimit)
  }
  if (settings.retry > 0) {
    wrappers.push(withRetry)
  }
  // Apply timeout wrapper unless _noTimeout is set AND no explicit timeout is provided
  if (settings?.timeout > 0 && (!noTimeout || args.timeout !== undefined)) {
    wrappers.push(withTimeout)
  }
  //console.log('wrappers:', wrappers.map(f => f.name))

  // Apply all wrappers using functional composition
  const wrapped = wrappers.reduceRight((fn, wrapper) => wrapper(fn), serviceCall)

  // give all wrappers access to the full calling context so they don't have to fish for it
  // allow the contextStack to be passed at execution time
  return (queryResults, contextStack) =>
    wrapped.call({queryName, serviceName, action, settings, validators, queryResults, contextStack, rateLimit, cache}, args)
}

export default applyWrappers
