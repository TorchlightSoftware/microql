/**
 * @fileoverview Errors as data — a failure once it is a value.
 *
 * A service fails by throwing, and the failure travels as a thrown Error until
 * a `catch` handles it. There it becomes data: `@err` inside the handler, and
 * whatever the handler returns in the failed call's place. The form is
 * zodly's `error` type, a JSON-LD node of type Error:
 *
 *   {'@type': 'Error', name, message, cause, address, key, queryHash, formHash, args}
 *
 * plain JSON, so it survives a Run State or a Cache on disk. Its fields are
 * the Error's own: `name`, `message`, `cause` (the error behind it, in the
 * same form), and whatever MicroQL labelled it with — `address` and `key`
 * name the call that raised it, `queryHash` the Query version it ran in (an
 * address means something only against it), `formHash` that call's own form
 * hash (its key in the Run State and the Cache), and `args` what it was
 * given. `[util]/throw` turns it back into an Error.
 */

import {errorSchema} from './zodly.js'

export {errorSchema}

export const isErrorData = (value) => errorSchema.safeParse(value).success

// Whatever was thrown, as error data: an Error by its name, message, cause
// and own fields; anything else by its text.
export function toErrorData(thrown) {
  if (isErrorData(thrown)) return thrown
  if (!(thrown instanceof Error)) return {'@type': 'Error', name: 'Error', message: String(thrown)}
  const {name, message, cause} = thrown
  return {'@type': 'Error', name, message, ...thrown, ...(cause !== undefined && {cause: toErrorData(cause)})}
}

// Error data as an Error again, carrying the same fields; a cause in the same
// form becomes an Error too.
export function fromErrorData({'@type': _type, name, message, cause, ...fields}) {
  const options = cause === undefined ? undefined : {cause: isErrorData(cause) ? fromErrorData(cause) : cause}
  return Object.assign(new Error(message, options), {name, ...fields})
}
