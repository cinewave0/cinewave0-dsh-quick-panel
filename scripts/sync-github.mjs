#!/usr/bin/env node
/**
 * Commit the working tree, run the host regression suite, then push to GitHub.
 *
 * Usage:
 *   node scripts/sync-github.mjs [--message <text>] [--dry-run] [--no-test] [--tags]
 *
 * Safety:
 *   - never force-pushes;
 *   - stops before pushing when tests fail;
 *   - refuses to push from a detached HEAD.
 */
import { capture, run } from './lib/proc.mjs'

const root = process.cwd()
const argv = process.argv.slice(2)
const flag = (name) => argv.includes(`--${name}`)

function option(name, fallback) {
  const index = argv.indexOf(`--${name}`)
  if (index < 0 || index + 1 >= argv.length || argv[index + 1].startsWith('--')) return fallback
  return argv[index + 1]
}

const dryRun = flag('dry-run')
const noPush = flag('no-push')
const now = new Date()
const pad = (value) => String(value).padStart(2, '0')
const localStamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`
const branch = (capture('git', ['rev-parse', '--abbrev-ref', 'HEAD'], root) || '').trim()
if (!branch) throw new Error('not a git repository')
if (branch === 'HEAD') throw new Error('detached HEAD, checkout a branch before syncing')

const status = capture('git', ['status', '--porcelain'], root)
if (status === null) throw new Error('could not read git status')
const dirty = status.split('\n').map((line) => line.trimEnd()).filter(Boolean)

console.log(`branch    ${branch}`)
console.log(`dirty     ${dirty.length === 0 ? 'clean' : `${dirty.length} path(s)`}`)
for (const line of dirty.slice(0, 20)) console.log(`          ${line}`)
if (dirty.length > 20) console.log(`          ... ${dirty.length - 20} more`)

if (dirty.length > 0) {
  const message = option('message', `chore: sync ${localStamp}`)
  console.log(`commit    ${message}`)
  if (!dryRun) {
    run('git', ['add', '-A'], root)
    run('git', ['commit', '-m', message], root)
  }
} else {
  console.log('commit    nothing to commit')
}

if (!flag('no-test')) {
  console.log('test      node test/host.test.mjs')
  if (!dryRun) run(process.execPath, ['test/host.test.mjs'], root)
}

if (dryRun) {
  console.log('dry-run   no push performed')
  process.exit(0)
}

if (noPush) {
  console.log('no-push   commit only, remote untouched')
  process.exit(0)
}

try {
  run('git', ['push', 'origin', branch], root)
  if (flag('tags')) run('git', ['push', 'origin', '--tags'], root)
  console.log(`pushed    origin/${branch}`)
} catch (error) {
  console.error(`\npush failed: ${error.message}`)
  console.error('common causes: the DSH sandbox blocks the git credential helper (named pipes),')
  console.error('the network is unavailable, or the remote needs credentials.')
  console.error(`retry in a normal terminal:  git push origin ${branch}`)
  process.exitCode = 1
}
