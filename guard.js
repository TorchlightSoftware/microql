const _ = require('lodash')
const {inspect} = require('util')

// Supply an empty object for the first param if none was provided.
// This makes the function compatible with async.auto regardless of whether dependencies were specified.
module.exports = function guard(fn, timeout, name) {
  return (...args) => {

    // ensure that fn is provided an object arg as first param
    let obj, done
    args.length > 1 ? [obj, done] = args : [obj, done] = [{}, args[0]]

    // guard with timeout if specified
    done = _.once(done)
    if (timeout) {
      setTimeout(() => done(new Error(`Function ${name || fn.name} timed out after ${timeout}ms.\nArgs: ${inspect(obj)}`)), timeout)
    }

    // run the function
    return fn(obj, done)
  }
}
