/**
 * @fileoverview Simplified Validation System for MicroQL
 *
 * Clean, dynamic approach that follows MicroQL patterns:
 * - Try direct Zod access first
 * - Strict error messages for unknown types
 * - Let Zod handle complexity
 * - Functional composition over loops
 */

import {z} from 'zod'
import _ from 'lodash'
import {inspect} from 'util'

const PRIMITIVE_TYPES = ['string', 'number', 'boolean', 'date', 'any', 'unknown', 'void', 'undefined', 'null']
const WRAPPER_TYPES = ['array', 'object', 'union', 'enum', 'nullable', 'optional', 'tuple', 'function']

// Zod enums for validation
const AllTypesEnum = z.enum([...PRIMITIVE_TYPES, ...WRAPPER_TYPES])

// Recursive schema for validator descriptors
const DescriptorSchema = z.lazy(() => z.union([
  // String format: primitive or wrapper type names
  AllTypesEnum,

  // Direct Zod schema
  z.instanceof(z.ZodType),

  // Array format: [type, ...modifiers]
  z.array(z.union([
    z.string(), // type names and string modifiers
    z.object({}).passthrough(), // constraint objects like {min: 5}
    z.instanceof(RegExp), // regex patterns
    z.array(z.any()).min(0), // arrays with content (for enum values, etc.)
    DescriptorSchema // nested descriptors
  ])).min(1).refine(arr => {
    // First element must be a string and a valid type name
    return typeof arr[0] === 'string' && [...PRIMITIVE_TYPES, ...WRAPPER_TYPES].includes(arr[0])
  }, {
    message: 'Array descriptors must start with a valid type name'
  }),

  // Object format: shape definitions
  z.record(z.string(), DescriptorSchema)
]))

/**
 * Format Zod error messages into MicroQL error format
 */
function formatError(zodError, value, settings) {
  const issues = zodError?.issues || []
  const errorMessages = issues.map(err => {
    // Build a more detailed path showing the exact location of the error
    let path = '.'
    if (err.path && err.path.length > 0) {
      path = err.path.map((segment, index) => {
        if (typeof segment === 'number') {
          return `[${segment}]`
        }
        return index === 0 ? segment : `.${segment}`
      }).join('')
    }
    const specificValue = path === '.' ? value : _.get(value, path)

    // Improve union error messages by finding the most helpful branch error
    let message = err.message
    if (err.code === 'invalid_union' && err.errors) {
      for (const errorGroup of err.errors) {
        for (const subError of errorGroup) {
          if (subError.message && subError.message !== 'Invalid input') {
            message = subError.message
            break
          }
        }
        if (message !== 'Invalid input') break
      }
    }

    return `- ${path}: ${inspect(specificValue, settings?.inspect)} => ${message}`
  })

  return errorMessages.join('\n')
}

/**
 * Main validation function called by withValidation wrapper
 */
export function validate(schema, value, settings, validateDescriptor = true) {
  if (!schema) return

  const zodSchema = parseSchema(schema, settings, validateDescriptor)
  const result = zodSchema.safeParse(value)

  if (!result.success) {
    throw new Error(formatError(result.error, value, settings))
  }
}

/**
 * parseSchema is called during compile, and then implicitly by validate()
 * during withValidations() wrapper execution.
 * The second time it just returns the already-parsed schema.
 */
export function parseSchema(descriptor, settings, validateDescriptor = true) {
  // If already a Zod schema, return it immediately
  if (descriptor instanceof z.ZodType) {
    return descriptor
  }

  // Validate descriptor format itself to ensure it's of valid form
  if (validateDescriptor) validate(DescriptorSchema, descriptor, settings, false)
  return parseSchemaRecursive(descriptor)
}

function parseSchemaRecursive(descriptor) {
  // we support putting zod schemas inside our own schemas...
  if (descriptor instanceof z.ZodType) {
    return descriptor
  }

  // String: direct type lookup
  if (typeof descriptor === 'string') {
    return z[descriptor]()
  }

  // Array: [type, ...args]
  if (Array.isArray(descriptor)) {
    const [type, ...args] = descriptor

    // Special cases that need arguments
    if (type === 'array') {
      const elementSchema = args[0] || 'any'
      let arraySchema = z.array(parseSchemaRecursive(elementSchema))

      // Separate constraint objects from modifiers
      const constraintObjects = args.filter(arg => typeof arg === 'object' && arg !== null && !Array.isArray(arg))
      const modifiers = args.filter(arg => typeof arg === 'string')

      // Apply array constraints dynamically
      for (const options of constraintObjects) {
        for (const [key, value] of Object.entries(options)) {
          if (arraySchema[key] && typeof arraySchema[key] === 'function') {
            if (key === 'nonempty' && value === true) {
              arraySchema = arraySchema[key]()
            } else {
              arraySchema = arraySchema[key](value)
            }
          }
        }
      }

      // Apply modifiers
      return applyModifiers(arraySchema, modifiers)
    }

    if (type === 'object') {
      // For 'object' type, if no shape is provided, use a generic object schema
      const shape = args.find(arg => typeof arg === 'object' && !Array.isArray(arg))
      let objectSchema
      if (shape) {
        objectSchema = z.object(transformObjectShape(shape))
      } else {
        // Generic object schema for ['object'] or ['object', 'optional']
        objectSchema = z.object({}).passthrough()
      }

      // Apply any modifiers (like 'optional')
      const modifiers = args.filter(arg => typeof arg === 'string')
      return applyModifiers(objectSchema, modifiers)
    }

    if (type === 'function') {
      return z.any()
    }

    if (type === 'union') {
      // Separate schema descriptors from string modifiers
      const schemas = args.filter(arg =>
        typeof arg === 'object' && arg !== null || Array.isArray(arg))
      const modifiers = args.filter(arg => typeof arg === 'string')
      const unionSchema = z.union(schemas.map(schema => parseSchemaRecursive(schema)))
      return applyModifiers(unionSchema, modifiers)
    }

    if (type === 'enum') {
      const values = args[0] || []
      if (!Array.isArray(values) || values.length === 0) {
        throw new Error('Enum must have an array of values')
      }
      const modifiers = args.filter(arg => typeof arg === 'string')
      const enumSchema = z.enum(values)
      return applyModifiers(enumSchema, modifiers)
    }

    if (type === 'nullable') {
      const innerSchema = args[0] || 'any'
      const modifiers = args.filter(arg => typeof arg === 'string')
      const nullableSchema = z.nullable(parseSchemaRecursive(innerSchema))
      return applyModifiers(nullableSchema, modifiers)
    }

    if (type === 'optional') {
      const innerSchema = args[0] || 'any'
      const modifiers = args.filter(arg => typeof arg === 'string')
      const optionalSchema = z.optional(parseSchemaRecursive(innerSchema))
      return applyModifiers(optionalSchema, modifiers)
    }

    if (type === 'tuple') {
      const schemas = args.filter(arg => Array.isArray(arg) || typeof arg === 'string')
      const modifiers = args.filter(arg => typeof arg === 'string' && !['string', 'number', 'boolean', 'date', 'any', 'unknown', 'void', 'undefined', 'null'].includes(arg))
      const tupleSchema = z.tuple(schemas.map(parseSchemaRecursive))
      return applyModifiers(tupleSchema, modifiers)
    }

    // Handle primitive types with modifiers (e.g., ['string', 'email', 'optional'])
    if (PRIMITIVE_TYPES.includes(type) && z[type] && typeof z[type] === 'function') {
      const modifiers = args.filter(arg => typeof arg === 'string' || typeof arg === 'object' || arg instanceof RegExp)
      return applyModifiers(z[type](), modifiers)
    }

    // If we get here, it's an unknown type
    throw new Error(`Did you turn off schema validation? Unknown type: ${type}`)
  }

  // Object: shape definition
  if (typeof descriptor === 'object' && descriptor !== null) {
    return z.object(transformObjectShape(descriptor))
  }
}

function applyModifiers(schema, modifiers) {
  return modifiers.reduce((currentSchema, modifier) => {
    if (typeof modifier === 'string' && currentSchema[modifier]) {
      return currentSchema[modifier]()
    } else if (typeof modifier === 'object' && modifier !== null) {
      // Apply object modifiers like {min: 10, max: 20}
      return Object.entries(modifier).reduce((s, [key, value]) => {
        return s[key] ? s[key](value) : s
      }, currentSchema)
    } else if (modifier instanceof RegExp && currentSchema.regex) {
      return currentSchema.regex(modifier)
    } else {
      return currentSchema
    }
  }, schema)
}

const transformObjectShape = (shape) => _.mapValues(shape, parseSchemaRecursive)
