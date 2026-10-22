/**
 * Shared test services for MicroQL tests
 */

import {randomUUID} from 'node:crypto'
import {defineService} from '../src/service/define-service.js'
import {nodeRuntime} from '../index.js'
import {mapValues} from '../src/common/common.js'

// A Run of a test's own on the node runtime: its id, to run or resume it
// with, and its Run State's entries for a form.
export const ownRun = () => {
  const id = randomUUID()
  return {id, list: (form) => nodeRuntime.runStates.list({runId: id}, form)}
}

// Services by name, each written as a table of service calls.
export const servicesFromTables = (tables) => mapValues(tables, defineService)

const onTarget = {on: ['any', 'optional', {tags: ['target']}]}
const withTarget = (call) => ({input: onTarget, call})

// Math service with common mathematical operations
export const math = defineService({
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
export const test = defineService({
  '/identity': {input: {value: ['any', 'optional', {tags: ['target']}]}, call: async ({value}) => value},
  async '/increment'({value}) { return value + 1 },
  async '/double'({value}) { return value * 2 },
  async '/combine'({a, b}) { return `${a}-${b}` }
})

// Data manipulation service
export const data = defineService({
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
