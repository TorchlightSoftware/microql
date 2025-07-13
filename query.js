/**
 * @fileoverview MicroQL Query Engine - Main Entry Point
 * 
 * Coordinates compilation and execution of MicroQL queries with clean separation
 * between compile-time transformations and runtime execution.
 */

import { compileQuery } from './compileQuery.js'
import { executeAST } from './execute.js'
import utilService from './util.js'

/**
 * Default error handler that prints errors and exits
 */
const defaultErrorHandler = (error, context, settings) => {
  const errorMessage = error.stack || error.message || error
  console.error('\x1b[31m%s\x1b[0m', `Error during ${context}: ${errorMessage}`)
  
  if (!settings?.debug) {
    console.error('\x1b[33m%s\x1b[0m', 'Tip: Run with debug: true for more details')
  }
  
  process.exit(1)
}

/**
 * Prepare services by auto-wrapping and adding util
 */
const prepareServices = (services = {}) => {
  const prepared = { ...services }
  
  // Auto-wrap plain objects as services
  for (const [name, service] of Object.entries(prepared)) {
    if (typeof service === 'object' && service !== null && !Array.isArray(service)) {
      // Already an object with methods, keep as-is
      prepared[name] = service
    }
  }
  
  // Add util service if not provided
  if (!prepared.util) {
    prepared.util = utilService
  }
  
  return prepared
}

/**
 * Call tearDown on services that were used
 */
const callTearDownOnUsedServices = async (usedServices, services, settings) => {
  for (const serviceName of usedServices) {
    const service = services[serviceName]
    if (service && typeof service.tearDown === 'function') {
      try {
        await service.tearDown()
      } catch (error) {
        if (settings?.debug) {
          console.error(`Warning: tearDown failed for service ${serviceName}:`, error.message)
        }
      }
    }
  }
}

/**
 * Main query execution function
 * @param {Object} config - MicroQL configuration
 * @returns {*} Query results
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
    debug: settings.debug,
    retry: settings.retry
  }
  
  // Prepare services
  const preparedServices = prepareServices(services)
  
  // Track which services are actually used for tearDown
  const usedServices = new Set()
  
  // Hook to track service usage
  const originalServiceCall = (serviceName) => {
    usedServices.add(serviceName)
  }
  
  // Create configuration for compilation
  const compileConfig = {
    services: preparedServices,
    query: queries,
    given,
    settings: resolvedSettings,
    methods
  }
  
  try {
    // Phase 1: Compile queries into AST
    const ast = compileQuery(compileConfig)
    
    // Hook service tracking into AST
    for (const queryNode of Object.values(ast.queries)) {
      const trackUsage = (node) => {
        if (node.type === 'service' && node.serviceName) {
          const originalFn = node.wrappedFunction
          node.wrappedFunction = async function() {
            usedServices.add(this.serviceName || node.serviceName)
            return await originalFn.apply(this, arguments)
          }
        } else if (node.type === 'chain') {
          node.steps.forEach(trackUsage)
        }
      }
      trackUsage(queryNode)
    }
    
    // Phase 2: Execute the AST
    let results
    
    // Load snapshot if provided
    if (snapshotFile) {
      try {
        const fs = await import('fs-extra')
        if (await fs.default.pathExists(snapshotFile)) {
          const snapshotData = JSON.parse(await fs.default.readFile(snapshotFile, 'utf8'))
          if (snapshotData.results) {
            results = snapshotData.results
            if (resolvedSettings.debug) {
              console.log(`📸 Loaded results from snapshot: ${snapshotFile}`)
            }
          }
        }
      } catch (error) {
        if (resolvedSettings.debug) {
          console.error(`Warning: Failed to load snapshot from ${snapshotFile}:`, error.message)
        }
      }
    }
    
    // Execute if no snapshot or snapshot failed
    if (!results) {
      results = await executeAST(ast, given, select)
      
      // Save snapshot if requested
      if (snapshotFile) {
        try {
          const fs = await import('fs-extra')
          await fs.default.outputJson(snapshotFile, {
            timestamp: new Date().toISOString(),
            results
          }, { spaces: 2 })
          if (resolvedSettings.debug) {
            console.log(`📸 Saved snapshot to: ${snapshotFile}`)
          }
        } catch (error) {
          console.error(`Warning: Failed to save snapshot to ${snapshotFile}:`, error.message)
        }
      }
    }
    
    // Call tearDown on all used services
    await callTearDownOnUsedServices(usedServices, preparedServices, resolvedSettings)
    
    return results
    
  } catch (error) {
    // Handle query-level errors
    if (queryOnError && Array.isArray(queryOnError)) {
      try {
        // Create error context
        const errorContext = {
          error: error.message,
          originalError: error,
          queryName: error.queryName,
          query: queries
        }
        
        // Compile and execute error handler
        const errorHandlerConfig = {
          services: preparedServices,
          query: { errorHandler: queryOnError },
          given: errorContext,
          settings: resolvedSettings
        }
        
        const errorAst = compileQuery(errorHandlerConfig)
        await executeAST(errorAst, errorContext, 'errorHandler')
        
      } catch (onErrorErr) {
        console.error(`Query-level onError handler failed: ${onErrorErr.message}`)
      }
    } else {
      // Default error handling
      defaultErrorHandler(error, 'query execution', resolvedSettings)
    }
    
    // Call tearDown even if query fails
    await callTearDownOnUsedServices(usedServices, preparedServices, resolvedSettings)
    
    // Re-throw the error
    throw error
  }
}

// For backward compatibility, also export as microql
export { query as microql }