/**
 * @fileoverview MicroQL core, imported as `microql/core`: free of environment
 * dependencies, with no runtime of its own. Its caller supplies a runtime and
 * a Run State; `microql` (index.js) is core with the node runtime wired in.
 */

export {default, applySelection} from './query.js'
export {compile} from './compile.js'
export {execute} from './execute.js'
export {plan} from './plan.js'
export {addressToPath, pathToAddress} from './addresses.js'
export {memoryStore, serviceRegistry} from './runtime.js'
export {errorSchema, toErrorData, fromErrorData, isErrorData} from './errors.js'
export {parseSchema} from '@tlsft/zodly'
export {format} from './format.js'
export {default as util} from './services/util.js'
export {defineService} from './define-service.js'
export {serviceSmokeTests} from './smoke-test.js'
