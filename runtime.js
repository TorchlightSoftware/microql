/**
 * @fileoverview Entry stores, and the runtime spec core is written against.
 *
 * Core has no runtime of its own. Its caller injects one as `config.runtime`:
 *   log(text, {color, to})   write a line of text: shown, in a colour name
 *                            when given; or kept at a destination, `to`,
 *                            which the runtime interprets (a file, a store)
 *   cache                    an entry store whose results outlive a Run
 *   init(services)           instances of the services a Run uses, by name
 *                            as the Query has them, each given the config
 *                            filed under its name; called as a method of
 *                            the runtime the Run was given
 *   config                   optional: each service's configuration, by
 *                            service name, scoped to the tenant served
 * The node runtime (index.js) is the reference implementation. A runtime may
 * offer more keys; a service that uses one says so in its `requires`, and a
 * Run on a runtime without it fails before it starts (missing-capability).
 *
 * Entry stores hold call results by (form hash, input hash): a form holds one
 * entry per distinct input. The Run State and the Cache share this shape and
 * differ only in lifetime. Core calls get, set and list, all async, so a store
 * may live anywhere; clearing is the store owner's business.
 */

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

// The runtime a service's instance receives: the runtime, with only the
// config filed under the service's name.
export const runtimeFor = (runtime, name) => ({...runtime, config: runtime.config?.[name]})

/**
 * The service instances a runtime keeps, for it to spread into itself:
 * init(services) makes one instance of each service under each name for the
 * runtime it's called on, given the config filed under that name, and reuses
 * it for every later Run; tearDown() releases them all, and the next Run makes
 * fresh ones. A runtime scoped to a tenant is a runtime of its own, so it has
 * instances of its own.
 */
export function serviceRegistry() {
  const byRuntime = new WeakMap()
  const instancesOf = (runtime) => byRuntime.get(runtime) ?? byRuntime.set(runtime, new Map()).get(runtime)

  // One instance per name and service, shared by Runs that start together; an
  // init that fails is forgotten, so the next Run tries again.
  function instanceOf(instances, name, service, runtime) {
    const byService = instances.get(name) ?? instances.set(name, new Map()).get(name)
    if (!byService.has(service)) {
      byService.set(service, Promise.resolve().then(() => service.init(runtimeFor(runtime, name))).catch(error => {
        byService.delete(service)
        throw error
      }))
    }
    return byService.get(service)
  }

  return {
    async init(services) {
      const instances = instancesOf(this)
      const named = await Promise.all(Object.entries(services).map(async ([name, service]) => [name, await instanceOf(instances, name, service, this)]))
      return Object.fromEntries(named)
    },
    async tearDown() {
      const instances = instancesOf(this)
      const held = await Promise.allSettled([...instances.values()].flatMap(byService => [...byService.values()]))
      instances.clear()
      await Promise.all(held.filter(({status}) => status === 'fulfilled').map(({value}) => value.tearDown?.()))
    }
  }
}
