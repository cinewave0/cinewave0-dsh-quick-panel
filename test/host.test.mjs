import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import test, { after } from 'node:test'
import { apply } from '../index.js'

const ROOT = join(import.meta.dirname, '.state')
/** Same per-platform name the Host resolves under $DSH_HOME/electron. */
const ELECTRON_RELATIVE = process.platform === 'win32' ? 'electron.exe' : 'electron'
const previousNoDownload = process.env.DSH_QUICK_PANEL_NO_RUNTIME_DOWNLOAD
process.env.DSH_QUICK_PANEL_NO_RUNTIME_DOWNLOAD = '1'
after(() => {
  if (previousNoDownload === undefined) delete process.env.DSH_QUICK_PANEL_NO_RUNTIME_DOWNLOAD
  else process.env.DSH_QUICK_PANEL_NO_RUNTIME_DOWNLOAD = previousNoDownload
})

function makeHarness(name, options = {}) {
  const home = join(ROOT, name)
  rmSync(home, { recursive: true, force: true })
  mkdirSync(join(home, 'quick-panel'), { recursive: true })
  writeFileSync(
    join(home, 'quick-panel', 'state.json'),
    JSON.stringify({
      version: 1,
      rev: 1,
      todos: [],
      reminders: [],
      settings: {},
      activeSessionId: options.activeSessionId || null,
    }),
  )
  if (options.projection) {
    const directory = join(home, 'storages', 'session_projcache', 'sessions')
    mkdirSync(directory, { recursive: true })
    writeFileSync(
      join(directory, `${options.projection.id}.json`),
      JSON.stringify({ version: 1, record: { identity: options.projection.id, rows: [options.projection.row] } }),
    )
  }
  if (options.projections) {
    const directory = join(home, 'storages', 'session_projcache', 'sessions')
    mkdirSync(directory, { recursive: true })
    for (const projection of options.projections) {
      writeFileSync(
        join(directory, `${projection.id}.json`),
        JSON.stringify({ version: 1, record: { identity: projection.id, rows: [projection.row] } }),
      )
    }
  }
  if (options.archivedSessionIds) {
    mkdirSync(join(home, 'storages'), { recursive: true })
    writeFileSync(
      join(home, 'storages', 'workspace.json'),
      JSON.stringify({
        unit: { name: 'workspace', version: 2 },
        global: {
          initialized: true,
          workspaceIds: [],
          archivedSessionIds: options.archivedSessionIds,
          pinnedSessionIds: [],
        },
        tables: { workspaces: {} },
      }),
    )
  }
  process.env.DSH_HOME = home

  const routes = new Map()
  const listeners = new Map()
  const injected = []
  const webServer = {
    getOrigin: () => options.origin || 'http://127.0.0.1:9999',
    register: (route) => {
      routes.set(route.path, route)
      return () => routes.delete(route.path)
    },
  }
  apply({
    get: (service) => {
      if (service === 'webServer') return webServer
      if (service === 'sessions') {
        return {
          get: (id) => (options.session && options.session.id === id ? options.session : undefined),
        }
      }
      if (service === 'sessionController') return options.sessionController || null
      if (service === 'fileUploads') return options.fileUploads || null
      if (service === 'deepseekAccount') return options.account || null
      return null
    },
    effect: (fn) => fn(),
    on: (event, callback) => {
      if (event === 'webserver/index-inject') injected.push(callback)
      else listeners.set(event, callback)
      return () => {}
    },
  })
  const table = []
  for (const callback of injected) callback(table)
  const token = table[0].value.token

  const makeRequest = ({ method = 'GET', url, body, headers = {} }) => {
    const stream = new Readable({ read() {} })
    stream.method = method
    stream.url = url
    stream.headers = headers
    if (body !== undefined) stream.push(body)
    stream.push(null)
    return stream
  }
  const makeResponse = () => {
    const res = {
      statusCode: 200,
      headers: {},
      body: null,
      writes: [],
      listeners: {},
      writeHead: (status, headers) => {
        res.statusCode = status
        for (const [name, value] of Object.entries(headers || {})) {
          res.headers[name.toLowerCase()] = value
        }
      },
      write: (chunk) => {
        res.writes.push(String(chunk))
        return true
      },
      on: (event, callback) => {
        res.listeners[event] = callback
        return res
      },
      setHeader: (name, value) => {
        res.headers[name.toLowerCase()] = value
      },
      end: (chunk) => {
        if (chunk !== undefined) res.body = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
        res.done()
      },
    }
    res.finished = new Promise((resolve) => {
      res.done = resolve
    })
    return res
  }
  const call = async (path, { method = 'GET', body, headers = {} } = {}) => {
    const res = makeResponse()
    const route = routes.get(path.split('?')[0])
    assert.ok(route, `missing route ${path}`)
    await route.handler(makeRequest({ method, url: path, body, headers }), res)
    await res.finished
    return {
      status: res.statusCode,
      headers: res.headers,
      body: res.body,
      json:
        res.body && /json/.test(res.headers['content-type'] || '')
          ? JSON.parse(res.body.toString('utf8'))
          : null,
    }
  }
  const query = `token=${encodeURIComponent(token)}`
  const openEvents = () => {
    const res = makeResponse()
    const route = routes.get('/quick-panel/events')
    assert.ok(route, 'events route missing')
    route.handler(makeRequest({ method: 'GET', url: `/quick-panel/events?${query}`, headers: {} }), res)
    return res
  }
  const post = (value) =>
    call(`/quick-panel/action?${query}`, {
      method: 'POST',
      body: JSON.stringify(value),
      headers: { 'content-type': 'application/json', 'x-quick-panel-token': token },
    })
  return {
    token,
    query,
    home,
    call,
    post,
    openEvents,
    listeners,
    state: async () => (await call(`/quick-panel/state?${query}`)).json,
    cleanup: () => rmSync(home, { recursive: true, force: true }),
  }
}

test('state requires the process token and exposes usage defaults', async () => {
  const harness = makeHarness('auth')
  try {
    const unauthorized = await harness.call('/quick-panel/state')
    assert.equal(unauthorized.status, 401)
    const state = await harness.state()
    assert.equal(state.ok, true)
    assert.equal(state.usage.thirtyDayTokens, 0)
    assert.equal(state.usage.contextPercent, null)
    assert.equal(state.usage.balance.status, 'unavailable')
  } finally {
    harness.cleanup()
  }
})

test('image attachment registration, exact read and cache', async () => {
  const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])
  const calls = []
  const sessionController = {
    attachment: async (request) => {
      calls.push(request)
      return { attachment: request.attachment, data: bytes.toString('base64') }
    },
  }
  const harness = makeHarness('image', { sessionController })
  try {
    const ref = {
      attachmentId: `sha256:${'a'.repeat(64)}`,
      mediaType: 'image/png',
      width: 640,
      height: 480,
      bytes: bytes.length,
      name: 'shot.png',
    }
    await harness.post({
      feed: [{ kind: 'user', time: Date.now(), text: '看图', hasImage: true, images: [{ ref }] }],
    })
    let state = await harness.state()
    assert.equal(state.feed[0].images[0].id, ref.attachmentId)
    assert.equal(state.feed[0].images[0].ref, undefined)
    const id = encodeURIComponent(ref.attachmentId)
    let image = await harness.call(`/quick-panel/attachment?id=${id}&${harness.query}`)
    assert.equal(image.status, 200)
    assert.equal(image.headers['content-type'], 'image/png')
    assert.deepEqual(image.body, bytes)
    assert.equal(calls.length, 1)
    image = await harness.call(`/quick-panel/attachment?id=${id}&${harness.query}`)
    assert.equal(image.status, 200)
    assert.equal(calls.length, 1)
    const unknown = await harness.call(
      `/quick-panel/attachment?id=${encodeURIComponent('sha256:missing')}&${harness.query}`,
    )
    assert.equal(unknown.status, 404)
  } finally {
    harness.cleanup()
  }
})

test('approval claim, allow/reject, stale and delegation', async () => {
  const harness = makeHarness('approval', { activeSessionId: 'session-test' })
  try {
    await harness.post({ type: 'companion-ping' })
    await harness.post({ dshVisible: false })
    const listener = harness.listeners.get('approval/request')
    assert.equal(typeof listener, 'function')
    let nextCalls = 0
    const next = async () => {
      nextCalls += 1
      return 'builtin'
    }
    const request = (overrides = {}) => ({
      agent: { session: { id: 'session-test' } },
      toolName: 'bash',
      reason: '需要管理员权限',
      signal: new AbortController().signal,
      ...overrides,
    })

    let pending = listener(request(), next)
    let state = await harness.state()
    assert.match(state.approval.key, /^approval:/)
    let result = await harness.post({
      type: 'approval-answer',
      key: state.approval.key,
      outcome: 'allow',
    })
    assert.equal(result.status, 200)
    assert.equal(await pending, 'allowed-once')
    assert.equal((await harness.state()).approval, null)

    await harness.post({ dshVisible: true })
    const focused = await listener(request(), next)
    assert.equal(focused, 'builtin')
    await harness.post({ dshVisible: false })

    pending = listener(request(), next)
    state = await harness.state()
    result = await harness.post({
      type: 'approval-answer',
      key: state.approval.key,
      outcome: 'reject',
    })
    assert.equal(result.status, 200)
    assert.equal(await pending, 'rejected')

    result = await harness.post({
      type: 'approval-answer',
      key: 'approval:missing',
      outcome: 'allow',
    })
    assert.equal(result.status, 409)

    const before = nextCalls
    result = await listener(request({ agent: { session: { id: 'session-other' } } }), next)
    assert.equal(result, 'builtin')
    assert.equal(nextCalls, before + 1)

    pending = listener(request(), next)
    const second = await listener(request(), next)
    assert.equal(second, 'builtin')
    state = await harness.state()
    await harness.post({ type: 'approval-answer', key: state.approval.key, outcome: 'allow' })
    await pending
  } finally {
    harness.cleanup()
  }
})

test('approval lock keeps the companion in charge while DSH is visible', async () => {
  const harness = makeHarness('approval-lock', { activeSessionId: 'session-test' })
  try {
    await harness.post({ type: 'companion-ping' })
    await harness.post({ dshVisible: true })
    const listener = harness.listeners.get('approval/request')
    let nextCalls = 0
    const next = async () => {
      nextCalls += 1
      return 'builtin'
    }
    const request = (overrides = {}) => ({
      agent: { session: { id: 'session-test' } },
      toolName: 'pwsh',
      reason: '需要管理员权限',
      signal: new AbortController().signal,
      ...overrides,
    })

    // Lock off: a visible DSH keeps its own card.
    assert.equal(await listener(request(), next), 'builtin')

    const lock = await harness.post({ type: 'set-approval-lock', enabled: true })
    assert.equal(lock.status, 200)
    assert.equal((await harness.state()).settings.lockApproval, true)

    // Locked: the companion claims even though DSH is visible.
    const pending = listener(request(), next)
    const state = await harness.state()
    assert.match(state.approval.key, /^approval:/)
    assert.equal(nextCalls, 1)

    // Unlocking hands the pending request back to DSH immediately.
    const unlock = await harness.post({ type: 'set-approval-lock', enabled: false })
    assert.equal(unlock.status, 200)
    assert.equal(unlock.json.handedBack, true)
    assert.equal(await pending, 'builtin')
    assert.equal((await harness.state()).approval, null)
    assert.equal((await harness.state()).settings.lockApproval, false)
  } finally {
    harness.cleanup()
  }
})

test('approval lock does not claim without a live companion heartbeat', async () => {
  const harness = makeHarness('approval-lock-nocompanion', { activeSessionId: 'session-test' })
  try {
    await harness.post({ dshVisible: true })
    await harness.post({ type: 'set-approval-lock', enabled: true })
    const listener = harness.listeners.get('approval/request')
    let nextCalls = 0
    const next = async () => {
      nextCalls += 1
      return 'builtin'
    }
    const result = await listener(
      {
        agent: { session: { id: 'session-test' } },
        toolName: 'pwsh',
        reason: '需要权限',
        signal: new AbortController().signal,
      },
      next,
    )
    assert.equal(result, 'builtin')
    assert.equal(nextCalls, 1)
    assert.equal((await harness.state()).approval, null)
  } finally {
    harness.cleanup()
  }
})

test('upload staging feeds prompt attachments', async () => {
  const prompts = []
  const fileUploads = {
    async uploadStream({ sessionId, data, name }) {
      let bytes = 0
      for await (const chunk of data) bytes += chunk.length
      return { receiptId: `receipt-${name}`, file: { ref: name, sessionId, bytes } }
    },
    async uploadImageStream({ sessionId, data, name, mediaType }) {
      let bytes = 0
      for await (const chunk of data) bytes += chunk.length
      return { receiptId: `receipt-${name}`, image: { ref: name, sessionId, mediaType, bytes } }
    },
  }
  const sessionController = {
    prompt: async (request) => {
      prompts.push(request)
      return { accepted: true }
    },
  }
  const harness = makeHarness('upload', { activeSessionId: 'session-test', fileUploads, sessionController })
  try {
    const body = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const uploaded = await harness.call(
      `/quick-panel/upload?sessionId=session-test&name=drop.png&mediaType=image/png&${harness.query}`,
      {
        method: 'POST',
        body,
        headers: { 'content-type': 'application/octet-stream', 'x-quick-panel-token': harness.token },
      },
    )
    assert.equal(uploaded.status, 200)
    assert.equal(uploaded.json.ok, true)
    assert.equal(uploaded.json.kind, 'image')
    assert.equal(uploaded.json.receiptId, 'receipt-drop.png')

    const mismatch = await harness.call(
      `/quick-panel/upload?sessionId=session-other&name=x.txt&${harness.query}`,
      { method: 'POST', body: Buffer.from('x'), headers: { 'x-quick-panel-token': harness.token } },
    )
    assert.equal(mismatch.status, 409)

    const prompted = await harness.post({
      type: 'prompt',
      text: '看图',
      attachments: [{ receiptId: 'receipt-drop.png', kind: 'image', name: 'drop.png' }],
    })
    assert.equal(prompted.status, 200)
    assert.equal(prompts.length, 1)
    assert.equal(prompts[0].sessionId, 'session-test')
    assert.deepEqual(prompts[0].content, [
      { type: 'file', receiptId: 'receipt-drop.png' },
      { type: 'text', text: '看图' },
    ])
  } finally {
    harness.cleanup()
  }
})

test('usage aggregation, current-session fallback and balance cache', async () => {
  const now = Date.now()
  let balanceCalls = 0
  const projection = {
    id: 'session-test',
    row: {
      tokenUsage: {
        ver: 2,
        seq: 1,
        val: {
          totals: {
            uncachedInputTokens: 100,
            cacheReadTokens: 1000,
            cacheWriteTokens: 0,
            outputTokens: 50,
          },
          last: null,
        },
      },
      sessionStats: { ver: 1, seq: 1, val: { decodeMs: 1000, decodeTokens: 100 } },
      sessionListMetadata: { ver: 1, seq: 1, val: { lastPromptAt: now } },
    },
  }
  const account = {
    getBalance: async () => {
      balanceCalls += 1
      return {
        status: 'ready',
        value: [{ currency: 'CNY', balance: '12.34' }],
        bonusWallets: [],
      }
    },
  }
  const harness = makeHarness('usage', {
    activeSessionId: 'session-test',
    projection,
    account,
  })
  try {
    let state = await harness.state()
    assert.equal(state.usage.sessionKnown, true)
    assert.equal(state.usage.sessionTokens, 1150)
    assert.equal(state.usage.tps, 100)
    assert.equal(state.usage.thirtyDayTokens, 1150)
    assert.equal(state.usage.balance.status, 'loading')
    await new Promise((resolve) => setTimeout(resolve, 20))
    state = await harness.state()
    assert.equal(state.usage.balance.status, 'ready')
    assert.equal(state.usage.balance.wallets[0].balance, '12.34')
    assert.equal(balanceCalls, 1)
  } finally {
    harness.cleanup()
  }
})

test('recent sessions expose five switches, skip archived ones and relay a switch', async () => {
  const now = Date.now()
  const row = (at) => ({ sessionListMetadata: { ver: 1, seq: 1, val: { lastPromptAt: at } } })
  const projections = [
    { id: 'session-a', row: row(now - 1000) },
    { id: 'session-archived', row: row(now - 500) },
    { id: 'session-b', row: row(now - 5000) },
    { id: 'session-c', row: row(now - 9000) },
    { id: 'session-d', row: row(now - 13000) },
    { id: 'session-e', row: row(now - 17000) },
    { id: 'session-f', row: row(now - 21000) },
  ]
  const harness = makeHarness('recent', {
    activeSessionId: 'session-a',
    projections,
    archivedSessionIds: ['session-archived'],
  })
  try {
    let state = await harness.state()
    assert.deepEqual(
      state.recentSessions.map((item) => item.sessionId),
      ['session-a', 'session-b', 'session-c', 'session-d', 'session-e'],
    )
    assert.equal(state.switchRequest, null)

    const active = await harness.post({ type: 'switch-session', sessionId: 'session-a' })
    assert.equal(active.status, 200)
    assert.equal(active.json.alreadyActive, true)

    const missing = await harness.post({ type: 'switch-session', sessionId: 'session-missing' })
    assert.equal(missing.status, 409)
    const traversal = await harness.post({ type: 'switch-session', sessionId: '../workspace' })
    assert.equal(traversal.status, 409)
    const empty = await harness.post({ type: 'switch-session' })
    assert.equal(empty.status, 400)

    const switched = await harness.post({ type: 'switch-session', sessionId: 'session-c' })
    assert.equal(switched.status, 200)
    assert.equal(switched.json.ok, true)
    state = await harness.state()
    assert.equal(state.switchRequest.sessionId, 'session-c')
    assert.equal(state.switchRequest.id, switched.json.id)

    await harness.post({ type: 'switch-session-ack', id: switched.json.id })
    state = await harness.state()
    assert.equal(state.switchRequest, null)

    await harness.post({ type: 'switch-session', sessionId: 'session-d' })
    await harness.post({ activeSessionId: 'session-d' })
    state = await harness.state()
    assert.equal(state.activeSessionId, 'session-d')
    assert.equal(state.switchRequest, null)
  } finally {
    harness.cleanup()
  }
})

test('question mirror and answer relay', async () => {
  const harness = makeHarness('question', { activeSessionId: 'session-test' })
  try {
    await harness.post({
      question: {
        key: 'question:session-test:call-1',
        sessionId: 'session-test',
        kind: 'question',
        callId: 'call-1',
        state: 'open',
        waitState: 'counting',
        questions: [
          {
            id: 'q1',
            question: '选一个',
            options: [{ label: 'A' }, { label: 'B', description: '第二个' }],
          },
        ],
      },
    })
    let state = await harness.state()
    assert.equal(state.question.key, 'question:session-test:call-1')
    assert.equal(state.question.questions[0].options[1].label, 'B')
    assert.equal(state.question.questions[0].options[1].description, '第二个')

    const answer = await harness.post({
      type: 'question-answer',
      key: state.question.key,
      answers: [{ id: 'q1', selected: ['B'] }],
    })
    assert.equal(answer.status, 200)
    state = await harness.state()
    assert.equal(state.questionAnswer.key, 'question:session-test:call-1')
    assert.equal(state.questionAnswer.answers[0].selected[0], 'B')

    await harness.post({
      type: 'question-answer-ack',
      key: 'question:session-test:call-1',
    })
    state = await harness.state()
    assert.equal(state.questionAnswer, null)

    await harness.post({ question: null })
    state = await harness.state()
    assert.equal(state.question, null)
  } finally {
    harness.cleanup()
  }
})

test('host feed paginates older events and tracks running', async () => {
  const now = Date.now()
  const events = Array.from({ length: 100 }, (_, index) => ({
    type: 'user/message',
    seq: index + 1,
    time: now - (100 - index) * 1000,
    surfaceOp: 'append',
    data: { content: [{ type: 'text', text: `m${index + 1}` }], source: { kind: 'user' } },
  }))
  const session = {
    id: 'session-test',
    seq: 100,
    running: true,
    snapshotEvents: (start, end) => events.slice(start, end),
  }
  const harness = makeHarness('feed-older', { activeSessionId: 'session-test', session })
  try {
    let state = await harness.state()
    assert.equal(state.feed.length, 60)
    assert.equal(state.feedSource, 'host')
    assert.equal(state.feedHasOlder, true)
    assert.equal(state.feed[0].text, 'm41')
    assert.equal(state.running, true)

    const older = await harness.post({ type: 'feed-older' })
    assert.equal(older.status, 200)
    assert.equal(older.json.rows.length, 20)
    assert.equal(older.json.rows[0].text, 'm21')
    assert.equal(older.json.hasOlder, true)

    const listener = harness.listeners.get('session/event')
    listener(session, { type: 'turn/end', seq: 101, time: now, data: {} })
    state = await harness.state()
    assert.equal(state.running, false)
  } finally {
    harness.cleanup()
  }
})

test('host feed seeds, appends live events and yields to a fresh client feed', async () => {
  const now = Date.now()
  const seed = [
    {
      type: 'user/message',
      seq: 1,
      time: now - 4000,
      surfaceOp: 'append',
      data: { content: [{ type: 'text', text: 'hello' }], source: { kind: 'user' } },
    },
    {
      type: 'assistant/message',
      seq: 2,
      time: now - 3000,
      surfaceOp: 'append',
      data: { message: { content: [{ type: 'text', text: 'hi' }] } },
    },
    {
      type: 'tool/call',
      seq: 3,
      time: now - 2500,
      data: { callId: 'call-1', name: 'bash' },
    },
    {
      type: 'tool/result',
      seq: 4,
      time: now - 2000,
      surfaceOp: 'append',
      data: { message: { source: { callId: 'call-1' }, isError: false } },
    },
  ]
  const session = {
    id: 'session-test',
    seq: 4,
    snapshotEvents: (start, end) => seed.slice(start, end),
  }
  const harness = makeHarness('feed', { activeSessionId: 'session-test', session })
  try {
    let state = await harness.state()
    assert.equal(state.feed.length, 3)
    assert.equal(state.feed[0].text, 'hello')
    assert.equal(state.feed[1].blocks[0].text, 'hi')
    assert.equal(state.feed[2].name, 'bash')

    const listener = harness.listeners.get('session/event')
    assert.equal(typeof listener, 'function')
    listener(session, {
      type: 'user/message',
      seq: 5,
      time: now,
      surfaceOp: 'append',
      data: { content: [{ type: 'text', text: 'live' }], source: { kind: 'user' } },
    })
    state = await harness.state()
    assert.equal(state.feed.length, 4)
    assert.equal(state.feed[3].text, 'live')

    await harness.post({
      feed: [{ kind: 'user', time: now, text: 'client', hasImage: false }],
    })
    state = await harness.state()
    assert.equal(state.feed.length, 1)
    assert.equal(state.feed[0].text, 'client')
  } finally {
    harness.cleanup()
  }
})

function restoreEnv(name, value) {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

test('open-window reports electron-missing and logs the searched paths', async () => {
  const previous = process.env.DSH_QUICK_PANEL_ELECTRON
  delete process.env.DSH_QUICK_PANEL_ELECTRON
  const harness = makeHarness('open-missing')
  try {
    const result = await harness.post({ type: 'open-window' })
    assert.equal(result.json.ok, false)
    assert.equal(result.json.error, 'electron-missing')
    assert.ok(Array.isArray(result.json.searched))
    const log = readFileSync(join(harness.home, 'quick-panel', 'helper.log'), 'utf8')
    assert.match(log, /electron-missing/u)
  } finally {
    harness.cleanup()
    restoreEnv('DSH_QUICK_PANEL_ELECTRON', previous)
  }
})

test('open-window rejects an Electron path that is not a file', async () => {
  const previous = process.env.DSH_QUICK_PANEL_ELECTRON
  delete process.env.DSH_QUICK_PANEL_ELECTRON
  const harness = makeHarness('open-unusable')
  try {
    mkdirSync(join(harness.home, 'electron', ELECTRON_RELATIVE), { recursive: true })
    const result = await harness.post({ type: 'open-window' })
    assert.equal(result.json.ok, false)
    assert.equal(result.json.error, 'electron-unusable')
  } finally {
    harness.cleanup()
    restoreEnv('DSH_QUICK_PANEL_ELECTRON', previous)
  }
})

test('open-window rejects a non-loopback origin before spawning', async () => {
  const previous = process.env.DSH_QUICK_PANEL_ELECTRON
  const harness = makeHarness('open-origin', { origin: 'https://example.com:9999' })
  try {
    const fake = join(harness.home, 'fake-electron.exe')
    writeFileSync(fake, 'stub')
    chmodSync(fake, 0o755)
    process.env.DSH_QUICK_PANEL_ELECTRON = fake
    const result = await harness.post({ type: 'open-window' })
    assert.equal(result.json.ok, false)
    assert.equal(result.json.error, 'unsupported-origin')
  } finally {
    harness.cleanup()
    restoreEnv('DSH_QUICK_PANEL_ELECTRON', previous)
  }
})

test('runtime endpoint exposes the install state and is token protected', async () => {
  const harness = makeHarness('runtime-state')
  try {
    const unauthorized = await harness.call('/quick-panel/runtime')
    assert.equal(unauthorized.status, 401)
    const result = await harness.call(`/quick-panel/runtime?${harness.query}`)
    assert.equal(result.status, 200)
    assert.equal(result.json.ok, true)
    assert.equal(result.json.status, 'idle')
    assert.equal(typeof result.json.supported, 'boolean')
  } finally {
    harness.cleanup()
  }
})

test('new-session request is queued, acknowledged and cleared by a session change', async () => {
  const harness = makeHarness('new-session')
  try {
    let state = await harness.state()
    assert.equal(state.newSessionRequest, null)

    const requested = await harness.post({ type: 'new-session' })
    assert.equal(requested.status, 200)
    assert.equal(requested.json.ok, true)
    assert.equal(typeof requested.json.id, 'string')
    state = await harness.state()
    assert.equal(state.newSessionRequest.id, requested.json.id)

    await harness.post({ type: 'new-session-ack', id: requested.json.id })
    state = await harness.state()
    assert.equal(state.newSessionRequest, null)

    await harness.post({ type: 'new-session' })
    await harness.post({ activeSessionId: 'session-new' })
    state = await harness.state()
    assert.equal(state.newSessionRequest, null)
  } finally {
    harness.cleanup()
  }
})

test('switch and new-session commands are pushed over SSE', async () => {
  const harness = makeHarness('events', {
    activeSessionId: 'session-test',
    projections: [
      {
        id: 'session-other',
        row: { sessionListMetadata: { ver: 1, seq: 1, val: { lastPromptAt: Date.now() } } },
      },
    ],
  })
  try {
    const events = harness.openEvents()
    assert.equal(events.statusCode, 200)
    assert.match(events.headers['content-type'] || '', /text\/event-stream/u)
    assert.match(events.writes.join(''), /: connected/u)

    const switched = await harness.post({ type: 'switch-session', sessionId: 'session-other' })
    assert.equal(switched.status, 200)
    let stream = events.writes.join('')
    assert.match(stream, /"type":"switch-session"/u)
    assert.match(stream, /"sessionId":"session-other"/u)

    await harness.post({ type: 'new-session' })
    stream = events.writes.join('')
    assert.match(stream, /"type":"new-session"/u)

    const unauthorized = await harness.call('/quick-panel/events')
    assert.equal(unauthorized.status, 401)
  } finally {
    harness.cleanup()
  }
})
