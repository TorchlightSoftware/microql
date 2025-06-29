/**
 * MicroQL - A query language for composing microservices
 * 
 * ARCHITECTURAL SEPARATION:
 * MicroQL maintains strict separation from services it orchestrates.
 * - Services should NOT import from this module's internals
 * - MicroQL does NOT know about specific service implementations
 * - The query configuration is the only coupling point
 * 
 * For service writers: See SERVICE_WRITER_GUIDE.md
 */

export { default } from './query.js'
export { default as util } from './util.js'