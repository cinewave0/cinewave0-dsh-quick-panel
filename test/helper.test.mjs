/**
 * Smoke test for the real Electron helper (not the DOM-only panel test).
 *
 * Starts a fake Host, launches `runtime/electron-helper/main.cjs` with
 * Electron, and waits for the panel page's boot-time `companion-ping`. That is
 * the same readiness signal the production Host now waits for.
 *
 * Run with: node test/helper.test.mjs
 * Skips when no Electron is installed, or on Linux without a display.
 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

const root = join(import.meta.dirname, '..')
const electronRelative =
  process.platform === 'win32'
    ? 'electron.exe'
    : process.platform === 'darwin'
      ? join('Electron.app', 'Contents', 'MacOS', 'Electron')
      : 'electron'
const electron =
  process.env.DSH_ELECTRON ||
  join(process.env.DSH_HOME || join(process.env.HOME || '', '.dsh'), 'electron', electronRelative)
const displayAvailable = process.platform !== 'linux' || Boolean(process.env.DISPLAY)
const skip = !existsSync(electron) || !displayAvailable

const files = {
  '/quick-panel/panel': ['index.html', 'text/html; charset=utf-8'],
  '/quick-panel/panel.css': ['panel.css', 'text/css; charset=utf-8'],
  '/quick-panel/panel.js': ['panel.js', 'text/javascript; charset=utf-8'],
  '/quick-panel/panel-icon.png': ['icon.png', 'image/png'],
}

test('the real helper loads the panel and pings the Host', { skip }, async () => {
  const home = join(import.meta.dirname, '.helper-home')
  rmSync(home, { recursive: true, force: true })
  mkdirSync(home, { recursive: true })

  let settlePing
  const pinged = new Promise((resolve) => {
    settlePing = resolve
  })
  const server = createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1')
    if (files[url.pathname]) {
      const [file, type] = files[url.pathname]
      response.writeHead(200, { 'content-type': type })
      response.end(readFileSync(join(root, 'panel', file)))
      return
    }
    if (url.pathname === '/quick-panel/state') {
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      response.end(
        JSON.stringify({
          ok: true,
          rev: 0,
          todos: [],
          reminders: [],
          settings: {},
          activeSessionId: null,
          sessionLabel: '',
          recentSessions: [],
          switchRequest: null,
          companionOpen: false,
          feed: [],
          feedSource: 'client',
          feedHasOlder: false,
          partial: null,
          running: false,
          latest: '',
          approval: null,
          question: null,
          questionAnswer: null,
          usage: null,
        }),
      )
      return
    }
    if (url.pathname === '/quick-panel/action' && request.method === 'POST') {
      let body = ''
      request.on('data', (chunk) => {
        body += chunk
      })
      request.on('end', () => {
        try {
          if (JSON.parse(body).type === 'companion-ping') settlePing()
        } catch (_error) {
          /* malformed actions are not this test's concern */
        }
        response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
        response.end('{"ok":true}')
      })
      return
    }
    response.writeHead(404)
    response.end()
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  const url = `${origin}/quick-panel/panel?token=test-token`

  const env = {
    ...process.env,
    DSH_HOME: home,
    QUICK_PANEL_URL: url,
    QUICK_PANEL_HOST_PID: String(process.pid),
  }
  delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(
    electron,
    [
      '--no-sandbox',
      `--user-data-dir=${join(home, 'user-data')}`,
      join(root, 'runtime', 'electron-helper', 'main.cjs'),
      `--url=${url}`,
    ],
    { env, stdio: ['ignore', 'pipe', 'pipe'] },
  )
  let output = ''
  child.stdout.on('data', (chunk) => {
    output += chunk
  })
  child.stderr.on('data', (chunk) => {
    output += chunk
  })

  let timer = 0
  try {
    await Promise.race([
      pinged,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`no companion-ping within 20s\n${output}`)), 20000)
      }),
    ])
    assert.equal(typeof child.pid, 'number')
  } finally {
    if (timer) clearTimeout(timer)
    child.kill('SIGTERM')
    await Promise.race([
      new Promise((resolve) => child.once('exit', resolve)),
      new Promise((resolve) => setTimeout(resolve, 2000)),
    ])
    if (child.exitCode === null) child.kill('SIGKILL')
    server.close()
    rmSync(home, { recursive: true, force: true })
  }
})
