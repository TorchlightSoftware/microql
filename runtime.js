/**
 * @fileoverview Entry stores, and the runtime spec core is written against.
 *
 * Core has no runtime of its own. Its caller injects one as `config.runtime`:
 *   log(text, {color, to})   write a line of text: shown, in a colour name
 *                            when given; or kept at a destination, `to`,
 *                            which the runtime interprets (a file, a store)
 *   cache                    an entry store whose results outlive a Run
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
