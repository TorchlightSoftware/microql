const _ = require('lodash')
_.mixin(require('lodash-deep'))

const async = require('async')
const torch = require('torch')

const retrieve = require('./retrieve')
const guard = require('./guard')

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

// this runs at 'run time' for each job and interpolates dependencies into the job arguments
const mergeArgs = (args, source) => {
  return _.deepMapValues(args, (value, path) => {
    let m = (typeof value === 'string') && value.match(DEP_REGEX)
    return m ? retrieve(value, source) : value
  })
}

module.exports = function query(config, done) {
  const {services, input, jobs, defaultTimeout, select} = config
  const debug = (...args) => config.debug ? torch.gray(...args) : null
  const debugAlt = (...args) => config.debug ? torch.white(...args) : null

  const tasks = {}

  // add dummy functions to inject input
  if (input) {
    tasks.input = (next) => next(null, input)
  }

  // add jobs
  _.forIn(jobs, (descriptor, name) => {

    // add an alias job
    let m = (typeof descriptor === 'string') && descriptor.match(DEP_REGEX)
    if (m) {
      let retriever = (results, next) => next(null, retrieve(descriptor, results))
      tasks[name] = [m[1], retriever]
      return
    }

    // look for optional orchestrator settings
    var maybeConvertError = (error, result) => [error, result]
    var timeout = defaultTimeout
    var orchSettings
    if (Array.isArray(descriptor) && (orchSettings = descriptor[3]) && typeof orchSettings === 'object') {

      // onError config
      switch (orchSettings.onError) {
        case 'convertToObject':
          maybeConvertError = (error, result) => {
            if (error) {
              result = {error: error.message, stack: error.stack}
              error = null
            }
            return [error, result]
          }
          break
      }

      // timeout config
      if (orchSettings.timeout) timeout = orchSettings.timeout
    }

    // add a service job
    const [serviceName, action, args] = descriptor
    const deps = getDeps(args)

    if (typeof services[serviceName] !== 'function') {
      throw new Error(`A job references ${serviceName}.${action} but the '${serviceName}' service was not provided.`)
    }

    // add the job to the end of the dependencies list
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

module.exports.mergeArgs = mergeArgs
