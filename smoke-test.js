/**
 * @fileoverview Smoke tests for a service: what every service owes core,
 * checked without knowing its calls.
 *
 * serviceSmokeTests(service, {runtime, config}) is a table of tests,
 * [{describe, it, test}], for a service author to run in whatever test runner
 * they use. `runtime` holds the capabilities the service's init receives, and
 * `config` the service's own configuration and credentials, checked against
 * its config declaration as a Run checks them; `confined` says the
 * service answers only confined keys. Behaviour is the author's own tests'
 * business; these check the contract, so a service can take up a newer
 * MicroQL by running the newer smoke tests.
 */

import {readDeclaration} from './declaration.js'
import {runtimeRefusal} from './execute.js'
import {runtimeFor} from './runtime.js'

// The name the smoke tests give the service, as a Query would.
const SERVICE = 'smoke'

// A resource no service has.
const MISSING = '/microql-smoke-test/no-such-resource'

const check = (holds, message) => {
  if (!holds) throw new Error(message)
}

// Passes when the action throws or rejects.
async function refuses(action, message) {
  const refused = await Promise.resolve().then(action).then(() => false, () => true)
  check(refused, message)
}

// One smoke test: what it describes, what it checks, and the check.
const row = (describe, it, test) => ({describe, it, test})

const isFunction = (value) => typeof value === 'function'
const hasFunction = (value) =>
  isFunction(value) || (value !== null && typeof value === 'object' && Object.values(value).some(hasFunction))

const nameOf = ({method, resource, confined}) => `${method ? `${method} ` : ''}[${confined ? '@' : ''}${SERVICE}]${resource}`

// Runs a test with a fresh instance of the service, released afterwards.
async function withInstance(service, runtime, test) {
  const instance = await service.init(runtime)
  try {
    return await test(instance)
  } finally {
    await instance?.tearDown?.()
  }
}

// The calls a service lists; none when it can't list them, which its own row reports.
const listedCalls = (service) => isFunction(service.supportedCalls) ? service.supportedCalls() : []

/**
 * The smoke tests for a service: rows of {describe, it, test}, where test is
 * an async function that throws when the service fails it.
 */
export function serviceSmokeTests(service, {runtime: given, config, confined = false}) {
  // the runtime as a Run's would be, with the service's config filed under
  // its name, and the runtime its instances receive
  const runtime = {...given, ...(config !== undefined && {config: {[SERVICE]: config}})}
  const instanceRuntime = runtimeFor(runtime, SERVICE)
  const keyOf = ({method, resource}) => ({method, service: SERVICE, resource, confined})
  const listed = listedCalls(service)

  return [
    row('service', 'provides lookup, supportedCalls and init', async () => {
      const missing = ['lookup', 'supportedCalls', 'init'].filter(method => !isFunction(service[method]))
      check(missing.length === 0, `The service lacks ${missing.join(', ')}`)
    }),
    row('service', 'can run on the runtime: it has the keys the service requires, and config the service accepts', async () => {
      const refusal = runtimeRefusal(service, SERVICE, runtime)
      check(!refusal, refusal?.message)
    }),
    row('supportedCalls', 'lists each call by resource and method, with no functions', async () => {
      const calls = service.supportedCalls()
      check(Array.isArray(calls), 'supportedCalls() returns a list')
      for (const call of calls) {
        check(typeof call.resource === 'string' && 'method' in call, `Each listed call has a resource and a method: ${JSON.stringify(call)}`)
        check(!hasFunction(call), `${nameOf(keyOf(call))} is listed with a function; a listing carries declarations only`)
      }
    }),
    ...listed.map(({method, resource, description}) => row('lookup', `answers ${nameOf(keyOf({method, resource}))} with its declaration`, async () => {
      const declaration = service.lookup(keyOf({method, resource}))
      check(declaration?.description === description, `lookup answers ${nameOf(keyOf({method, resource}))} with the declaration supportedCalls lists`)
      readDeclaration(declaration)
    })),
    row('lookup', 'refuses a resource the service lacks', () =>
      refuses(() => service.lookup(keyOf({method: null, resource: MISSING})), `lookup answers ${MISSING}, which the service lacks, rather than throwing`)),
    row('lookup', 'refuses a key whose custody the service doesn\'t answer', async () => {
      for (const {method, resource} of listed) {
        const key = {...keyOf({method, resource}), confined: !confined}
        await refuses(() => service.lookup(key), `lookup answers ${nameOf(key)}, whose custody the service doesn't answer`)
      }
    }),
    row('init', 'makes an instance that answers call', () => withInstance(service, instanceRuntime, async (instance) => {
      check(isFunction(instance?.call), 'init(runtime) returns an instance with call')
      check(instance.tearDown === undefined || isFunction(instance.tearDown), 'An instance\'s tearDown, if it has one, is a function')
    })),
    row('init', 'makes a fresh instance each time', () => withInstance(service, instanceRuntime, (one) =>
      withInstance(service, instanceRuntime, async (other) => check(one !== other, 'Two inits make two instances: each runtime keeps its own')))),
    row('call', 'refuses a resource the service lacks', () => withInstance(service, instanceRuntime, (instance) =>
      refuses(() => instance.call({...keyOf({method: null, resource: MISSING}), fields: {}}), `call answers ${MISSING}, which the service lacks, rather than throwing`))),
    row('tearDown', 'can run twice', async () => {
      const instance = await service.init(instanceRuntime)
      await instance.tearDown?.()
      await instance.tearDown?.()
    })
  ]
}
