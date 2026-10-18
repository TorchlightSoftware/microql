/**
 * @fileoverview ScopedTable — what a runtime keeps by scope and name.
 *
 * A scope is whatever a runtime isolates by, such as {tenantId}, described by
 * a zodly schema; a runtime that isolates nothing has the empty scope, {}. A
 * scoped table keeps one value per (scope, name): the service registry keeps
 * services and their instances in tables, and the config registry keeps
 * config in one, all scoped the same way.
 */

import {validate} from '@tlsft/zodly'
import {canonical} from '../query/forms.js'
import {format} from '../common/format.js'

export class ScopedTable {
  #scopes = new Map()

  constructor(scopeSchema = {}) {
    this.scopeSchema = scopeSchema
  }

  // The scope as a key, once it's known to fit the scope schema; the same
  // however its fields are ordered.
  #keyOf(scope) {
    try {
      validate(this.scopeSchema, scope, format)
    } catch (error) {
      throw new Error(`Invalid scope:\n${error.message}`)
    }
    return canonical(scope)
  }

  get(scope, name) {
    return this.#scopes.get(this.#keyOf(scope))?.get(name)
  }

  set(scope, name, value) {
    const key = this.#keyOf(scope)
    if (!this.#scopes.has(key)) this.#scopes.set(key, new Map())
    this.#scopes.get(key).set(name, value)
  }

  // A scope's values, by name.
  list(scope) {
    return Object.fromEntries(this.#scopes.get(this.#keyOf(scope)) ?? [])
  }

  // Removes one name's value in a scope, a scope's values, or every value,
  // and returns what it removed.
  remove(scope, name) {
    const keys = scope === undefined ? [...this.#scopes.keys()] : [this.#keyOf(scope)]
    return keys.flatMap(key => this.#removeFrom(key, name))
  }

  // Removes one name's value from the scope a key names, or all of them when
  // no name is given.
  #removeFrom(key, name) {
    const values = this.#scopes.get(key)
    if (name === undefined) {
      this.#scopes.delete(key)
      return [...(values?.values() ?? [])]
    }
    if (!values?.has(name)) return []
    const value = values.get(name)
    values.delete(name)
    return [value]
  }
}
