/**
 * Shared test services for MicroQL tests
 */

// Math service with common mathematical operations
export const math = {
  add1: async ({on}) => on + 1,
  times10: async ({on}) => on * 10,
  reduce: async ({on, fn}) => on.reduce(async (l, r) => fn([await l, r])),
  sequence: async ({on}) => Array.from({length: on}, (v, k) => k + 1),
  sum: async ({on}) => on.reduce((l, r) => l + r),
  multiply: async ({a, b}) => a * b,
  divide: async ({a, b}) => a / b,
  subtract: async ({a, b}) => a - b,
  add: async ({a, b}) => a + b
}
// Add argOrder metadata for method syntax support
math.add1._argtypes = {on: {argOrder: 0}}
math.times10._argtypes = {on: {argOrder: 0}}
math.reduce._argtypes = {on: {argOrder: 0}, service: {type: 'service'}}
math.sequence._argtypes = {on: {argOrder: 0}}
math.sum._argtypes = {on: {argOrder: 0}}
math.add._argtypes = {on: {argOrder: 0}}
math.multiply._argtypes = {on: {argOrder: 0}}

// Simple test service for basic operations
export const test = {
  async identity({value}) { return value },
  async increment({value}) { return value + 1 },
  async double({value}) { return value * 2 },
  async combine({a, b}) { return `${a}-${b}` }
}
test.identity._argtypes = {value: {argOrder: 0}}

// Data manipulation service
export const data = {
  async transform({input, operation}) {
    switch (operation) {
      case 'uppercase': return input.toUpperCase()
      case 'lowercase': return input.toLowerCase()
      case 'reverse': return input.split('').reverse().join('')
      default: return input
    }
  },
  async merge({arrays}) {
    return arrays.flat()
  },
  async filter({on, service}) {
    return on.filter(service)
  }
}
data.filter._argtypes = {on: {argOrder: 0}, service: {type: 'service'}}