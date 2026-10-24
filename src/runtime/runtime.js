/**
 * @fileoverview The runtime, the scopes it gives Queries, and the entry
 * stores it keeps results in.
 *
 * A runtime is one object for a whole process, such as the node runtime
 * (index.js) or a platform's own. Scoping is the runtime's: a scope is
 * whatever it keys a Query's state by, such as {tenantId, runId}, described
 * by its scope schema. Its run keys are the fields that name a Run
 * (['runId']); the rest of a scope outlives any one Run. So a runtime keeps:
 *   services and their config   by the scope without its run fields
 *   the Cache                   the same: its entries outlive a Run
 *   Run States and instances    by the whole scope: each Run's own
 * A runtime with no run keys keeps everything by the whole scope.
 *
 * Core never sees the runtime, nor how it keys anything: it runs a Query in
 * the scope scopeOf(scope) gives it, whose members are
 *   services.get(name)   the service a key names, while compiling
 *   env                  the environment's utilities: log(text, {color, to, level}),
 *                        and whatever more the runtime offers. Debug output
 *                        uses log; each service instance receives env, with
 *                        its own config
 *   call(key, fields)    a service call's result, while running
 *   cache                the entry store whose entries outlive a Run
 *   run                  the entry store of the Run's results, in a scope
 *                        with every run key; one without is for planning,
 *                        not running
 *   handles[kind](request)  the handle a call names, while running: a
 *                        resource of that kind outside the Query, such as a
 *                        browser session (see query/handles.js). A request
 *                        is {service, kind, name, phase}; the handle is
 *                        {service, kind, name} and what the kind gives the
 *                        service to work on it with. How long a resource is
 *                        kept is the runtime's to decide
 * A service lists the env keys it uses in its `requires`, and a Query naming
 * a service whose keys env lacks, or a kind of handle its scope doesn't
 * offer, doesn't compile (missing-capability). Services never see a scope,
 * so they reach a resource only through the handle they're given.
 *
 * A runtime with a browser offers handles of kind browser: `browser()` opens
 * a CDP transport to it (see cdp.js), whose closing lets go of the browser.
 * Each handle is a page of its own, in a browser context of its own, opened
 * on the scope's first request for it and kept until closeHandles(scope);
 * it gives its service `send` and `on`, CDP confined to that page, and
 * `frame(frameId)`, CDP confined to a frame within it.
 *
 * Runtime is the base a runtime extends: it keeps the services and their
 * config (see service-registry.js and config.js), and makes each service's
 * instance on its first call in a scope. A runtime adds its env, its stores,
 * a config registry that stores elsewhere if it needs one, and register(scope).
 *
 * Entry stores hold call results by (form hash, input hash): a form holds one
 * entry per distinct input. A runtime keeps them by scope, get(scope, form,
 * input); core calls a scope's get, set and list, all async, so a store may
 * live anywhere; clearing is the store owner's business.
 */

import {canonical} from '../query/forms.js'
import {ServiceRegistry} from './service-registry.js'
import {ConfigRegistry} from './config.js'
import {errorOf} from '../common/error-catalog.js'
import {ScopedTable} from './table.js'
import {cdpConnection, openPage, closePage, confinedTo} from './cdp.js'

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

// Entry stores by scope, each made by storeOf(scope) on the scope's first
// use, so no two scopes ever share an entry: the Cache, kept by tenant, or
// Run States, kept by Run.
export function scopedStores(storeOf) {
  const stores = new Map()
  const storeAt = (scope) => {
    const id = canonical(scope)
    if (!stores.has(id)) stores.set(id, storeOf(scope))
    return stores.get(id)
  }
  return {
    get: (scope, form, input) => storeAt(scope).get(form, input),
    set: (scope, form, input, entry) => storeAt(scope).set(form, input, entry),
    list: (scope, form) => storeAt(scope).list(form),
    // not part of what core calls: the owner's way to empty one form of a
    // scope, a scope, or every scope it holds
    async clear(scope, form) {
      if (scope === undefined) {
        const all = [...stores.values()]
        stores.clear()
        await Promise.all(all.map(store => store.clear()))
      } else if (form === undefined) {
        const store = stores.get(canonical(scope))
        stores.delete(canonical(scope))
        await store?.clear()
      } else {
        await storeAt(scope).clear(form)
      }
    }
  }
}

// Entry stores by scope, held in memory.
export const memoryStores = () => scopedStores(() => memoryStore())

// One scope's store among a runtime's stores: what core reads and writes.
const storeIn = (stores, scope) => ({
  get: (form, input) => stores.get(scope, form, input),
  set: (form, input, entry) => stores.set(scope, form, input, entry),
  list: (form) => stores.list(scope, form)
})

export class Runtime {
  // the CDP connection to the runtime's browser, made on first use
  #connection
  // each scope's browser sessions, by the handle they are: a page's ids
  #pages

  constructor({scopeSchema = {}, runKeys = []} = {}) {
    this.services = new ServiceRegistry({scopeSchema, runKeys})
    this.config = new ConfigRegistry(this.services)
    this.env = {}
    this.cache = memoryStores()
    this.runStates = memoryStores()
    this.#pages = new ScopedTable(scopeSchema)
  }

  // The handles a scope offers, by kind: browser sessions, when the runtime
  // has a browser.
  handlesOf(scope) {
    return this.browser ? {browser: (request) => this.#browserHandle(scope, request)} : {}
  }

  /**
   * The scope a Query runs in, as core receives it: services and config by
   * the scope without its run fields, the Cache likewise, and the Run's
   * results and instances by the whole scope. Only a scope that names its
   * Run (has every run field) has a Run State to run in.
   */
  scopeOf(scope) {
    const outlivingRun = this.services.withoutRun(scope)
    const namesRun = this.services.runKeys.every(field => scope[field] !== undefined)
    return {
      services: {get: (name) => this.services.get(outlivingRun, name)},
      env: this.env,
      handles: this.handlesOf(scope),
      call: (key, fields) => this.call(scope, key, fields),
      cache: storeIn(this.cache, outlivingRun),
      ...(namesRun && {run: storeIn(this.runStates, scope)})
    }
  }

  // Registers a scope's services: the runtime's own to write, for its owner
  // to call before the scope's Queries run, and cheap to repeat. A service's
  // instance is made on its first call, not here.
  async register(_scope) {}

  // A service call's result, from the instance of the service its key names
  // in the scope.
  async call(scope, key, fields) {
    const instance = await this.services.instanceOf(scope, key.service, (service) => this.#instanceOf(scope, key.service, service))
    return instance.call({...key, fields})
  }

  // Closes the resources of the handles of each scope the given scope's
  // fields are in (a Run, or every Run of a tenant), or of every scope.
  async closeHandles(scope) {
    const pages = this.#pages.remove(scope)
    await Promise.all(pages.map(page => closePage(this.#connected(), page)))
  }

  // Releases the service instances and the handles of each scope the given
  // scope's fields are in, or of every scope, and then the browser too.
  async tearDown(scope) {
    await Promise.all([this.services.tearDown(scope), this.closeHandles(scope)])
    if (scope === undefined) await this.#closeBrowser()
  }

  // A browser handle: the scope's page for it, opened on its first request.
  // Calls on one handle take turns, so its page is never opened twice.
  async #browserHandle(scope, {service, kind, name}) {
    const key = canonical([service, name])
    if (!this.#pages.get(scope, key)) this.#pages.set(scope, key, await openPage(this.#connected()))
    return {service, kind, name, ...confinedTo(this.#connected(), this.#pages.get(scope, key))}
  }

  // The CDP connection to the runtime's browser: one, made on first use, and
  // dialled on its first command.
  #connected() {
    this.#connection ??= cdpConnection(this.browser)
    return this.#connection
  }

  // Closes the connection to the browser, letting go of it.
  async #closeBrowser() {
    const connection = this.#connection
    this.#connection = undefined
    await connection?.close()
  }

  // A service's instance, made with env and the config filed for it: config
  // is checked as it's filed, so here it need only be there.
  async #instanceOf(scope, name, service) {
    const config = await this.config.get(this.services.withoutRun(scope), name)
    if (service.config && config === undefined) throw errorOf('missing-config', {service: name})
    return service.init({...this.env, config})
  }
}
