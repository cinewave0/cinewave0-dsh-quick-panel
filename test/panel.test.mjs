import { createServer } from 'node:http'
import { readFileSync, rmSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..')
const panelRoot = join(root, 'panel')
const origin = 'http://127.0.0.1:38922'
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGM8oaHBwMDAxAAGAA3qARx2dNdFAAAAAElFTkSuQmCC',
  'base64',
)

const html = readFileSync(join(panelRoot, 'index.html'))
const css = readFileSync(join(panelRoot, 'panel.css'))
const js = readFileSync(join(panelRoot, 'panel.js'))
const icon = readFileSync(join(panelRoot, 'icon.png'))

let approvalNo = 1
let approval = {
  key: `approval:${approvalNo}`,
  toolName: 'bash',
  reason: '需要管理员权限执行命令',
  callId: 'call-1',
  sessionId: 'session-test',
  since: Date.now(),
}
let question = null
const answers = []
const questionAnswers = []

const server = createServer((request, response) => {
  const url = new URL(request.url, origin)
  if (url.pathname === '/quick-panel/panel') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end(html)
    return
  }
  if (url.pathname === '/quick-panel/panel.css') {
    response.writeHead(200, { 'content-type': 'text/css; charset=utf-8' })
    response.end(css)
    return
  }
  if (url.pathname === '/quick-panel/panel.js') {
    response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' })
    response.end(js)
    return
  }
  if (url.pathname === '/quick-panel/panel-icon.png') {
    response.writeHead(200, { 'content-type': 'image/png' })
    response.end(icon)
    return
  }
  if (url.pathname === '/quick-panel/attachment') {
    response.writeHead(200, { 'content-type': 'image/png', 'content-length': String(png.length) })
    response.end(png)
    return
  }
  if (url.pathname === '/quick-panel/state') {
    response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
    response.end(
      JSON.stringify({
        ok: true,
        rev: 1,
        todos: [],
        reminders: [],
        todos: [
          { id: 't1', text: '第一条待办', done: false, handedOff: false, createdAt: Date.now() - 3000 },
          { id: 't2', text: '第二条待办', done: false, handedOff: false, createdAt: Date.now() - 2000 },
        ],
        reminders: [
          { id: 'r1', text: '第一个提醒', at: Date.now() + 3600000, repeat: 'none', firedFor: null },
          { id: 'r2', text: '第二个提醒', at: Date.now() + 7200000, repeat: 'none', firedFor: null },
        ],
        settings: {},
        activeSessionId: 'session-test',
        sessionLabel: '测试对话 · session',
        companionOpen: true,
        feed: [
          {
            kind: 'user',
            time: Date.now() - 10000,
            text: '测试图片',
            hasImage: true,
            images: [
              {
                id: 'img1',
                mediaType: 'image/png',
                width: 2,
                height: 2,
                bytes: png.length,
                name: 'test.png',
              },
            ],
          },
          {
            kind: 'assistant',
            time: Date.now() - 9000,
            blocks: [{ kind: 'text', text: '收到测试图片。' }],
          },
        ],
        partial: null,
        running: false,
        latest: '收到测试图片。',
        approval,
        question,
        usage: {
          sessionKnown: true,
          sessionTokens: 88700000,
          sessionOutputTokens: 183000,
          tps: 45.3,
          contextPercent: 34.2,
          contextTokens: 358000,
          contextWindow: 1048576,
          workingDirectory: 'D:\\workspace',
          thirtyDayTokens: 1200000000,
          thirtyDayOutputTokens: 3400000,
          sessionCount: 12,
          balance: {
            status: 'ready',
            wallets: [{ currency: 'CNY', balance: '12.34' }],
            bonusWallets: [{ currency: 'CNY', balance: '1.00' }],
          },
        },
      }),
    )
    return
  }
  if (url.pathname === '/test/answers') {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify(answers))
    return
  }
  if (url.pathname === '/test/approval') {
    approvalNo += 1
    approval = {
      key: `approval:${approvalNo}`,
      toolName: 'bash',
      reason: '需要管理员权限执行命令',
      callId: `call-${approvalNo}`,
      sessionId: 'session-test',
      since: Date.now(),
    }
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ ok: true, approval }))
    return
  }
  if (url.pathname === '/test/question') {
    question = {
      key: 'question:session-test:call-question',
      sessionId: 'session-test',
      kind: 'question',
      callId: 'call-question',
      state: 'open',
      waitState: 'counting',
      questions: [
        {
          id: 'q1',
          question: '请选择一个测试选项',
          options: [
            { label: '选项 A', description: '第一个' },
            { label: '选项 B', description: '第二个' },
          ],
        },
      ],
    }
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ ok: true }))
    return
  }
  if (url.pathname === '/test/question-answers') {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify(questionAnswers))
    return
  }
  if (url.pathname === '/quick-panel/action') {
    let body = ''
    request.on('data', (chunk) => {
      body += chunk
    })
    request.on('end', () => {
      try {
        const value = JSON.parse(body)
        if (value && value.type === 'approval-answer') {
          answers.push(value)
          if (approval && approval.key === value.key) approval = null
        }
        if (value && value.type === 'question-answer') {
          questionAnswers.push(value)
        }
      } catch (_error) {
        /* ignore */
      }
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ ok: true }))
    })
    return
  }
  response.writeHead(404)
  response.end('not found')
})
await new Promise((resolve) => server.listen(38922, '127.0.0.1', resolve))

const child = spawn(
  'C:\\Users\\user\\.dsh\\electron\\electron.exe',
  [
    '--no-sandbox',
    '--disable-gpu',
    `--user-data-dir=${join(import.meta.dirname, '.userdata')}`,
    join(import.meta.dirname, 'panel-main.cjs'),
  ],
  { stdio: 'inherit', env: { ...process.env, PANEL_TEST_ORIGIN: origin } },
)
const code = await new Promise((resolve) => child.on('exit', resolve))
server.close()
try {
  rmSync(join(import.meta.dirname, '.userdata'), { recursive: true, force: true })
} catch (_error) {
  /* the profile may still be releasing its lock */
}
if (code !== 0) process.exit(code || 1)
console.log('PANEL TEST PASSED')
