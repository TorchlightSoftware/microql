/**
 * @fileoverview The function index — every named function in core, with how
 * often core refers to it, rendered as the tables in function-names.md.
 *
 * A definition is a `function` declaration, a variable whose value is a
 * function, an object property whose value is a function (util resources,
 * store methods), or a class method. Anonymous callbacks are not definitions.
 *
 * A definition's refs count the identifiers naming it in its own file plus in
 * the files that import it, leaving out its declaration, import and export
 * lists, property keys and member names. Properties and methods are
 * dispatched by name at run time, so they get no count.
 */

import path from 'node:path'
import * as espree from 'espree'

const parse = (source) => espree.parse(source, {ecmaVersion: 'latest', sourceType: 'module', loc: true})

// Core: the modules under src, and the entry points at the root (as the
// baseline, which kept every module at the root and the services in
// services/), but not tooling or tests.
export const isCore = (file) =>
  /^(src\/.+|(services\/)?[^/]+)\.js$/.test(file) && file !== 'eslint.config.js'

// Every node of a tree, with its parent and the field it sits in.
function* walk(node, parent, field) {
  yield {node, parent, field}
  for (const [childField, value] of Object.entries(node)) {
    for (const child of [value].flat()) {
      if (typeof child?.type === 'string') yield* walk(child, node, childField)
    }
  }
}

const isFunction = (node) => ['FunctionExpression', 'ArrowFunctionExpression'].includes(node?.type)

const keyName = (key) => key.type === 'Identifier' ? key.name : String(key.value)

// The definition a node makes, as {name, kind, node}, or undefined.
function definitionAt({node, parent}) {
  if (node.type === 'FunctionDeclaration' && node.id) return {name: node.id.name, kind: 'function', node}
  if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier' && isFunction(node.init)) {
    return {name: node.id.name, kind: parent.kind, node}
  }
  if (node.type === 'Property' && !node.computed && isFunction(node.value)) return {name: keyName(node.key), kind: 'property', node}
  if (node.type === 'MethodDefinition') return {name: keyName(node.key), kind: 'method', node}
}

const lineSpan = (node) => ({line: node.loc.start.line, lines: node.loc.end.line - node.loc.start.line + 1})

// The named functions a module defines, in source order.
export function definitionsOf(source) {
  return [...walk(parse(source))].map(definitionAt).filter(Boolean)
    .map(({name, kind, node}) => ({name, kind, ...lineSpan(node)}))
}

// Identifiers that name something without using it.
const NOT_A_USE = {
  FunctionDeclaration: ['id'],
  FunctionExpression: ['id'],
  VariableDeclarator: ['id'],
  ImportSpecifier: ['imported', 'local'],
  ImportDefaultSpecifier: ['local'],
  ExportSpecifier: ['local', 'exported'],
  ExportDefaultDeclaration: ['declaration'],
  MemberExpression: ['property'],
  Property: ['key'],
  MethodDefinition: ['key']
}

const isUse = ({node, parent, field}) =>
  node.type === 'Identifier' && !(parent && !parent.computed && NOT_A_USE[parent.type]?.includes(field))

// How many times each name is used in a module.
const usesIn = (ast) => Map.groupBy([...walk(ast)].filter(isUse), ({node}) => node.name)

// What a module imports from other modules: {from, imported, local}, `from`
// resolved to a path relative to the root.
const importsOf = (ast, file) => ast.body
  .filter(statement => statement.type === 'ImportDeclaration' && statement.source.value.startsWith('.'))
  .flatMap(statement => statement.specifiers.map(specifier => ({
    from: path.posix.join(path.posix.dirname(file), statement.source.value),
    imported: specifier.type === 'ImportDefaultSpecifier' ? 'default' : specifier.imported?.name,
    local: specifier.local.name
  })))

// The name a module's default export refers to, if any.
const defaultExportOf = (ast) => {
  const declaration = ast.body.find(statement => statement.type === 'ExportDefaultDeclaration')?.declaration
  return declaration?.name ?? declaration?.id?.name
}

/**
 * The function index of a set of modules.
 * @param {Object} sources - {file → source}, files relative to the root
 * @param {Set} baseline - the names defined in 0.6.6 core
 * @returns {Array} [{file, definitions: [{line, name, kind, lines, refs, old}]}]
 */
export function functionIndex(sources, baseline) {
  const modules = Object.entries(sources).map(([file, source]) => {
    const ast = parse(source)
    return {file, source, uses: usesIn(ast), imports: importsOf(ast, file), defaultExport: defaultExportOf(ast)}
  })

  // the local names other modules give a definition when they import it
  const importedAs = (file, name, defaultExport) => modules.flatMap(module => module.imports
    .filter(i => i.from === file && (i.imported === name || (i.imported === 'default' && defaultExport === name)))
    .map(i => module.uses.get(i.local)?.length ?? 0))

  const refsOf = (module, {name, kind}) => ['property', 'method'].includes(kind) ? undefined
    : (module.uses.get(name)?.length ?? 0) + importedAs(module.file, name, module.defaultExport).reduce((a, b) => a + b, 0)

  return modules.map(module => ({
    file: module.file,
    definitions: definitionsOf(module.source).map(definition =>
      ({...definition, refs: refsOf(module, definition), old: baseline.has(definition.name)}))
  })).filter(({definitions}) => definitions.length)
}

// The index as markdown: a table per file.
export const renderIndex = (index) => index.map(({file, definitions}) => [
  `## ${file}`,
  '',
  '| line | name | kind | lines | refs | 0.6 |',
  '|---|---|---|---|---|---|',
  ...definitions.map(d => `| ${d.line} | \`${d.name}\` | ${d.kind} | ${d.lines} | ${d.refs ?? '—'} | ${d.old ? '✓' : ''} |`)
].join('\n')).join('\n\n')
