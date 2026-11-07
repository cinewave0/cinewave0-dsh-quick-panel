import { spawnSync } from 'node:child_process'
import { closeSync, existsSync, openSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Captured child output is blocked by the DSH Windows sandbox (named pipes are
 * unavailable). Fall back to writing stdout straight into a file descriptor,
 * which only needs inherited stdio and no shell.
 */
export function capture(cmd, args, root = process.cwd()) {
  const piped = spawnSync(cmd, args, { cwd: root, encoding: 'utf8' })
  if (!piped.error) return piped.status === 0 ? piped.stdout : null
  if (piped.error.code !== 'EPERM') throw piped.error

  const tmp = join(tmpdir(), `qp-capture-${process.pid}-${Date.now()}.txt`)
  const fd = openSync(tmp, 'w')
  let result
  try {
    result = spawnSync(cmd, args, { cwd: root, stdio: ['ignore', fd, 'ignore'] })
  } finally {
    closeSync(fd)
  }
  if (result.error || result.status !== 0 || !existsSync(tmp)) {
    rmSync(tmp, { force: true })
    return null
  }
  const out = readFileSync(tmp, 'utf8')
  rmSync(tmp, { force: true })
  return out
}

export function run(cmd, args, root = process.cwd()) {
  const result = spawnSync(cmd, args, { cwd: root, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${cmd} ${args.join(' ')} exited ${String(result.status)}`)
}
