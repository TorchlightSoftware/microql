/**
 * @fileoverview Generated sections — the parts of a hand-written markdown
 * document that a script writes.
 *
 * A section is the text between `<!-- generated:name -->` and
 * `<!-- /generated:name -->`. A script replaces only that text, so everything
 * around it stays as its author wrote it.
 */

import {readFile, writeFile} from 'node:fs/promises'

const markersOf = (name) => [`<!-- generated:${name} -->`, `<!-- /generated:${name} -->`]

// The text with the named section's contents replaced by `body`.
export function replaceSection(text, name, body) {
  const [open, close] = markersOf(name)
  const start = text.indexOf(open)
  const end = text.indexOf(close)
  if (start === -1 || end < start) {
    throw new Error(`No generated section '${name}': mark where it belongs with ${open} and ${close}`)
  }
  return `${text.slice(0, start + open.length)}\n${body.trim()}\n${text.slice(end)}`
}

// Rewrites the named section of a file in place.
export async function writeSection(file, name, body) {
  await writeFile(file, replaceSection(await readFile(file, 'utf8'), name, body))
}
