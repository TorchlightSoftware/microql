/**
 * @fileoverview Config — what a service declares it needs from its runtime,
 * and the registry where the runtime keeps it.
 *
 * A service's config declaration is a zodly document of the keys its
 * instances read from `env.config`. It may use one type of MicroQL's own,
 * `oauth`: a contract that the runtime resolves the OAuth protocol for the
 * service.
 *
 *   config: {github: ['oauth', {authorizeUrl, tokenUrl, scopes}]}
 *
 * `oauth` reads as an object tagged `oauth`, whose meta carries the
 * provider's details, holding what the runtime files once its OAuth flow has
 * run: clientId, clientSecret and refreshToken, each tagged `internal` (the
 * runtime's to fill, not a field for a person to edit) and optional, since
 * none is there before the flow runs. The service's init exchanges the
 * refresh token for an access token.
 */

import {parseSchema, validate} from '@tlsft/zodly'
import {canonical} from '../query/forms.js'
import {format} from '../common/format.js'
import {ScopedTable} from './table.js'
import {errorOf, locate, reasonOf} from '../common/error-catalog.js'

// The provider details an oauth type takes.
const OAUTH_DETAILS = {authorizeUrl: ['string', 'url'], tokenUrl: ['string', 'url'], scopes: ['array', ['string'], 'optional']}

// What the runtime files for an oauth type: the runtime's own.
const filedByRuntime = ['string', {min: 1}, 'optional', {tags: ['internal']}]

// The oauth type, as the object of what the runtime files, with the provider's details.
function asOAuth(form) {
  const [, details] = form
  if (details === undefined) throw errorOf('malformed-oauth')
  validate(OAUTH_DETAILS, details, format)
  const filed = {clientId: filedByRuntime, clientSecret: filedByRuntime, refreshToken: filedByRuntime}
  return [filed, {meta: {tags: ['oauth'], oauth: details}}]
}

const CONFIG_TYPES = {oauth: asOAuth}

// The zod schema of a service's config declaration.
export const configSchemaOf = (declaration) => parseSchema(declaration, {preprocess: CONFIG_TYPES})

// The error refusing a config to a service, by name, if it can't use it.
export function configRefusal(service, name, value) {
  if (!service.config) return undefined
  let schema
  try {
    schema = configSchemaOf(service.config)
  } catch (error) {
    return errorOf('malformed-config-declaration', {service: name, reason: reasonOf(error)}, {cause: error})
  }
  try {
    validate(schema, value, format)
  } catch (error) {
    return errorOf('invalid-config', {service: name, details: error.message})
  }
}

/**
 * A runtime's config, by scope and name: each the config of the service
 * registered under the same scope and name in the service registry it's
 * given, and keyed the same way. Config is checked against its service's
 * declaration as it's filed. Filing different config, or deleting it,
 * releases the service's instance, so its next use makes one with the
 * config as it now is; that reaches the instances this runtime keeps, not
 * those of a runtime in another process.
 *
 * Config is kept in memory here. A runtime that keeps it elsewhere (KV, a
 * database) extends this, overriding get, write and erase; set and delete
 * check and release as they do here.
 */
export class ConfigRegistry {
  #values

  constructor(services) {
    this.services = services
    this.#values = new ScopedTable(services.scopeSchema)
  }

  // The config filed for the service under a name in a scope, if any.
  async get(scope, name) {
    return this.#values.get(scope, name)
  }

  // Files config for the service under a name, once its declaration accepts it.
  async set(scope, name, value) {
    const service = this.services.get(scope, name)
    if (!service) throw errorOf('unknown-service', {service: name}, {where: 'config.set:'})
    const refusal = configRefusal(service, name, value)
    if (refusal) throw locate(refusal, 'config.set:')
    if (canonical(await this.get(scope, name)) === canonical(value)) return
    await this.write(scope, name, value)
    await this.services.tearDown(scope, name)
  }

  async delete(scope, name) {
    if (await this.get(scope, name) === undefined) return
    await this.erase(scope, name)
    await this.services.tearDown(scope, name)
  }

  // Keeps config: what a runtime storing it elsewhere overrides, with get and erase.
  async write(scope, name, value) {
    this.#values.set(scope, name, value)
  }

  async erase(scope, name) {
    this.#values.remove(scope, name)
  }
}
