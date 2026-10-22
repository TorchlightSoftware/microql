/**
 * @fileoverview ScopedTable — what a runtime keeps by scope and name.
 *
 * A scope is whatever a runtime isolates by, such as {tenantId}, described by
 * a zodly schema; a runtime that isolates nothing has the empty scope, {}. A
 * scoped table keeps one value per (scope, name): the service registry keeps
 * services and their instances in tables, and the config registry keeps
 * config in one.
 */

import {parseSchema, validate} from '@tlsft/zodly'
import {canonical} from '../query/forms.js'
import {format} from '../common/format.js'
import {errorOf} from '../common/error-catalog.js'

// Whether a scope holds every field of another, with the same values: the
// empty scope is within every scope.
const isWithin = (scope, partial) =>
  Object.entries(partial).every(([field, value]) => canonical(scope[field]) === canonical(value))

export class ScopedTable {
  // each scope's values by name, with the scope they're kept for, by the scope's key
  #scopes = new Map()
  // the scope schema, read once: each access checks its scope against it
  #scope

  constructor(scopeSchema = {}) {
    this.scopeSchema = scopeSchema
    this.#scope = parseSchema(scopeSchema)
  }

  // The scope as a key, once it's known to fit the scope schema; the same
  // however its fields are ordered.
  #keyOf(scope) {
    try {
      validate(this.#scope, scope, format)
    } catch (error) {
      throw errorOf('invalid-scope', {details: error.message})
    }
    return canonical(scope)
  }

  get(scope, name) {
    return this.#scopes.get(this.#keyOf(scope))?.values.get(name)
  }

  set(scope, name, value) {
    const key = this.#keyOf(scope)
    if (!this.#scopes.has(key)) this.#scopes.set(key, {scope, values: new Map()})
    this.#scopes.get(key).values.set(name, value)
  }

  // A scope's values, by name.
  list(scope) {
    return Object.fromEntries(this.#scopes.get(this.#keyOf(scope))?.values ?? [])
  }

  // Removes one name's value, or every value, from each scope the given
  // scope's fields are in (every scope, given none), and returns what it
  // removed. A whole scope names only itself; {tenantId} names each of a
  // tenant's scopes, whatever their other fields.
  remove(scope = {}, name) {
    const within = [...this.#scopes].filter(([, held]) => isWithin(held.scope, scope))
    return within.flatMap(([key]) => this.#removeFrom(key, name))
  }

  // Removes one name's value from the scope a key names, or all of them when
  // no name is given.
  #removeFrom(key, name) {
    const {values} = this.#scopes.get(key)
    if (name === undefined) {
      this.#scopes.delete(key)
      return [...values.values()]
    }
    if (!values.has(name)) return []
    const value = values.get(name)
    values.delete(name)
    return [value]
  }
}
