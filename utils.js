/**
 * @fileoverview Internal utilities for MicroQL core
 * These utilities are only used within the MicroQL engine and maintain its self-contained nature
 */

/**
 * Merge arguments with 'on' parameter (common pattern in MicroQL)
 * Used for method syntax transformation and service argument preparation
 * @param {Object} args - Base arguments object
 * @param {*} onValue - Value for the 'on' parameter
 * @returns {Object} Merged arguments with 'on' parameter
 */
export const withOnParameter = (args, onValue) => ({ on: onValue, ...args })

/**
 * Validate context index for @ symbol resolution
 * Ensures proper error messages when context stack depth is insufficient
 * @param {number} atCount - Number of @ symbols (1 for @, 2 for @@, etc.)
 * @param {number} contextIndex - Calculated context index (atCount - 1)
 * @param {Array} contextStack - Current context stack
 * @throws {Error} If context index is invalid
 */
export const validateContextIndex = (atCount, contextIndex, contextStack) => {
  if (contextIndex < 0 || contextIndex >= contextStack.length) {
    throw new Error(`${'@'.repeat(atCount)} used but only ${contextStack.length} context levels available (@ through ${'@'.repeat(contextStack.length)})`)
  }
}