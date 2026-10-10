/**
 * @fileoverview Entry stores, and the runtime spec core is written against.
 *
 * Core has no runtime of its own. Its caller injects one as `config.runtime`:
 *   print(text, {color})          show a line of output
 *   inspect(value, options)       render a value for output
 *   recordFailure(location, record)  keep a failure for later
 *   cache                         an entry store whose results outlive a Run
 * The node runtime (node.js) is the reference implementation.
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
