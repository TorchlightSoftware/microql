// Arguments that configure a call rather than feed it data.
const RESERVE_ARGS = ['timeout', 'retry', 'onError', 'ignoreErrors', 'precheck', 'postcheck', 'debug', 'cache']

// The two kinds of validation a call runs, by the key they are filed under,
// with the names the docs and error messages use: the Query author's checks
// on one call, and the service's own schemas.
const VALIDATION_NAMES = {call: 'Service Call Validation', schema: 'Service Schema Validation'}

// Colour names assigned to services for debug output; the runtime decides how
// a colour is shown.
const COLOR_NAMES = ['green', 'yellow', 'blue', 'magenta', 'cyan', 'white']

const serviceColors = new Map()
const getServiceColorName = (serviceName) => {
  if (!serviceColors.has(serviceName)) {
    serviceColors.set(serviceName, COLOR_NAMES[serviceColors.size % COLOR_NAMES.length])
  }
  return serviceColors.get(serviceName)
}

// A plain object, as written in a Query or parsed from JSON — not an instance
// of a class. Cheaper than lodash's, which stringifies the constructor.
const isPlainObject = (value) => {
  if (typeof value !== 'object' || value === null) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

// Plain-data helpers over an object's own enumerable keys. None mutates its input.

// The object with each value replaced by fn(value, key). A loop, not
// entries → map → fromEntries: it runs on every argument resolution.
const mapValues = (object, fn) => {
  const result = {}
  for (const key of Object.keys(object)) result[key] = fn(object[key], key)
  return result
}

// The object's entries for which keep(value, key) holds.
const filterObject = (object, keep) =>
  Object.fromEntries(Object.entries(object).filter(([key, value]) => keep(value, key)))

// The named keys the object has, in the order named.
const pick = (object, keys) =>
  Object.fromEntries(keys.filter(key => Object.hasOwn(object, key)).map(key => [key, object[key]]))

const omit = (object, keys) => filterObject(object, (_value, key) => !keys.includes(key))

// The value at a path of keys; undefined once the path runs out of values.
const getIn = (value, path) => path.reduce((at, key) => at?.[key], value)

// One object from several: for each key, the first source's defined value wins.
const defaults = (...sources) => {
  const result = {}
  for (const source of sources) {
    for (const [key, value] of Object.entries(source ?? {})) {
      if (result[key] === undefined) result[key] = value
    }
  }
  return result
}

export {RESERVE_ARGS, VALIDATION_NAMES, COLOR_NAMES, getServiceColorName, isPlainObject, mapValues, filterObject, pick, omit, getIn, defaults}
