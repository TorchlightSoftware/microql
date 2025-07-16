import _ from 'lodash'
import lodashDeep from 'lodash-deep'
_.mixin(lodashDeep)

import async from 'async'
import torch from 'torch'

import retrieve from './retrieve.js'
import guard from './guard.js'

const DEP_REGEX = /\$\.(\w+)/

// this runs at 'compile time' and determines dependencies for async.auto
const getDeps = (args) => {
  const deps = []
  _.deepMapValues(args, (value) => {
    let m = (typeof value === 'string') && value.match(DEP_REGEX)
    if (m) deps.push(m[1])
  })
  return _.uniq(deps)
}

// this runs at 'run time' for each query and interpolates dependencies into the query arguments
const mergeArgs = (args, source) => {
  return _.deepMapValues(args, (value, path) => {
    let m = (typeof value === 'string') && value.match(DEP_REGEX)
    return m ? retrieve(value, source) : value
  })
}

function query(config, done) {
  const {services, input, queries, defaultTimeout, select} = config
  const debug = (...args) => config.debug ? torch.gray(...args) : null
  const debugAlt = (...args) => config.debug ? torch.white(...args) : null

  const tasks = {}

  // add dummy functions to inject input
  if (input) {
    tasks.input = (next) => next(null, input)
  }

  // add queries
  _.forIn(queries, (descriptor, name) => {

    // look for optional orchestrator settings
    var maybeConvertError = (error, result) => [error, result]
    var timeout = defaultTimeout

    // add a service query
    const [serviceName, action, args] = descriptor
    const deps = getDeps(args)

    if (typeof services[serviceName] !== 'function') {
      throw new Error(`A query references ${serviceName}.${action} but the '${serviceName}' service was not provided.`)
    }

    // add the query to the end of the dependencies list
    deps.push(guard((results, next) => {
      const finalArgs = mergeArgs(args, results)
      debug('calling:', {serviceName, action, finalArgs})
      const fn = guard(services[serviceName].bind(null, action), timeout, `${serviceName}.${action}`)
      fn(finalArgs, (error, result) => {
        [error, result] = maybeConvertError(error, result)
        debugAlt('returned:', {serviceName, action, error, result})
        next(error, result)
      })
    }))
    tasks[name] = deps
  })

  //torch.white('running:\n', tasks)

  // run all tasks
  // http://caolan.github.io/async/docs.html#auto
  async.auto(tasks, (err, results) => {

    // select specified results if user requests
    if (Array.isArray(select)) {
      results = _.pick(results, select)
    }
    else if (typeof select === 'string') {
      results = results[select]
    }

    done(err, results)
  })
}

export default query
export { mergeArgs }
