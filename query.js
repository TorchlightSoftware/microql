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
  
  // Service usage tracking is handled by AST execution state
  
  
  // Create configuration for compilation
  const compileConfig = {
    services: preparedServices,
    query: queries,
    given,
    settings: resolvedSettings,
    methods
  }
  
  // Phase 1: Compile queries into AST (let compilation errors propagate)
  const ast = compileQuery(compileConfig)
  
  // Service tracking will be done by the execution engine using ast.execution.usedServices
  
  try {
    // Phase 2: Execute the AST (only catch execution errors)
    let results
    
    // Load snapshot if provided
    if (snapshotFile) {
      try {
        const fs = await import('fs-extra')
        if (await fs.default.pathExists(snapshotFile)) {
          const snapshotData = JSON.parse(await fs.default.readFile(snapshotFile, 'utf8'))
          if (snapshotData.ast) {
            // Restore AST state from snapshot (excluding usedServices)
            const snapshotAst = snapshotData.ast
            
            // Restore query states
            for (const [queryName, queryData] of Object.entries(snapshotAst.queries)) {
              if (ast.queries[queryName]) {
                ast.queries[queryName].value = queryData.value
                ast.queries[queryName].completed = queryData.completed
                
                // For chains, restore step states by matching service/action
                if (queryData.type === 'chain' && queryData.steps && ast.queries[queryName].steps) {
                  let allStepsMatched = true
                  let restoredSteps = 0
                  
                  for (const savedStep of queryData.steps) {
                    // Find matching step in current chain by service/action
                    const matchingStep = ast.queries[queryName].steps.find(step => 
                      step.serviceName === savedStep.serviceName && 
                      step.action === savedStep.action
                    )
                    
                    if (matchingStep && savedStep.completed) {
                      matchingStep.value = savedStep.value
                      matchingStep.completed = savedStep.completed
                      restoredSteps++
                    } else if (!matchingStep) {
                      allStepsMatched = false
                    }
                  }
                  
                  // If chain structure changed (new steps added), reset chain completion
                  if (!allStepsMatched || ast.queries[queryName].steps.length > queryData.steps.length) {
                    ast.queries[queryName].completed = false
                    ast.queries[queryName].value = null
                  }
                }
              }
            }
            
            if (resolvedSettings.debug) {
              console.log(`📸 Loaded AST state from snapshot: ${snapshotFile}`)
            }
          }
        }
      } catch (error) {
        if (resolvedSettings.debug) {
          console.error(`Warning: Failed to load snapshot from ${snapshotFile}:`, error.message)
        }
      }
    }
    
    // Execute AST (handles partial execution automatically)
    results = await executeAST(ast, given, select)
    
    // Save snapshot if requested
    if (snapshotFile) {
      try {
        const fs = await import('fs-extra')
        
        // Create a clean AST for saving (without circular references)
        const astForSnapshot = {
          queries: {},
          executionOrder: ast.executionOrder,
          services: undefined, // Don't save services - they contain functions
          settings: ast.settings,
          usedServices: undefined // Don't save usedServices - it's session-specific
        }
        
        // Copy query states without circular references
        for (const [queryName, queryNode] of Object.entries(ast.queries)) {
          astForSnapshot.queries[queryName] = {
            type: queryNode.type,
            reference: queryNode.reference,
            value: queryNode.value,
            completed: queryNode.completed,
            dependencies: queryNode.dependencies
          }
          
          // For chains, copy step states
          if (queryNode.type === 'chain' && queryNode.steps) {
            astForSnapshot.queries[queryName].steps = queryNode.steps.map(step => ({
              type: step.type,
              serviceName: step.serviceName,
              action: step.action,
              value: step.value,
              completed: step.completed
            }))
          }
        }
        
        await fs.default.outputJson(snapshotFile, {
          timestamp: new Date().toISOString(),
          ast: astForSnapshot
        }, { spaces: 2 })
        if (resolvedSettings.debug) {
          console.log(`📸 Saved AST snapshot to: ${snapshotFile}`)
        }
      } catch (error) {
        console.error(`Warning: Failed to save snapshot to ${snapshotFile}:`, error.message)
      }
    }
    
    // Call tearDown on all used services
    await callTearDownOnUsedServices(ast.usedServices, preparedServices, resolvedSettings)
    
    return results
    
  } catch (error) {
    // Handle execution-level errors only (not compilation errors)
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
    }
    
    // Call tearDown even if query fails
    await callTearDownOnUsedServices(ast.usedServices, preparedServices, resolvedSettings)
    
    // Re-throw the error
    throw error
  }
}

// For backward compatibility, also export as microql
export { query as microql }