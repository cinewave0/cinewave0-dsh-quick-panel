#!/usr/bin/env node
/**
 * The published index must point at a commit whose package.json version is the
 * version the index advertises. Discover installs that exact commit, so a stale
 * pin makes the market show "update available" forever and reinstall old code.
 *
 * Run from the repository root: node scripts/check-market-index.mjs
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
const index = JSON.parse(readFileSync('market/index.json', 'utf8'))
const entry = Array.isArray(index.plugins)
  ? index.plugins.find((plugin) => plugin.name === pkg.name)
  : undefined
if (!entry) throw new Error(`market index is missing ${pkg.name}`)
const version = Array.isArray(entry.versions)
  ? entry.versions.find((item) => item.version === pkg.version)
  : undefined
if (!version) throw new Error(`market index is missing ${pkg.name}@${pkg.version}`)
if (!version.engines || typeof version.engines.dsh !== 'string') {
  throw new Error(`market index ${pkg.version} has no engines.dsh`)
}
const commit = version.source && version.source.commit
if (typeof commit !== 'string' || !/^[0-9a-f]{40}$/u.test(commit)) {
  throw new Error(`market index ${pkg.version} has no valid source.commit`)
}

let pinned
try {
  pinned = JSON.parse(execFileSync('git', ['show', `${commit}:package.json`], { encoding: 'utf8' }))
} catch (error) {
  throw new Error(
    `cannot read package.json at market commit ${commit} (fetch the commit first): ${String(
      (error && error.message) || error,
    )}`,
  )
}
if (pinned.name !== pkg.name) {
  throw new Error(`market index ${pkg.name} points at ${commit} which is ${pinned.name}`)
}
if (pinned.version !== version.version) {
  throw new Error(
    `market index advertises ${version.version} but ${commit} is ${pinned.version}; ` +
      'point source.commit at the release commit with the matching package.json',
  )
}
console.log(`market index ok: ${pkg.name}@${version.version} -> ${commit}`)
