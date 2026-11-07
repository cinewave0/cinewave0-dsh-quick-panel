#!/usr/bin/env node
/**
 * Create a source backup of the quick-panel working tree.
 *
 * Usage:
 *   node scripts/backup.mjs [--out <dir>] [--label <text>]
 *
 * Output (default `../backups` next to the repo):
 *   quick-panel-<version>-<timestamp>[-<label>].zip
 *   quick-panel-...zip.sha256
 *   quick-panel-...zip.manifest.json
 *
 * The zip contains the working tree including `.git` (full history) but not
 * `node_modules`, test runtime state, or nested tarballs. The manifest records
 * the version, branch, HEAD, uncommitted paths, size and checksum.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { capture, run } from './lib/proc.mjs'

const root = process.cwd()
const argv = process.argv.slice(2)
const opt = (name, fallback) => {
  const index = argv.indexOf(`--${name}`)
  if (index < 0 || index + 1 >= argv.length || argv[index + 1].startsWith('--')) return fallback
  return argv[index + 1]
}

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const head = (capture('git', ['rev-parse', 'HEAD'], root) || '').trim() || null
const branch = (capture('git', ['rev-parse', '--abbrev-ref', 'HEAD'], root) || '').trim() || null
const statusText = capture('git', ['status', '--porcelain'], root)
const dirty = (statusText || '')
  .split('\n')
  .map((line) => line.trimEnd())
  .filter(Boolean)

const now = new Date()
const pad = (value) => String(value).padStart(2, '0')
const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
const label = (opt('label', '') || '').replace(/[^\w.-]+/gu, '-').replace(/^-+|-+$/gu, '')
const outDir = resolve(opt('out', join(root, '..', 'backups')))
mkdirSync(outDir, { recursive: true })

const base = `quick-panel-${pkg.version}-${stamp}${label ? `-${label}` : ''}`
const zipPath = join(outDir, `${base}.zip`)

run(
  'tar',
  [
    '-a',
    '-c',
    '-f',
    zipPath,
    '--exclude=node_modules',
    '--exclude=test/output',
    '--exclude=test/.state',
    '--exclude=test/.userdata',
    '--exclude=*.tgz',
    '--exclude=.DS_Store',
    '.',
  ],
  root,
)

if (!existsSync(zipPath)) throw new Error(`backup was not created: ${zipPath}`)
const bytes = statSync(zipPath).size
const signature = readFileSync(zipPath).subarray(0, 4).toString('hex')
if (signature !== '504b0304') throw new Error(`backup is not a zip (signature ${signature})`)

const sha256 = createHash('sha256').update(readFileSync(zipPath)).digest('hex').toUpperCase()
writeFileSync(`${zipPath}.sha256`, `${sha256}  ${basename(zipPath)}\n`)
const manifest = {
  name: pkg.name,
  version: pkg.version,
  createdAt: now.toISOString(),
  branch,
  head,
  dirty,
  zip: basename(zipPath),
  bytes,
  sha256,
}
writeFileSync(`${zipPath}.manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`)

console.log(`backup    ${zipPath}`)
console.log(`size      ${(bytes / 1024).toFixed(1)} KB`)
console.log(`head      ${head ?? 'unknown'}${branch ? ` (${branch})` : ''}`)
console.log(`dirty     ${dirty.length === 0 ? 'clean' : `${dirty.length} path(s)`}`)
console.log(`sha256    ${sha256}`)
