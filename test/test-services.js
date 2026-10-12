/**
 * Shared test services for MicroQL tests
 */

import {serviceFromTable} from '../service-table.js'
import {mapValues} from '../common.js'

// Services by name, each written as a table of operations.
export const servicesFromTables = (tables) => mapValues(tables, serviceFromTable)

const onTarget = {on: ['target']}
const withTarget = (call) => ({input: onTarget, call})

// Math service with common mathematical operations
export const math = serviceFromTable({
  '/add1': withTarget(async ({on}) => on + 1),
  '/times10': withTarget(async ({on}) => on * 10),
  '/reduce': {input: {...onTarget, service: ['call']}, call: async ({on, fn}) => on.reduce(async (l, r) => fn([await l, r]))},
  '/sequence': withTarget(async ({on}) => Array.from({length: on}, (v, k) => k + 1)),
  '/sum': withTarget(async ({on}) => on.reduce((l, r) => l + r)),
  '/multiply': withTarget(async ({a, b}) => a * b),
  '/divide': async ({a, b}) => a / b,
  '/subtract': async ({a, b}) => a - b,
  '/add': withTarget(async ({a, b}) => a + b)
})

// Simple test service for basic operations
export const test = serviceFromTable({
  '/identity': {input: {value: ['target']}, call: async ({value}) => value},
  async '/increment'({value}) { return value + 1 },
  async '/double'({value}) { return value * 2 },
  async '/combine'({a, b}) { return `${a}-${b}` }
})

// Data manipulation service
export const data = serviceFromTable({
  async '/transform'({input, operation}) {
    switch (operation) {
      case 'uppercase': return input.toUpperCase()
      case 'lowercase': return input.toLowerCase()
      case 'reverse': return input.split('').reverse().join('')
      default: return input
    }
  },
  async '/merge'({arrays}) {
    return arrays.flat()
  },
  '/filter': {input: {...onTarget, service: ['call']}, call: async ({on, service}) => on.filter(service)}
})
