import {builtinModules} from 'node:module'
import stylistic from '@stylistic/eslint-plugin'
import js from '@eslint/js'

// Files that may use node: the node entry point (core plus the node runtime),
// the tests, and tooling. Everything else is core, and must run on any platform.
const NODE_FILES = ['index.js', 'test/**', 'scripts/**', 'eslint.config.js']

const nodeGlobals = {
  process: 'readonly',
  Buffer: 'readonly',
  __dirname: 'readonly',
  __filename: 'readonly',
  global: 'readonly',
  setImmediate: 'readonly',
  clearImmediate: 'readonly'
}

export default [
  js.configs.recommended,
  {
    ignores: ['temp-zod-repo/**']
  },
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      // globals every runtime provides
      globals: {
        console: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        crypto: 'readonly',
        TextEncoder: 'readonly',
        performance: 'readonly',
        URL: 'readonly',
        AbortController: 'readonly',
        AbortSignal: 'readonly'
      }
    },
    plugins: {
      '@stylistic': stylistic
    },
    rules: {
      // Indentation: 2 spaces
      '@stylistic/indent': ['error', 2],

      // No semicolons
      '@stylistic/semi': ['error', 'never'],

      // Object formatting - keep objects concise when possible
      '@stylistic/object-curly-spacing': ['error', 'never'],
      '@stylistic/object-curly-newline': ['error', {
        ObjectExpression: {multiline: true, consistent: true},
        ObjectPattern: {multiline: true, consistent: true}
      }],

      // Array formatting - keep arrays concise when possible
      '@stylistic/array-bracket-spacing': ['error', 'never'],
      '@stylistic/array-bracket-newline': ['error', 'consistent'],
      '@stylistic/array-element-newline': ['error', 'consistent'],

      // Additional formatting rules
      '@stylistic/comma-spacing': ['error', {before: false, after: true}],
      '@stylistic/key-spacing': ['error', {beforeColon: false, afterColon: true}],
      '@stylistic/quote-props': ['error', 'as-needed'],
      '@stylistic/quotes': ['error', 'single'],
      '@stylistic/no-trailing-spaces': 'error',
      '@stylistic/no-multi-spaces': 'error',
      '@stylistic/space-before-function-paren': ['error', {
        anonymous: 'always',
        named: 'never',
        asyncArrow: 'always'
      }],

      // Function formatting - keep functions readable
      '@stylistic/function-paren-newline': ['error', 'consistent'],
      '@stylistic/function-call-spacing': ['error', 'never'],

      // Brace style
      '@stylistic/brace-style': ['error', '1tbs', {allowSingleLine: true}],

      // Spacing
      '@stylistic/space-infix-ops': 'error',
      '@stylistic/space-unary-ops': 'error',

      // Unused variables - ignore variables starting with underscore
      'no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_'
      }],

      // Core is free of environment dependencies: no node built-ins, and nothing built on them
      'no-restricted-imports': ['error', {
        paths: [...builtinModules, 'fs-extra'].map(name => ({
          name,
          message: 'Core runs on any platform; node-only code belongs in index.js'
        })),
        patterns: [{group: ['node:*'], message: 'Core runs on any platform; node-only code belongs in index.js'}]
      }]
    }
  },
  {
    files: NODE_FILES,
    languageOptions: {globals: nodeGlobals},
    rules: {'no-restricted-imports': 'off'}
  }
]
