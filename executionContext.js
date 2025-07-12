/**
 * @fileoverview Execution context for MicroQL query execution
 * 
 * Provides a unified context object for query execution environment,
 * replacing long argument lists with a clean context pattern.
 */

/**
 * Execution context for MicroQL query processing
 * Contains all the shared state needed for query execution
 */
export class ExecutionContext {
  constructor(config = {}) {
    this.services = config.services || {}
    this.source = config.source || {}
    this.chainStack = config.chainStack || []
    this.querySettings = config.querySettings || {}
    this.debugPrinter = config.debugPrinter || null
    this.queryName = config.queryName || null
    this.usedServices = config.usedServices || new Set()
  }

  /**
   * Get timeout settings with fallback chain
   */
  getTimeout(serviceName, argTimeout) {
    if (argTimeout !== undefined && argTimeout !== null) {
      return argTimeout
    }
    
    // Service-specific timeout
    if (this.querySettings.timeout?.[serviceName] !== undefined) {
      return this.querySettings.timeout[serviceName]
    }
    
    // Default timeout
    if (this.querySettings.timeout?.default !== undefined) {
      return this.querySettings.timeout.default
    }
    
    return null
  }

  /**
   * Get retry count with fallback
   */
  getRetry(argRetry) {
    if (argRetry !== undefined && argRetry !== null) {
      return argRetry
    }
    
    return this.querySettings.retry?.default || 0
  }

  /**
   * Check if debug mode is enabled
   */
  get debug() {
    return this.querySettings.debug || false
  }

  /**
   * Get inspect settings
   */
  get inspect() {
    return this.querySettings.inspect || {}
  }

  /**
   * Track service usage for tearDown
   */
  trackService(serviceName) {
    this.usedServices.add(serviceName)
  }

  /**
   * Create a new context with overrides
   */
  with(overrides) {
    return new ExecutionContext({
      services: this.services,
      source: this.source,
      chainStack: this.chainStack,
      querySettings: this.querySettings,
      debugPrinter: this.debugPrinter,
      queryName: this.queryName,
      usedServices: this.usedServices,
      ...overrides
    })
  }
}