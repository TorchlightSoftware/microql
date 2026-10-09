// Arguments that configure a call rather than feed it data.
const RESERVE_ARGS = ['timeout', 'retry', 'onError', 'ignoreErrors', 'precheck', 'postcheck', 'debug', 'cache']

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

export {RESERVE_ARGS, COLOR_NAMES, getServiceColorName}
