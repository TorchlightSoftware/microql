import _ from 'lodash'

const ANSI_COLORS = {
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  reset: '\x1b[0m'
}

const COLOR_NAMES = Object.keys(ANSI_COLORS).filter(c => !['red', 'reset'].includes(c))

const DEP_REGEX = /\$\.(\w+)/
const SERVICE_REGEX = /^(\w+):(\w+)$/
const AT_REGEX = /^(@+)((\.)(.*))?$/
const BARE_DOLLAR_REGEX = /^\$$/

const serviceColors = new Map()
let colorIndex = 0
const getServiceColor = (serviceName) => {
  if (!serviceColors.has(serviceName)) {
    serviceColors.set(serviceName, COLOR_NAMES[colorIndex % COLOR_NAMES.length])
    colorIndex++
  }
  return [ANSI_COLORS[serviceColors.get(serviceName)], ANSI_COLORS.reset]
}

const getServiceColorName = (serviceName) => {
  if (!serviceColors.has(serviceName)) {
    serviceColors.set(serviceName, COLOR_NAMES[colorIndex % COLOR_NAMES.length])
    colorIndex++
  }
  return serviceColors.get(serviceName)
}

const RESERVE_ARGS = ['timeout', 'retry', 'onError', 'ignoreErrors', 'precheck', 'postcheck', 'debug', 'cache']

export {ANSI_COLORS, DEP_REGEX, SERVICE_REGEX, AT_REGEX, BARE_DOLLAR_REGEX, getServiceColor, getServiceColorName, RESERVE_ARGS}
