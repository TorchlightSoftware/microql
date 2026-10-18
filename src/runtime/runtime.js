/**
 * @fileoverview The runtime core is written against, and the entry stores it
 * keeps results in.
 *
 * A runtime is one object for a whole process, such as the node runtime
 * (index.js) or a platform's own. A Query runs on it in a scope: whatever the
 * runtime isolates by, such as {tenantId}, described by its scope schema, or
 * the empty scope, {}, for a runtime that isolates nothing. Core asks a
 * runtime for:
 *   services.get(scope, name)   the service a key names, while compiling
 *   call(scope, key, fields)    a service call's result, while running
 *   cache                       entry stores whose entries outlive a Run,
 *                               one per scope
 *   runStates                   entry stores of Runs' results, one per scope
 *                               and Run id
 *   env                         the environment's utilities: log(text,
 *                               {color, to}), and whatever more the runtime
 *                               offers. Debug output uses log; each service
 *                               instance receives env, with its own config
 * A service lists the env keys it uses in its `requires`, and a Query naming
 * a service whose keys env lacks doesn't compile (missing-capability).
 *
 * Core binds the Query's scope in once, as it compiles (inScope), so nothing
 * further in core carries it.
 *
 * Runtime is the base a runtime extends: it keeps the services and their
 * config (see service-registry.js and config.js), and makes each service's
 * instance on its first call in a scope. A runtime adds its env, its cache,
 * a config registry that stores elsewhere if it needs one, and register(scope).
 *
 * Entry stores hold call results by (form hash, input hash): a form holds one
 * entry per distinct input. The Cache keeps one per scope, get(scope, form,
 * input), and runStates one per scope and Run, get(scope, runId, form, input). Core calls
 * get, set and list, all async, so a store may live anywhere; clearing is the
 * store owner's business.
 */

import {canonical} from '../query/forms.js'
import {ServiceRegistry} from './service-registry.js'
import {ConfigRegistry, configError} from './config.js'

// An entry store held in memory.
export function memoryStore() {
  const forms = new Map()
  return {
    async get(form, input) {
      return forms.get(form)?.get(input)
    },
    async set(form, input, entry) {
      if (!forms.has(form)) forms.set(form, new Map())
      forms.get(form).set(input, entry)
    },
    async list(form) {
      return [...(forms.get(form)?.values() ?? [])]
    },
    // not part of what core calls: the owner's way to empty one form, or all
    async clear(form) {
      if (form === undefined) forms.clear()
      else forms.delete(form)
    }
  }
}

// Entry stores by key, each made by storeOf(key) on the key's first use.
function storesBy(storeOf) {
  const stores = new Map()
  return {
    of(key) {
      const id = canonical(key)
      if (!stores.has(id)) stores.set(id, storeOf(key))
      return stores.get(id)
    },
    // Forgets a key's store, returning it.
    remove(key) {
      const store = stores.get(canonical(key))
      stores.delete(canonical(key))
      return store
    },
    // Forgets every store, returning them.
    removeAll() {
      const all = [...stores.values()]
      stores.clear()
      return all
    }
  }
}

// A Cache: an entry store per scope, made by storeOf(scope) on the scope's
// first use, so tenants never share an entry.
export function scopedCache(storeOf) {
  const stores = storesBy(storeOf)
  return {
    get: (scope, form, input) => stores.of(scope).get(form, input),
    set: (scope, form, input, entry) => stores.of(scope).set(form, input, entry),
    list: (scope, form) => stores.of(scope).list(form),
    // not part of what core calls: the owner's way to empty one form of a
    // scope, a scope, or every scope it holds
    async clear(scope, form) {
      if (scope === undefined) await Promise.all(stores.removeAll().map(store => store.clear()))
      else if (form === undefined) await stores.remove(scope)?.clear()
      else await stores.of(scope).clear(form)
    }
  }
}

// Run States: an entry store per Run, by scope and the Run's id, made by
// storeOf(scope, runId) on the Run's first use. The platform chooses Run ids;
// running again with the same id resumes that Run.
export function scopedRunStates(storeOf) {
  const stores = storesBy(({scope, runId}) => storeOf(scope, runId))
  const storeOfRun = (scope, runId) => stores.of({scope, runId})
  return {
    get: (scope, runId, form, input) => storeOfRun(scope, runId).get(form, input),
    set: (scope, runId, form, input, entry) => storeOfRun(scope, runId).set(form, input, entry),
    list: (scope, runId, form) => storeOfRun(scope, runId).list(form),
    // not part of what core calls: the owner's way to empty one Run, or
    // every Run it holds
    async clear(scope, runId) {
      if (scope === undefined) await Promise.all(stores.removeAll().map(store => store.clear()))
      else await stores.remove({scope, runId})?.clear()
    }
  }
}

// A Cache held in memory.
export const memoryCache = () => scopedCache(() => memoryStore())

// Run States held in memory.
export const memoryRunStates = () => scopedRunStates(() => memoryStore())

// The runtime as one scope sees it: what core uses of a runtime, with the
// scope bound in, so nothing in core past compile carries the scope.
export const inScope = (runtime, scope) => ({
  env: runtime.env,
  services: {get: (name) => runtime.services.get(scope, name)},
  call: (key, fields) => runtime.call(scope, key, fields),
  cache: {
    get: (form, input) => runtime.cache.get(scope, form, input),
    set: (form, input, entry) => runtime.cache.set(scope, form, input, entry),
    list: (form) => runtime.cache.list(scope, form)
  },
  runStateOf: (runId) => ({
    get: (form, input) => runtime.runStates.get(scope, runId, form, input),
    set: (form, input, entry) => runtime.runStates.set(scope, runId, form, input, entry),
    list: (form) => runtime.runStates.list(scope, runId, form)
  })
})

// The first key a service requires that an env lacks, if any.
export const missingCapability = (service, env) => service.requires?.find(key => !(key in env))

export class Runtime {
  constructor(scopeSchema = {}) {
    this.services = new ServiceRegistry(scopeSchema)
    this.config = new ConfigRegistry(this.services)
    this.env = {}
    this.cache = memoryCache()
    this.runStates = memoryRunStates()
  }

  // Registers a scope's services: the runtime's own to write, for its owner
  // to call before the scope's Queries run, and cheap to repeat. A service's
  // instance is made on its first call, not here.
  async register(_scope) {}

  // A service call's result, from the instance of the service its key names.
  async call(scope, key, fields) {
    const instance = await this.services.instanceOf(scope, key.service, (service) => this.#instanceOf(scope, key.service, service))
    return instance.call({...key, fields})
  }

  // Releases the service instances of a scope, or of every scope.
  tearDown(scope) {
    return this.services.tearDown(scope)
  }

  // A service's instance, made with env and the config filed for it: config
  // is checked as it's filed, so here it need only be there.
  async #instanceOf(scope, name, service) {
    const config = await this.config.get(scope, name)
    if (service.config && config === undefined) throw configError(`No config is filed for '${name}', whose service declares config`)
    return service.init({...this.env, config})
  }
}
