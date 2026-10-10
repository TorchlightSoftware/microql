/**
 * @fileoverview MicroQL core, imported as `microql/core`: free of environment
 * dependencies, with no runtime of its own. Its caller supplies a runtime and
 * a Run State; `microql` (node.js) is core with the node runtime wired in.
 */

export {default, applySelection} from './query.js'
export {compile} from './compile.js'
export {execute} from './execute.js'
export {plan} from './plan.js'
export {addressToPath, pathToAddress} from './addresses.js'
export {memoryStore} from './runtime.js'
export {default as util} from './services/util.js'
