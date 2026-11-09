/**
 * Exercises the first-open provisioning path without the real ~140 MB Electron
 * artifact: a tiny zip with the same `electron.exe` shape is served from a
 * loopback HTTP server, downloaded, hash-checked, extracted, and merged into
 * $DSH_HOME/electron.
 *
 * Run with: node test/runtime-install.test.mjs
 * Extraction uses Windows' bsdtar/Expand-Archive, so this test only runs on Windows.
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import test, { after } from 'node:test'
import { installElectronRuntime } from '../index.js'

const ZIP = Buffer.from(
  'UEsDBBQAAAAIANC6aV11K5/mKwAAACoAAAAMAAAAZWxlY3Ryb24uZXhlBcGBCQAgCATAVX61DAshNPQL2r674hHo0s4Mh5i3fBiR2BnXysLNJ6jFD1BLAQIUABQAAAAIANC6aV11K5/mKwAAACoAAAAMAAAAAAAAAAAAAAAAAAAAAABlbGVjdHJvbi5leGVQSwUGAAAAAAEAAQA6AAAAVQAAAAAA',
  'base64',
)
const home = join(import.meta.dirname, '.runtime-home')
const previousHome = process.env.DSH_HOME
after(() => {
  if (previousHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousHome
})

async function withZipServer(run) {
  rmSync(home, { recursive: true, force: true })
  mkdirSync(home, { recursive: true })
  process.env.DSH_HOME = home
  const server = createServer((request, response) => {
    if (request.url !== '/electron.zip') {
      response.writeHead(404)
      response.end()
      return
    }
    response.writeHead(200, {
      'content-type': 'application/zip',
      'content-length': String(ZIP.length),
    })
    response.end(ZIP)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    await run(`http://127.0.0.1:${server.address().port}/electron.zip`)
  } finally {
    server.close()
    rmSync(home, { recursive: true, force: true })
  }
}

const plan = (url, sha256) => ({
  artifact: { sha256, bytes: ZIP.length },
  urls: [url],
})

test(
  'provisioning downloads, verifies, extracts and installs the runtime',
  { skip: process.platform !== 'win32' },
  async () => {
    await withZipServer(async (url) => {
      const updates = []
      const result = await installElectronRuntime(
        plan(url, createHash('sha256').update(ZIP).digest('hex')),
        (update) => updates.push(update.status),
      )
      assert.ok(existsSync(result.path), 'the installed binary exists')
      assert.ok(statSync(result.path).isFile(), 'the installed binary is a file')
      assert.equal(result.path, join(home, 'electron', 'electron.exe'))
      assert.ok(updates.includes('downloading'), 'emits download progress')
      assert.ok(updates.includes('extracting'), 'emits extraction progress')
      assert.deepEqual(readdirSync(join(home, 'electron')).filter((name) => name.startsWith('.')), [])
    })
  },
)

test(
  'a checksum mismatch installs nothing and cleans up',
  { skip: process.platform !== 'win32' },
  async () => {
    await withZipServer(async (url) => {
      await assert.rejects(
        () => installElectronRuntime(plan(url, '0'.repeat(64)), () => {}),
        /sha256 mismatch/iu,
      )
      assert.equal(existsSync(join(home, 'electron', 'electron.exe')), false)
    })
  },
)
