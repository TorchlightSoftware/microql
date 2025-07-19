// ContextStack gives safe access to stack values which are:
//   - referenced using '@'
//   - used in chains, iteration, and error handling
class ContextStack {
  // it should never point to the array it was given, always copy
  constructor(stack = []) {
    this.stack = [].concat(stack)
  }

  get(depth) {
    if (depth < 1) throw new Error('Depth must be 1 or greater')
    const stackRef = this.stack.length - depth
    if (stackRef < 0) throw new Error('Invalid stack reference.')
    return this.stack[stackRef]
  }

  getCurrent() {return this.get(1)}

  setCurrent(value) {
    const stackRef = this.stack.length - 1
    if (stackRef < 0) throw new Error('Invalid stack reference.')
    this.stack[stackRef] = value
  }

  extend(value) {
    return new ContextStack(this.stack.concat(value))
  }
}

export default ContextStack
