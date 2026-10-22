/**
 * @fileoverview ServiceRegistry — a runtime's services, and the instances it
 * makes of them, by scope and name.
 *
 * Services are code, so they're kept in memory and read synchronously: core
 * looks each service key's service up here while compiling. Every scope has
 * util, MicroQL's built-in service, unless the runtime registers another
 * service under that name.
 *
 * A runtime whose scopes name their Run says which fields do, its run keys
 * (such as ['runId']). Services are registered by the scope without them,
 * since a service outlives any one Run; instances are kept by the whole
 * scope, so each Run has its own. With no run keys, the two are the same.
 *
 * An instance of a service is made on its first use in a scope, as its
 * runtime says, and kept for every later use until it's torn down: by the
 * runtime, by config filed for it (see config.js), or once another service
 * is registered under its name.
 */

import {ScopedTable} from './table.js'
import {omit} from '../common/common.js'
import {errorOf} from '../common/error-catalog.js'
import util from '../service/util.js'

// The services every scope has.
const BUILT_IN = {util}

// Tears down an instance, once it's made; one whose init failed holds
// nothing, and its failure has already reached the use that made it.
const release = (instance) => instance.then(made => made.tearDown?.(), () => {})

export class ServiceRegistry {
  #services
  #instances

  constructor({scopeSchema = {}, runKeys = []} = {}) {
    this.runKeys = runKeys
    // the schema of the scopes services, and their config, are filed by
    this.scopeSchema = omit(scopeSchema, runKeys)
    this.#services = new ScopedTable(this.scopeSchema)
    this.#instances = new ScopedTable(scopeSchema)
  }

  // A scope without the fields that name its Run: the scope its services are filed by.
  withoutRun(scope) {
    return omit(scope, this.runKeys)
  }

  // Files a service under a name in a scope, in place of any there.
  register(scope, name, service) {
    this.#services.set(scope, name, service)
  }

  unregister(scope, name) {
    this.#services.remove(scope, name)
  }

  // The service under a name in a scope, if there is one.
  get(scope, name) {
    return this.#services.get(scope, name) ?? BUILT_IN[name]
  }

  // A scope's services, by name.
  list(scope) {
    return {...BUILT_IN, ...this.#services.list(scope)}
  }

  /**
   * The instance of the service under a name in a scope, the whole scope a
   * Run has: made by make(service) on first use, and kept for every later
   * one. Uses that start together share one. An instance of a service another
   * has since replaced is released before one of the new service is made; a
   * make that fails is forgotten, so the next use tries again.
   */
  instanceOf(scope, name, make) {
    const service = this.get(this.withoutRun(scope), name)
    if (!service) return Promise.reject(errorOf('unknown-service', {service: name}))
    const held = this.#instances.get(scope, name)
    if (held?.service === service) return held.instance

    const instance = Promise.resolve(held && release(held.instance)).then(() => make(service))
    const entry = {service, instance}
    this.#instances.set(scope, name, entry)
    instance.catch(() => {
      if (this.#instances.get(scope, name) === entry) this.#instances.remove(scope, name)
    })
    return instance
  }

  // Releases instances: one name's, or all of them, in each scope the given
  // scope's fields are in (a Run, a tenant's every Run), or every one. The
  // next use of a service makes a fresh instance.
  async tearDown(scope, name) {
    const held = this.#instances.remove(scope, name)
    await Promise.all(held.map(({instance}) => release(instance)))
  }
}
