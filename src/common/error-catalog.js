/**
 * @fileoverview The error catalog — every error MicroQL raises or reports,
 * by code.
 *
 * Each entry is a template: the HTTP status a platform answers with, the
 * cause (what went wrong, specifically), and a hint (what to do about it)
 * when there is one. Both are functions of the error's details, which the
 * error also carries as fields, for programs to read. An error that's
 * reported rather than raised, such as plan()'s type issues, has no status:
 * nothing fails with it.
 *
 * An error's message is everything a person should read:
 *
 *   <where> <cause>
 *
 *   <hint>
 *
 * `where` is the API function at fault (`execute:`, `config.set:`) or the
 * place in a Query, as its Service Call Address (`[$a.@1]`, or
 * `[$a.@1 - [svc]/res]` for a call that failed as it ran). An error raised
 * where its place isn't known gets it from whoever catches it (`locate`).
 * Programs read `code`, `status`, `baseMessage` (the message without its
 * hint), `hint` and the details, never the message.
 *
 * A cause is a sentence, ending in a period, unless it ends in details on
 * lines of their own, or zodly reads it: an error a zodly preprocessor throws
 * is reported with where in the document it was (`… on [...], at path`).
 *
 * An error that wraps another, its cause, gives the cause's base message as
 * its reason, and the cause's hint as its own when it has none.
 *
 * Errors MicroQL didn't raise (a service's own, an abort's reason) keep their
 * message, and a call that fails with one labels it with its address.
 */

const quoted = (names) => names.map(name => `'${name}'`).join(', ')

export const ERRORS = {
  // compile: the Query's grammar
  'invalid-descriptor': {status: 400, cause: ({descriptor}) => `${descriptor} is not a service descriptor.`, hint: () => 'Write a call as [\'[METHOD] [service]/resource\', {...}].'},
  'invalid-arguments': {status: 400, cause: ({key}) => `The arguments of ${key} are not an object.`},
  'retired-key': {status: 400, cause: ({retired}) => `'${retired}' is retired.`, hint: ({replacement}) => replacement},
  'raw-function': {status: 400, cause: ({key, path}) => `'${path}' of ${key} is a JavaScript function.`, hint: () => 'Hold a service descriptor there instead, as in [\'[service]/resource\', {arg: \'@\'}].'},
  'unreachable-input': {status: 400, cause: ({field}) => `The chain in '${field}' can't reach its input.`, hint: () => 'Name it with as: and reference it as @name.'},
  'misplaced-as': {status: 400, cause: ({key}) => `as: names an iteration, but ${key} takes no call.`},
  'misplaced-catch': {status: 400, cause: ({key}) => `catch: handles failures of the calls a call holds, but ${key} holds none.`, hint: () => 'To catch a single call, hold it in [util]/try.'},
  'reserved-name': {status: 400, cause: ({reserved, naming}) => `'${reserved}' is reserved, and can't name ${naming}.`},
  'duplicate-binding': {status: 400, cause: ({binding}) => `Binding name '${binding}' is used more than once.`, hint: () => 'Binding names are Query-scoped.'},
  'invalid-select': {status: 400, cause: ({select}) => `select takes references, not '${select}'.`, hint: ({select}) => `Use '$${select}'.`},
  'circular-dependency': {status: 400, cause: ({phases}) => `Phases ${quoted(phases)} depend on each other.`},
  'malformed-schema': {status: 400, cause: ({validation, order, details}) => `The ${validation} ${order} schema is malformed:\n${details}`},
  'shared-handle': {status: 400, cause: ({key, field, value, phases}) => `${field} '${value}' of ${key} is in ${phases.join(' and ')}: what it names belongs to one phase.`, hint: () => 'A phase replays as a whole, so a later one can\'t count on the state an earlier one left: give each phase its own.'},
  'no-target': {status: 400, cause: ({key}) => `Method syntax was used for ${key}, which declares no target field.`},
  'unknown-field': {status: 400, cause: ({key, field}) => `'${field}' is not a field of ${key}.`, hint: ({declared}) => declared.length ? `It takes ${quoted(declared)}.` : 'It takes no fields.'},

  // compile: references
  'invalid-reference': {status: 400, cause: ({reference}) => `'${reference}' is not a reference.`, hint: () => 'A literal string beginning with $ or @ must be supplied through given.'},
  'bare-reference': {status: 400, cause: () => '\'$\' names no phase.', hint: () => 'Reference a phase by name: $name.'},
  'address-reference': {status: 400, cause: ({reference}) => `'${reference}' names a Service Call Address.`, hint: () => 'Addresses change when calls are reordered; name the value with as: and reference that instead.'},
  'unknown-reference': {status: 400, cause: ({reference}) => `'${reference}' names no phase or node.`},
  'unknown-binding': {status: 400, cause: ({reference, binding}) => `'${reference}' names '${binding}', which no enclosing iteration names with as:.`},
  'unknown-error': {status: 400, cause: ({reference, catches}) => catches ? `'${reference}' is inside only ${catches} catch.` : `'${reference}' is inside no catch.`},
  'nothing-flows': {status: 400, cause: ({reference}) => `'${reference}' reads what flows into this call, and nothing does.`, hint: () => 'The first call of a phase or chain receives nothing; name an iteration with as: to reach its item.'},

  // compile: services and their keys
  'unknown-service': {status: 404, cause: ({service}) => `Service '${service}' is not registered in this scope.`},
  'not-a-service': {status: 500, cause: ({service}) => `Service '${service}' lacks lookup(key), supportedCalls() or init(env).`, hint: () => 'A service definition gets them from defineService.'},
  'missing-capability': {status: 501, cause: ({service, capability, handle}) => handle ? `Service '${service}' works on handles of kind ${capability}, which this runtime doesn't offer.` : `Service '${service}' requires env.${capability}, which this runtime doesn't provide.`},
  'unknown-resource': {status: 404, cause: ({key}) => `${key} is not a resource of this service.`},
  'confined-key': {status: 400, cause: ({key}) => `${key} is confined, and this service answers no confined calls.`},
  'unconfined-key': {status: 400, cause: ({key}) => `${key} isn't confined, and this service answers only confined calls.`, hint: ({confinedKey}) => `Use ${confinedKey}.`},
  'method-required': {status: 400, cause: ({key}) => `${key} needs a method.`, hint: ({methods}) => `It answers ${methods.join(', ')}.`},
  'method-not-allowed': {status: 405, cause: ({key, method, methods}) => methods.length ? `${key} doesn't answer ${method}.` : `${key} takes no method, and got ${method}.`, hint: ({methods}) => methods.length ? `It answers ${methods.join(', ')}.` : undefined},
  'refused-key': {status: 400, cause: ({key, reason}) => `${key} was refused by its service: ${reason}`},

  // a service's declaration
  'malformed-declaration': {status: 500, cause: ({key, reason}) => `The declaration of ${key} is malformed: ${reason}`},
  'malformed-document': {status: 500, cause: ({document, reason}) => `${reason}, in ${document}`},
  'function-type': {status: 500, cause: () => 'A service call is typed \'call\', not \'function\''},
  'unknown-tag': {status: 500, cause: ({tag, path}) => `Unknown tag '${tag}' on '${path}'.`},
  'unnamed-handle': {status: 500, cause: ({path}) => `'${path}' is a handle without a kind.`, hint: () => 'A handle names the kind of resource it is, one a runtime offers: [\'handle\', \'browser\'].'},
  'multiple-targets': {status: 500, cause: ({paths}) => `Fields ${quoted(paths)} are each tagged target.`, hint: () => 'Only one field can be the target.'},
  'malformed-source': {status: 500, cause: ({source, kinds}) => `${source} is not a source, which has exactly one of ${kinds.join(', ')}`},
  'malformed-source-operand': {status: 500, cause: ({kind, takes}) => `${kind} takes ${takes}`},
  'invalid-field-path': {status: 500, cause: ({path}) => `Field path '${path}' names an empty field.`},

  // a runtime and its config
  'missing-scope': {status: 500, cause: () => '\'scope\' is missing.', hint: () => 'Compile a Query in the scope runtime.scopeOf gives.'},
  'invalid-scope': {status: 500, cause: ({details}) => `The scope doesn't fit the scope schema:\n${details}`},
  'invalid-config': {status: 422, cause: ({service, details}) => `Service '${service}' can't use this config:\n${details}`},
  'malformed-config-declaration': {status: 500, cause: ({service, reason}) => `Service '${service}' has a malformed config declaration: ${reason}`},
  'malformed-oauth': {status: 500, cause: () => 'oauth takes {authorizeUrl, tokenUrl, scopes}'},
  'missing-config': {status: 500, cause: ({service}) => `Service '${service}' declares config, and none is filed for it in this scope.`},

  // plan: type issues, reported at the field they're in, never raised
  'type-mismatch': {cause: ({expects, receives}) => `Expects ${expects} but receives ${receives}.`},
  'maybe-missing': {cause: ({expects, receives}) => `Expects ${expects} but may receive nothing: ${receives}.`},
  'type-narrowing': {cause: ({expects, receives}) => `Expects ${expects} but receives ${receives}, which is only checked when it runs.`},

  // execute
  'missing-run-state': {status: 500, cause: () => '\'scope.run\' does not contain a valid RunState.'},
  'invalid-target': {status: 400, cause: ({target}) => `Target '${target}' is not a phase reference.`, hint: ({phase}) => phase ? `Use '$${phase}'.` : 'Name a phase as \'$phase\'.'},
  'unknown-target': {status: 400, cause: ({target}) => `Target '${target}' names no phase.`},
  'invalid-trigger': {status: 422, cause: ({details}) => `The trigger payload doesn't fit the trigger schema:\n${details}`},
  'invalid-ttl': {status: 400, cause: ({ttl}) => `Cache ttl '${ttl}' is not a duration.`, hint: () => 'Write a number and a unit, s, m, h, D or M, as in \'7D\'.'},
  'precheck-failed': {status: 422, cause: ({validation, details}) => `${validation} precheck failed:\n${details}`},
  'postcheck-failed': {status: 502, cause: ({validation, details}) => `${validation} postcheck failed:\n${details}`},
  timeout: {status: 504, cause: ({timeout}) => `Timed out after ${timeout}ms.`},
  'gave-up': {status: 504, cause: ({tries, miss}) => `Gave up after ${tries} tries. The last:\n${miss}`}
}

// A message: the base, then the hint after a blank line, when there's one.
const messageOf = (baseMessage, hint) => hint ? `${baseMessage}\n\n${hint}` : baseMessage

/**
 * The error a code names, made from its template with these details, which it
 * also carries as fields; `where` places it, and `cause` is the error behind
 * it, if any.
 */
export function errorOf(code, details = {}, {where, cause} = {}) {
  const {status, cause: causeOf, hint: hintOf} = ERRORS[code]
  const hint = hintOf?.(details) ?? cause?.hint
  const baseMessage = where ? `${where} ${causeOf(details)}` : causeOf(details)
  const error = new Error(messageOf(baseMessage, hint), cause === undefined ? undefined : {cause})
  return Object.assign(error, details, {code}, status && {status}, {baseMessage}, hint && {hint})
}

/**
 * Places an error where it happened, once whoever catches it knows: its
 * message, and base message, start with `where`. An error MicroQL didn't
 * raise gains a base message too.
 */
export function locate(error, where) {
  error.baseMessage = `${where} ${error.baseMessage ?? error.message}`
  error.message = messageOf(error.baseMessage, error.hint)
  return error
}

// What an error says went wrong, without its hint: the reason an error wrapping it gives.
export const reasonOf = (error) => error.baseMessage ?? error.message

// Whether MicroQL raised an error, from its catalog.
export const isCatalogued = (error) => Object.hasOwn(ERRORS, error?.code ?? '')
