/**
 * @fileoverview MicroQL core, imported as `microql/core`: free of environment
 * dependencies, with no runtime of its own. Its caller supplies a runtime, which
 * Runtime is the base of, and a Run State; `microql` (index.js) is core with
 * the node runtime wired in.
 */

export {default, applySelection} from './src/query/query.js'
export {compile} from './src/query/compile.js'
export {execute} from './src/execute/execute.js'
export {plan} from './src/types/plan.js'
export {addressToPath, pathToAddress} from './src/query/addresses.js'
export {Runtime, memoryStore, memoryCache, scopedCache, memoryRunStates, scopedRunStates} from './src/runtime/runtime.js'
export {ServiceRegistry} from './src/runtime/service-registry.js'
export {ConfigRegistry, configSchemaOf} from './src/runtime/config.js'
export {errorSchema, toErrorData, fromErrorData, isErrorData} from './src/execute/errors.js'
export {parseSchema} from '@tlsft/zodly'
export {format} from './src/common/format.js'
export {default as util} from './src/service/util.js'
export {defineService} from './src/service/define-service.js'
export {serviceSmokeTests} from './src/service/smoke-test.js'
