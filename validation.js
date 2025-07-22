/**
 * @fileoverview Validation System for MicroQL
 *
 * Provides Zod-based validation for precheck/postcheck contract-driven design.
 * Transforms JSON schema descriptors into Zod schemas and executes validation.
 */

import {z} from 'zod'

/**
 * Main validation function called by withValidation wrapper
 * @param {*} schemas - Array of schema descriptors to validate against
 * @param {*} value - Value to validate (args for precheck, result for postcheck)
 * @param {string} order - 'precheck' or 'postcheck' for error reporting
 */
export function validate(schemas, value, order = 'validation') {
  if (!schemas || schemas.length === 0) return

  // Process each schema descriptor (service-level and user-level)
  for (const schemaDescriptor of schemas) {
    if (!schemaDescriptor) continue

    const zodSchema = parseSchema(schemaDescriptor)
    const result = zodSchema.safeParse(value)

    if (!result.success) {
      // Convert Zod errors to MicroQL error format
      const errors = result.error?.issues || []
      const errorMessages = errors.map(err => {
        const path = err.path && err.path.length > 0 ? err.path.join('.') : 'value'
        return `- ${path}: ${err.message}`
      })

      throw new Error(`${capitalizeFirst(order)} validation failed:\n${errorMessages.join('\n')}`)
    }
  }
}

/**
 * Parse a schema descriptor into a Zod schema
 * @param {*} descriptor - Schema descriptor to parse
 * @returns {z.ZodSchema} Compiled Zod schema
 */
export function parseSchema(descriptor) {
  // Handle array syntax: ['string', 'email', 'optional']
  if (Array.isArray(descriptor)) {
    return parseArraySchema(descriptor)
  }

  // Handle object syntax: {name: ['string'], age: ['number']}
  if (typeof descriptor === 'object' && descriptor !== null) {
    return parseObjectSchema(descriptor)
  }

  // Handle primitive type strings
  if (typeof descriptor === 'string') {
    return parsePrimitiveType(descriptor)
  }

  throw new Error(`Invalid schema descriptor: ${JSON.stringify(descriptor)}`)
}

/**
 * Parse array-based schema: ['string', 'email', 'optional']
 */
function parseArraySchema(descriptor) {
  if (descriptor.length === 0) {
    throw new Error('Empty schema array')
  }

  const [baseType, ...modifiers] = descriptor

  // Handle wrapper functions that take inner schemas
  if (isWrapperFunction(baseType)) {
    return parseWrapperFunction(baseType, modifiers)
  }

  // Handle regular type with chainable modifiers
  let schema = parsePrimitiveType(baseType)

  // Apply modifiers in order
  for (const modifier of modifiers) {
    schema = applyModifier(schema, modifier)
  }

  return schema
}

/**
 * Parse object-based schema: {name: ['string'], age: ['number']}
 */
function parseObjectSchema(descriptor) {
  const shape = {}

  for (const [key, subDescriptor] of Object.entries(descriptor)) {
    shape[key] = parseSchema(subDescriptor)
  }

  return z.object(shape)
}

/**
 * Parse primitive types into base Zod schemas
 */
function parsePrimitiveType(type) {
  switch (type) {
    case 'string':
      return z.string()
    case 'number':
      return z.number()
    case 'boolean':
      return z.boolean()
    case 'date':
      return z.date()
    case 'any':
      return z.any()
    case 'unknown':
      return z.unknown()
    case 'void':
      return z.void()
    case 'undefined':
      return z.undefined()
    case 'null':
      return z.null()
    default:
      throw new Error(`Unknown primitive type: ${type}`)
  }
}

/**
 * Check if a type requires wrapper function syntax
 */
function isWrapperFunction(type) {
  return ['array', 'object', 'union', 'nullable', 'optional', 'enum'].includes(type)
}

/**
 * Parse wrapper functions: ['array', ['string'], {min: 5}]
 */
function parseWrapperFunction(wrapperType, args) {
  switch (wrapperType) {
    case 'array': {
      const [elementSchema, options = {}] = args
      let arraySchema = z.array(parseSchema(elementSchema))

      // Apply array-specific modifiers
      if (options.min !== undefined) arraySchema = arraySchema.min(options.min)
      if (options.max !== undefined) arraySchema = arraySchema.max(options.max)
      if (options.length !== undefined) arraySchema = arraySchema.length(options.length)

      return arraySchema
    }

    case 'object': {
      const [shape] = args
      return parseObjectSchema(shape)
    }

    case 'union': {
      const unionSchemas = args.map(parseSchema)
      return z.union(unionSchemas)
    }

    case 'nullable': {
      const [innerSchema] = args
      return z.nullable(parseSchema(innerSchema))
    }

    case 'optional': {
      const [innerSchema] = args
      return z.optional(parseSchema(innerSchema))
    }

    case 'enum': {
      const [values] = args
      if (!Array.isArray(values) || values.length === 0) {
        throw new Error('Enum must have an array of values')
      }
      return z.enum(values)
    }

    default:
      throw new Error(`Unknown wrapper function: ${wrapperType}`)
  }
}

/**
 * Apply chainable modifiers to a schema
 */
function applyModifier(schema, modifier) {
  // Handle object modifiers with parameters
  if (typeof modifier === 'object' && modifier !== null) {
    for (const [key, value] of Object.entries(modifier)) {
      schema = applyNamedModifier(schema, key, value)
    }
    return schema
  }

  // Handle string modifiers
  if (typeof modifier === 'string') {
    return applyNamedModifier(schema, modifier)
  }

  // Handle regex patterns
  if (modifier instanceof RegExp) {
    if (schema instanceof z.ZodString) {
      return schema.regex(modifier)
    }
    throw new Error('Regex modifiers can only be applied to string schemas')
  }

  throw new Error(`Invalid modifier: ${JSON.stringify(modifier)}`)
}

/**
 * Apply named modifiers to schemas
 */
function applyNamedModifier(schema, name, value) {
  switch (name) {
    // String modifiers
    case 'email':
      return schema.email()
    case 'url':
      return schema.url()
    case 'uuid':
      return schema.uuid()
    case 'min':
      return schema.min(value)
    case 'max':
      return schema.max(value)
    case 'length':
      return schema.length(value)
    case 'regex':
      if (schema instanceof z.ZodString) {
        return schema.regex(value)
      }
      throw new Error('Regex modifier can only be applied to string schemas')

    // Number modifiers
    case 'positive':
      return schema.positive()
    case 'negative':
      return schema.negative()
    case 'int':
    case 'integer':
      return schema.int()
    case 'finite':
      return schema.finite()

    // Common modifiers
    case 'optional':
      return schema.optional()
    case 'nullable':
      return schema.nullable()
    case 'default':
      return schema.default(value)

    default:
      // Try to call the method dynamically if it exists
      if (typeof schema[name] === 'function') {
        return value !== undefined ? schema[name](value) : schema[name]()
      }
      throw new Error(`Unknown modifier: ${name}`)
  }
}

/**
 * Utility function to capitalize first letter
 */
function capitalizeFirst(str) {
  return str.charAt(0).toUpperCase() + str.slice(1)
}
