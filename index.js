/**
 * @fileoverview MicroQL core — platform-free. Resolved under the `workerd`
 * condition; node callers get node.js, which wires the node runtime.
 */

export {default, applySelection} from './query.js'
export {compile} from './compile.js'
export {execute} from './execute.js'
export {plan} from './plan.js'
export {addressToPath, pathToAddress} from './addresses.js'
export {memoryStore, defaultRuntime} from './runtime.js'
export {default as util} from './services/util.js'
