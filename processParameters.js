/**
 * @fileoverview Parameter processing for MicroQL services
 * 
 * Handles compilation of function, template, and settings parameters
 * with proper type detection and transformation.
 */

import { resolveArgsWithContext } from './query.js'

/**
 * Deep merge utility for settings
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
 * Parameter type handlers
 */
const paramHandlers = {
  function: (key, value, context) => {
    return compileServiceFunction(value, context)
  },
  
  template: (key, value, context) => {
    return async (iterationItem) => {
      const newChainStack = [iterationItem, ...context.chainStack]
      return resolveArgsWithContext(value, context.source, newChainStack)
    }
  },
  
  settings: (key, value, context) => {
    // If no value provided, use query settings directly
    // If value provided, merge with query settings
    return value ? deepMerge(context.querySettings, value) : context.querySettings
  }
}

/**
 * Get service method metadata for parameter compilation
 */
function getParameterMetadata(service, action) {
  if (typeof service === 'function' && service._originalService) {
    // This is a wrapped service object, get metadata from the original
    return service._originalService[action]?._params || {}
  } else if (typeof service === 'object') {
    // Direct service object access
    const serviceMethod = service[action]
    return serviceMethod?._params || {}
  }
  return {}
}

/**
 * Process service parameters with type-aware compilation
 */
export function processParameters(args, service, action, context) {
  const paramMetadata = getParameterMetadata(service, action)
  
  // Build set of parameters that should skip resolution
  const skipParams = new Set()
  const specialParams = {}
  
  // Add reserved MicroQL parameters to skip list
  skipParams.add('timeout')
  skipParams.add('retry')
  skipParams.add('onError')
  skipParams.add('ignoreErrors')
  
  // First pass: identify special parameters
  for (const [key, value] of Object.entries(args)) {
    const paramInfo = paramMetadata[key]
    const paramType = paramInfo?.type
    
    if (paramType && paramHandlers[paramType]) {
      specialParams[key] = { type: paramType, value }
      skipParams.add(key)
    }
  }
  
  // Auto-inject settings parameter if defined in metadata but not in args
  // This is specifically for the settings type only
  for (const [key, paramInfo] of Object.entries(paramMetadata)) {
    if (paramInfo?.type === 'settings' && !(key in args)) {
      specialParams[key] = { type: 'settings', value: undefined }
      skipParams.add(key)
    }
  }
  
  // Resolve regular arguments while skipping special parameters
  const finalArgs = resolveArgsWithContext(args, context.source, context.chainStack, skipParams)
  
  // Second pass: process special parameters
  for (const [key, { type, value }] of Object.entries(specialParams)) {
    const handler = paramHandlers[type]
    if (handler) {
      finalArgs[key] = handler(key, value, context)
    }
  }
  
  return finalArgs
}

/**
 * Forward declaration - will be set by query.js to avoid circular dependency
 */
let compileServiceFunction = null

export function setCompileServiceFunction(fn) {
  compileServiceFunction = fn
}