import retrieve from './retrieve.js'

const DEP_REGEX = /\$\.(\w+)/
const AT_REGEX = /^@/

/**
 * Auto-wrap service objects to make them compatible with function-based services
 */
const wrapServiceObject = (serviceObj) => {
  return async (action, args) => {
    if (typeof serviceObj[action] !== 'function') {
      throw new Error(`Service method '${action}' not found`)
    }
    return await serviceObj[action](args)
  }
}

/**
 * Prepare services by auto-wrapping objects
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
const parseMethodCall = (descriptor, methods) => {
  if (!Array.isArray(descriptor) || descriptor.length !== 3) {
    return null
  }
  
  const [dataSource, methodName, args] = descriptor
  
  // Check if it's method syntax (starts with @ or $.)
  if (!AT_REGEX.test(dataSource) && !dataSource.startsWith('$.')) {
    return null
  }
  
  // Parse service:method notation
  if (!methodName.includes(':')) {
    return null
  }
  
  const [serviceName, action] = methodName.split(':')
  
  // Verify service is in methods array
  if (!methods.includes(serviceName)) {
    return null
  }
  
  return {
    serviceName,
    action,
    dataSource,
    args: { on: dataSource, ...args }
  }
}

/**
 * Resolve @ symbols and JSONPath in arguments
 */
const resolveArgs = (args, source, chainResult = null) => {
  const resolve = (value) => {
    if (typeof value !== 'string') return value
    
    // Handle @ symbol (reference to chain result or specified path)
    if (AT_REGEX.test(value)) {
      if (value === '@') {
        return chainResult
      }
      // Handle @.field
      if (value.startsWith('@.')) {
        const path = value.replace('@', '$')
        return retrieve(path, chainResult)
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
      if (typeof value === 'object' && value !== null) {
        resolved[key] = resolveArgs(value, source, chainResult)
      } else {
        resolved[key] = resolve(value)
      }
    }
    return resolved
  }
  
  return resolve(args)
}

/**
 * Execute a single service call
 */
const executeService = async (serviceName, action, args, services, source, chainResult = null) => {
  const service = services[serviceName]
  if (!service) {
    throw new Error(`Service '${serviceName}' not found`)
  }
  
  const finalArgs = resolveArgs(args, source, chainResult)
  return await service(action, finalArgs)
}

/**
 * Execute a chain of service calls
 */
const executeChain = async (chain, services, source) => {
  let result = null
  
  for (const descriptor of chain) {
    const [serviceName, action, args] = descriptor
    result = await executeService(serviceName, action, args, services, source, result)
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
  const { services, given, query: jobs, methods = [], select } = config
  
  // Prepare services (auto-wrap objects)
  const preparedServices = prepareServices(services)
  
  const results = {}
  const tasks = new Map()
  
  // Add given data to results immediately
  if (given) {
    results.given = given
  }
  
  // Process each job to create task definitions
  for (const [jobName, descriptor] of Object.entries(jobs)) {
    
    // Handle alias jobs (simple references)
    if (typeof descriptor === 'string' && descriptor.match(DEP_REGEX)) {
      const deps = getDependencies(descriptor)
      tasks.set(jobName, {
        deps,
        execute: () => retrieve(descriptor, results)
      })
      continue
    }
    
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
      
      tasks.set(jobName, {
        deps: Array.from(allDeps),
        execute: () => executeChain(chain, preparedServices, results)
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
      
      tasks.set(jobName, {
        deps,
        execute: async () => {
          // Resolve the data source first
          const data = dataSource.startsWith('$.') ? retrieve(dataSource, results) : dataSource
          const finalArgs = { ...args, on: data }
          return await executeService(serviceName, action, finalArgs, preparedServices, results)
        }
      })
      continue
    }
    
    // Handle traditional service calls
    if (Array.isArray(descriptor) && descriptor.length >= 3) {
      const [serviceName, action, args] = descriptor
      const deps = getDependencies(args)
      
      tasks.set(jobName, {
        deps,
        execute: () => executeService(serviceName, action, args, preparedServices, results)
      })
      continue
    }
    
    throw new Error(`Invalid job descriptor for '${jobName}': ${JSON.stringify(descriptor)}`)
  }
  
  // Execute tasks in dependency order using topological sort
  const executed = new Set()
  const executing = new Map()
  
  const executeTask = async (taskName) => {
    // If already executed, return cached result
    if (executed.has(taskName)) {
      return results[taskName]
    }
    
    // If currently executing, wait for it
    if (executing.has(taskName)) {
      return await executing.get(taskName)
    }
    
    const task = tasks.get(taskName)
    if (!task) {
      // Check if it's a built-in value like 'given'
      if (taskName === 'given' && given) {
        executed.add(taskName)
        return given
      }
      throw new Error(`Task '${taskName}' not found`)
    }
    
    const promise = (async () => {
      // Execute dependencies first
      for (const depName of task.deps) {
        await executeTask(depName)
      }
      
      // Execute this task
      const result = await task.execute()
      results[taskName] = result
      executed.add(taskName)
      return result
    })()
    
    executing.set(taskName, promise)
    return await promise
  }
  
  // Execute all tasks
  const allTaskNames = Array.from(tasks.keys())
  await Promise.all(allTaskNames.map(name => executeTask(name)))
  
  // Select specified results if user requests
  if (Array.isArray(select)) {
    return Object.fromEntries(
      select.map(key => [key, results[key]])
    )
  } else if (typeof select === 'string') {
    return results[select]
  }
  
  return results
}