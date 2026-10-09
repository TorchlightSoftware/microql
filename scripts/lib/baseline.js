/**
 * @fileoverview The baseline — 0.6.6, the last release before the 1.0
 * rewrite, which the generated docs compare against. It is read from git,
 * never from the working tree.
 */

import {execFileSync} from 'node:child_process'
import {existsSync} from 'node:fs'
import {mkdir} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

export const BASELINE = '836d9bf'

const git = (...args) => execFileSync('git', args, {encoding: 'utf8', maxBuffer: 64 * 1024 * 1024})

// The files of the baseline commit, and one file's source.
export const baselineFiles = () => git('ls-tree', '-r', '--name-only', BASELINE).split('\n').filter(Boolean)
export const baselineSource = (file) => git('show', `${BASELINE}:${file}`)

// A runnable copy of the baseline with its dependencies installed, made once
// in the system temp directory and reused.
export async function baselineCheckout() {
  const dir = path.join(os.tmpdir(), `microql-${BASELINE}`)
  if (existsSync(path.join(dir, 'node_modules'))) return dir
  await mkdir(dir, {recursive: true})
  execFileSync('tar', ['-x', '-C', dir], {input: execFileSync('git', ['archive', BASELINE], {maxBuffer: 64 * 1024 * 1024})})
  execFileSync('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], {cwd: dir, stdio: 'inherit'})
  return dir
}
