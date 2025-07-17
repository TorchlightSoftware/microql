/**
 * @fileoverview MicroQL Settings Injection System
 * 
 * Handles automatic injection of query-level settings into service arguments
 * when services declare arguments with 'settings' type in their _argtypes.
 */

/**
 * Extract service-specific timeout configuration
 * @param {string} serviceName - Name of the service
 * @param {Object} settings - Settings configuration object
 * @param {number} defaultTimeout - Fallback timeout value
 * @returns {number} Timeout value for the service
 */
export function getServiceTimeout(serviceName, settings, defaultTimeout) {
  if (settings && settings.timeout) {
    return settings.timeout[serviceName] || settings.timeout.default || defaultTimeout
  }
  return defaultTimeout
}

/**
 * Extract debug setting from configuration
 * @param {Object} settings - Settings configuration object
 * @returns {boolean} Whether debug is enabled
 */
export function getDebugSetting(settings) {
  return settings && settings.debug
}

/**
 * Extract inspect settings for util.inspect formatting
 * @param {Object} settings - Settings configuration object
 * @returns {Object} Inspect settings object
 */
export function getInspectSettings(settings) {
  return settings && settings.inspect ? settings.inspect : {}
}

/**
 * Check if an argument should receive settings injection
 * @param {string} argName - Name of the argument
 * @param {Object} argtypes - Service method's _argtypes metadata
 * @returns {boolean} Whether this argument expects settings injection
 */
export function shouldInjectSettings(argName, argtypes) {
  return argtypes && argtypes[argName] === 'settings'
}

/**
 * Inject settings into service arguments based on _argtypes metadata
 * @param {Object} args - Service arguments
 * @param {Object} argtypes - Service method's _argtypes metadata  
 * @param {Object} settings - Query-level settings to inject
 * @returns {Object} Arguments with settings injected where appropriate
 */
export function injectSettings(args, argtypes, settings) {
  if (!settings || !argtypes || !args) {
    return args
  }

  const injectedArgs = {...args}

  // Check each argument in argtypes for 'settings' type
  for (const [argName, argType] of Object.entries(argtypes)) {
    if (argType === 'settings') {
      // Only inject if the argument wasn't explicitly provided
      if (!injectedArgs.hasOwnProperty(argName)) {
        injectedArgs[argName] = settings
      }
    }
  }

  return injectedArgs
}

/**
 * Compile settings arguments - handles 'settings' type in _argtypes
 * This extends the existing compileArgs logic to handle settings injection markers
 * @param {Object} args - Raw arguments from query
 * @param {Object} argtypes - Service method's _argtypes metadata
 * @returns {Object} Compiled arguments with settings injection markers
 */
export function compileSettingsArgs(args, argtypes) {
  if (!argtypes) {
    return args
  }

  const compiled = {...args}

  // Mark arguments that need settings injection during execution
  for (const [argName, argType] of Object.entries(argtypes)) {
    if (argType === 'settings' && !compiled.hasOwnProperty(argName)) {
      // Add a marker that will be resolved during execution
      compiled[argName] = {_type: 'inject_settings'}
    }
  }

  return compiled
}

/**
 * Resolve settings injection markers during execution
 * @param {Object} args - Arguments that may contain injection markers
 * @param {Object} settings - Query-level settings to inject
 * @returns {Object} Arguments with injection markers resolved to actual settings
 */
export function resolveSettingsInjection(args, settings) {
  if (!args || !settings) {
    return args
  }

  const resolved = {}

  for (const [key, value] of Object.entries(args)) {
    if (value && typeof value === 'object' && value._type === 'inject_settings') {
      // Replace injection marker with actual settings
      resolved[key] = settings
    } else {
      resolved[key] = value
    }
  }

  return resolved
}