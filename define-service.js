/**
 * @fileoverview defineService — a service from a service definition.
 *
 * Core asks a service three things. `lookup(key)` gives the declaration of
 * the service call a key names, and throws for a key the service refuses (a
 * resource it lacks, a method it doesn't take). `supportedCalls()` lists every
 * call it supports, for a builder to list. `init(runtime)` makes an instance
 * of the service for a runtime, whose `call({...key, fields})` makes a service
 * call and whose `tearDown()` releases what it holds. A key is
 * {method, service, resource, confined}, as @tlsft/service-key parses it.
 *
 * A service definition is the plainest way to answer them: resources ('/each')
 * map to a service call, or to one service call per method ({GET, POST}). A
 * service call is {description, input, output, call} (see declaration.js), or
 * just its call when it declares nothing. `init` and `tearDown` in the
 * definition are an instance's lifecycle, `requires` lists the runtime keys
 * it uses, `config` declares the runtime.config it reads (a zodly document), and `confined: true` says it answers only confined keys
 * (`[@service]`), where a service that isn't answers none.
 *
 * Service calls and hooks run with the instance as `this`: an object of its
 * own that inherits from the definition, so an instance keeps the runtime it
 * was made with, apart from every other instance.
 */

const isServiceCall = (entry) => typeof entry === 'function' || typeof entry?.call === 'function'

// A service call as the service keeps it: its declaration, and its call.
function serviceCallOf(entry) {
  const {call, ...declaration} = typeof entry === 'function' ? {call: entry} : entry
  return {declaration, call}
}

// Each resource's service calls, by method; one with no method is filed under null.
function serviceCallsByResource(serviceDefinition) {
  const resources = Object.keys(serviceDefinition).filter(key => key.startsWith('/'))
  return new Map(resources.map(resource => {
    const entry = serviceDefinition[resource]
    const byMethod = isServiceCall(entry) ? [[null, entry]] : Object.entries(entry)
    return [resource, new Map(byMethod.map(([method, serviceCall]) => [method, serviceCallOf(serviceCall)]))]
  }))
}

const methodsOf = (byMethod) => [...byMethod.keys()].join(', ')
const nameOf = ({service, resource, confined}) => `[${confined ? '@' : ''}${service}]${resource}`

// Why a service refuses a key's custody, when it does.
function custodyRefusal(confinedService, key) {
  if (key.confined && !confinedService) return `${nameOf(key)} is confined, and this service answers no confined calls`
  if (!key.confined && confinedService) return `${nameOf(key)} isn't confined, and this service answers only confined calls: ${nameOf({...key, confined: true})}`
}

// Why a resource doesn't answer a key's method, when it doesn't.
function methodRefusal(byMethod, key) {
  if (byMethod.has(null)) return key.method === null ? undefined : `${nameOf(key)} takes no method; got ${key.method}`
  if (key.method === null) return `${nameOf(key)} needs a method: ${methodsOf(byMethod)}`
  if (!byMethod.has(key.method)) return `${nameOf(key)} doesn't answer ${key.method} (answers ${methodsOf(byMethod)})`
}

/**
 * A service answering from a service definition: lookup, supportedCalls and
 * init, plus the definition's requires and config when it has them.
 */
export function defineService(serviceDefinition) {
  const resources = serviceCallsByResource(serviceDefinition)

  // The service call a key names; a refusal for any key the service won't take.
  function serviceCallAt(key) {
    const byMethod = resources.get(key.resource)
    const refusal = custodyRefusal(Boolean(serviceDefinition.confined), key)
      ?? (byMethod ? methodRefusal(byMethod, key) : `${nameOf(key)} is not a resource of this service`)
    if (refusal) throw new Error(refusal)
    return byMethod.get(key.method)
  }

  const supportedCalls = () => [...resources].flatMap(([resource, byMethod]) =>
    [...byMethod].map(([method, {declaration}]) => ({method, resource, ...declaration})))

  // An instance for a runtime: its own `this`, set up by the definition's init.
  async function init(runtime) {
    const self = Object.create(serviceDefinition)
    await serviceDefinition.init?.call(self, runtime)
    return {
      call: async ({fields, ...key}) => serviceCallAt(key).call.call(self, fields),
      ...(serviceDefinition.tearDown && {tearDown: () => serviceDefinition.tearDown.call(self)})
    }
  }

  return {
    lookup: (key) => serviceCallAt(key).declaration,
    supportedCalls,
    init,
    ...(serviceDefinition.requires && {requires: serviceDefinition.requires}),
    ...(serviceDefinition.config && {config: serviceDefinition.config})
  }
}
