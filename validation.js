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

const PRIMITIVE_TYPES = ['string', 'number', 'boolean', 'date', 'any', 'unknown', 'void', 'undefined', 'null']
const WRAPPER_TYPES = ['array', 'object', 'union', 'enum', 'nullable', 'optional', 'tuple', 'function']

// Zod enums for validation
const AllTypesEnum = z.enum([...PRIMITIVE_TYPES, ...WRAPPER_TYPES])

// Recursive schema for validator descriptors
const DescriptorSchema = z.lazy(() => z.union([
  // String format: primitive or wrapper type names
  AllTypesEnum,

  // Array format: [type, ...modifiers]
  z.array(z.union([
    z.string(), // type names and string modifiers
    z.object({}).passthrough(), // constraint objects like {min: 5}
    z.instanceof(RegExp), // regex patterns
    z.array(z.any()).min(0), // empty arrays or arrays with any content (for enum values, etc.)
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
function formatError(zodError) {
  const errors = zodError?.issues || []
  const errorMessages = errors.map(err => {
    const path = err.path && err.path.length > 0 ? err.path.join('.') : 'value'

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

    return `- ${path}: ${message}`
  })

  return errorMessages.join('\n')
}

/**
 * Main validation function called by withValidation wrapper
 */
export function validate(schema, value) {
  if (!schema) return

  const zodSchema = parseSchema(schema)
  const result = zodSchema.safeParse(value)

  if (!result.success) {
    throw new Error(formatError(result.error))
  }
}

/**
 * parseSchema is called during compile, and then implicitly by validate()
 * during withValidations() wrapper execution.
 * The second time it just returns the already-parsed schema.
 */
export function parseSchema(descriptor) {
  // If already a Zod schema, return it immediately
  if (descriptor instanceof z.ZodType) {
    return descriptor
  }

  // Validate descriptor format itself to ensure it's of valid form
  validate(DescriptorSchema, descriptor)

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
      const options = args[1]
      let arraySchema = z.array(parseSchema(elementSchema))

      // Apply array constraints
      if (options && typeof options === 'object') {
        if (options.min !== undefined) arraySchema = arraySchema.min(options.min)
        if (options.max !== undefined) arraySchema = arraySchema.max(options.max)
        if (options.length !== undefined) arraySchema = arraySchema.length(options.length)
      }

      return arraySchema
    }

    if (type === 'object') {
      const shape = args[0] || {}
      return z.object(transformObjectShape(shape))
    }

    if (type === 'function') {
      return z.any()
    }

    if (type === 'union') {
      const schemas = args[0] || []
      return z.union(schemas.map(parseSchema))
    }

    if (type === 'enum') {
      const values = args[0] || []
      if (!Array.isArray(values) || values.length === 0) {
        throw new Error('Enum must have an array of values')
      }
      return z.enum(values)
    }

    if (type === 'nullable') {
      const innerSchema = args[0] || 'any'
      return z.nullable(parseSchema(innerSchema))
    }

    if (type === 'optional') {
      const innerSchema = args[0] || 'any'
      return z.optional(parseSchema(innerSchema))
    }

    if (type === 'tuple') {
      const elements = args
      return z.tuple(elements.map(parseSchema))
    }

    // Try dynamic access with modifiers (functional composition)
    if (z[type] && typeof z[type] === 'function') {
      return applyModifiers(z[type](), args)
    }
  }

  // Object: shape definition
  if (typeof descriptor === 'object' && descriptor !== null) {
    return z.object(transformObjectShape(descriptor))
  }
}

function applyModifiers(schema, modifiers) {
  return modifiers.reduce((currentSchema, modifier) => {
    if (typeof modifier === 'string') {
      // Handle special modifier name mappings
      const methodName = getZodMethodName(modifier)
      if (currentSchema[methodName]) {
        return currentSchema[methodName]()
      }
    } else if (typeof modifier === 'object' && modifier !== null) {
      // Apply object modifiers like {min: 10, max: 20}
      return Object.entries(modifier).reduce((s, [key, value]) => {
        return s[key] ? s[key](value) : s
      }, currentSchema)
    } else if (modifier instanceof RegExp && currentSchema.regex) {
      return currentSchema.regex(modifier)
    }
    return currentSchema
  }, schema)
}

/**
 * Map modifier names to Zod method names
 */
function getZodMethodName(modifier) {
  switch (modifier) {
    case 'integer': return 'int'
    default: return modifier
  }
}

/**
 * Transform object shape for Zod
 */
function transformObjectShape(shape) {
  const result = {}
  for (const [key, subDescriptor] of Object.entries(shape)) {
    result[key] = parseSchema(subDescriptor)
  }
  return result
}
