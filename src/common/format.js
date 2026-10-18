/**
 * @fileoverview format — a value as text, the same on every runtime.
 *
 * Pure: what `[util]/format`, `[util]/inspect`, `[util]/log`, debug output
 * and validation messages all show. Options are the Query's `inspect`
 * settings:
 *
 *   depth            how many levels of nesting are shown (default 2)
 *   maxArrayLength   how many items of a list are shown (default 100)
 *   maxStringLength  how many characters of a string are shown (default 10000)
 *
 * A string on its own is shown as it is; inside a structure it's quoted.
 * Fields beginning with `_` are hidden. An error, thrown or as data, is shown
 * as `name: message`, then its args and cause.
 */

import {isPlainObject, defaults} from './common.js'
import {isErrorData, toErrorData} from '../execute/errors.js'

const DEFAULTS = {depth: 2, maxArrayLength: 100, maxStringLength: 10000}

// A structure fits on one line up to this width; past it, one entry per line.
const LINE_WIDTH = 72

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/

const truncate = (text, max) => text.length > max ? `${text.slice(0, max)}... ${text.length - max} more characters` : text

const keyText = (key) => IDENTIFIER.test(key) ? key : JSON.stringify(key)

const indent = (text) => text.replaceAll('\n', '\n  ')

// Entries between brackets: on one line when short, else one per line.
function bracketed(open, entries, close) {
  if (!entries.length) return `${open}${close}`
  const line = `${open}${entries.join(', ')}${close}`
  if (line.length <= LINE_WIDTH && !line.includes('\n')) return line
  return `${open}\n  ${entries.map(indent).join(',\n  ')}\n${close}`
}

function formatError({name, message, args, cause}, options, level) {
  const details = [
    args !== undefined && `args: ${formatValue(args, options, level + 1)}`,
    cause !== undefined && `cause: ${formatError(cause, options, level + 1)}`
  ].filter(Boolean)
  return [`${name}: ${message}`, ...details].join('\n  ')
}

function formatList(list, options, level) {
  if (level > options.depth) return '[Array]'
  const shown = list.slice(0, options.maxArrayLength).map(item => formatValue(item, options, level + 1))
  const more = list.length - shown.length
  return bracketed('[', more > 0 ? [...shown, `... ${more} more items`] : shown, ']')
}

function formatObject(object, options, level) {
  if (level > options.depth) return '[Object]'
  const entries = Object.entries(object).filter(([key]) => !key.startsWith('_'))
  return bracketed('{', entries.map(([key, value]) => `${keyText(key)}: ${formatValue(value, options, level + 1)}`), '}')
}

function formatValue(value, options, level) {
  if (typeof value === 'string') return JSON.stringify(truncate(value, options.maxStringLength))
  if (value instanceof Error || isErrorData(value)) return formatError(toErrorData(value), options, level)
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'function') return '[Function]'
  if (Array.isArray(value)) return formatList(value, options, level)
  if (isPlainObject(value)) return formatObject(value, options, level)
  return String(value)
}

export function format(value, options = {}) {
  const settings = defaults(options, DEFAULTS)
  return typeof value === 'string' ? truncate(value, settings.maxStringLength) : formatValue(value, settings, 0)
}
