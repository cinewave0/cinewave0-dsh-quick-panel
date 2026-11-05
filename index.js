/**
 * Host half of dsh-quick-panel.
 *
 * Owns the shared store and the loopback HTTP API used by both the in-window
 * panel and the future standalone Electron companion. The API is small on
 * purpose: the panel syncs its todo/reminder arrays, reports which Session is
 * active, and reads the current snapshot.
 *
 * Everything listens on 127.0.0.1 only. Every request carries a per-process
 * token; the token itself is handed to the same-origin page through an
 * owner-only config resource.
 */
import { randomUUID } from 'node:crypto'
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROUTE_BASE = '/quick-panel'
const MAX_BODY_BYTES = 2 * 1024 * 1024
/** Preview images are normalized by DSH, but keep one bad attachment from filling memory. */
const MAX_PREVIEW_IMAGE_BYTES = 16 * 1024 * 1024
const IMAGE_CACHE_BYTES = 48 * 1024 * 1024
const IMAGE_CACHE_ENTRIES = 16
const IMAGE_REF_ENTRIES = 400
const IMAGE_REF_MAX_LENGTH = 8192
const IMAGE_MEDIA_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
const packageRoot = dirname(fileURLToPath(import.meta.url))
const panelDirectory = join(packageRoot, 'panel')

/** Wait for the HTTP carrier before registering the shared store routes. */
export const inject = ['webServer']

function electronExecutable() {
  if (process.platform !== 'win32') return null
  const explicit = process.env.DSH_QUICK_PANEL_ELECTRON
  if (explicit && existsSync(explicit)) return explicit
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  const candidate = join(home, 'electron', 'electron.exe')
  return existsSync(candidate) ? candidate : null
}

function stateDirectory() {
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  return join(home, 'quick-panel')
}

function stateFile() {
  return join(stateDirectory(), 'state.json')
}

/** DSH keeps one per-Session projection cache JSON beside the session log. */
function sessionProjectionsDirectory() {
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  return join(home, 'storages', 'session_projcache', 'sessions')
}

/** Token buckets the meter records for one Session. */
function tokenBucketTotal(totals) {
  if (!totals || typeof totals !== 'object') return 0
  const buckets = [
    totals.uncachedInputTokens,
    totals.cacheReadTokens,
    totals.cacheWriteTokens,
    totals.outputTokens,
  ]
  let total = 0
  for (const value of buckets) {
    if (Number.isFinite(value) && value > 0) total += value
  }
  return total
}

function eventContentText(content) {
  if (!Array.isArray(content)) return ''
  return content
    .map((block) => {
      if (!block) return ''
      if (typeof block === 'string') return block
      if (typeof block.text === 'string' && block.text) return block.text
      return ''
    })
    .filter(Boolean)
    .join('\n')
}

function eventAssistantBlocks(content) {
  if (!Array.isArray(content)) return []
  const blocks = []
  for (const block of content) {
    if (!block || typeof block !== 'object') continue
    if (block.type === 'text' || block.type === 'reasoning') {
      const text = typeof block.text === 'string' ? block.text : ''
      if (text) blocks.push({ kind: block.type, text: text.slice(0, 4000) })
      continue
    }
    if (block.type === 'tool-call') {
      blocks.push({ kind: 'tool-call', name: String(block.name || '').slice(0, 200) })
    }
  }
  return blocks.slice(0, 16)
}

function note(message) {
  try {
    mkdirSync(stateDirectory(), { recursive: true })
    appendFileSync(join(stateDirectory(), 'helper.log'), `${new Date().toISOString()} ${message}\n`)
  } catch (_error) {
    /* diagnostics are best effort */
  }
}

function emptyState() {
  return {
    version: 1,
    rev: 0,
    todos: [],
    reminders: [],
    settings: {},
    activeSessionId: null,
  }
}

function normalizeTodo(item) {
  if (!item || typeof item !== 'object' || typeof item.text !== 'string') return null
  const text = item.text.trim()
  if (!text) return null
  return {
    id: typeof item.id === 'string' && item.id ? item.id : randomUUID(),
    text: text.slice(0, 2000),
    done: Boolean(item.done),
    handedOff: Boolean(item.handedOff),
    createdAt: Number.isFinite(item.createdAt) ? item.createdAt : Date.now(),
  }
}

function normalizeReminder(item) {
  if (!item || typeof item !== 'object' || typeof item.text !== 'string') return null
  if (!Number.isFinite(item.at)) return null
  const text = item.text.trim()
  if (!text) return null
  return {
    id: typeof item.id === 'string' && item.id ? item.id : randomUUID(),
    text: text.slice(0, 2000),
    at: item.at,
    repeat: ['none', 'daily', 'weekdays'].includes(item.repeat) ? item.repeat : 'none',
    timeOfDay: typeof item.timeOfDay === 'string' ? item.timeOfDay : null,
    dshTask: Boolean(item.dshTask),
    firedFor: Number.isFinite(item.firedFor) ? item.firedFor : null,
    createdAt: Number.isFinite(item.createdAt) ? item.createdAt : Date.now(),
  }
}

function normalizeLiveBlock(block) {
  if (!block || typeof block !== 'object') return null
  const kind = ['text', 'reasoning', 'tool-call', 'image'].includes(block.kind) ? block.kind : 'text'
  return {
    kind,
    text: typeof block.text === 'string' ? block.text.slice(0, 4000) : '',
    name: typeof block.name === 'string' ? block.name.slice(0, 200) : '',
  }
}

function normalizeLivePartial(partial) {
  if (!partial || typeof partial !== 'object') return null
  return {
    blocks: Array.isArray(partial.blocks)
      ? partial.blocks.slice(0, 16).map(normalizeLiveBlock).filter(Boolean)
      : [],
  }
}

/** Stable, URL-safe key for one durable image reference. */
function imageKeyOf(ref) {
  if (!ref || typeof ref !== 'object') return ''
  const id = typeof ref.attachmentId === 'string' ? ref.attachmentId.trim() : ''
  return id && id.length <= 200 ? id : ''
}

/**
 * Keep the full durable reference only inside the Host. The panel receives
 * display metadata plus the key it can use on `/quick-panel/attachment`.
 */
function normalizeImageEntry(image) {
  const ref = image && image.ref
  const id = imageKeyOf(ref)
  if (!id) return null
  let serialized = ''
  try {
    serialized = JSON.stringify(ref)
  } catch (_error) {
    return null
  }
  if (!serialized || serialized.length > IMAGE_REF_MAX_LENGTH) return null
  const mediaType = typeof ref.mediaType === 'string' ? ref.mediaType : ''
  if (!IMAGE_MEDIA_TYPES.has(mediaType)) return null
  return {
    id,
    ref,
    meta: {
      id,
      mediaType,
      width: Number.isFinite(ref.width) ? ref.width : 0,
      height: Number.isFinite(ref.height) ? ref.height : 0,
      bytes: Number.isFinite(ref.bytes) ? ref.bytes : 0,
      name: typeof ref.name === 'string' ? ref.name.slice(0, 120) : '',
    },
  }
}

function approvalText(value, limit) {
  return typeof value === 'string' ? value.slice(0, limit) : ''
}

/** Read the owning Session id from an approval request's agent. */
function agentSessionId(agent) {
  if (!agent || typeof agent !== 'object') return ''
  const session = agent.session
  if (session && typeof session.id === 'string' && session.id) return session.id
  if (typeof agent.sessionId === 'string' && agent.sessionId) return agent.sessionId
  if (session && typeof session.sessionId === 'string' && session.sessionId) {
    return session.sessionId
  }
  return ''
}

/** Whitelist the fields the companion needs; pending interactions hold live objects. */
function normalizeApproval(raw) {
  if (!raw || typeof raw !== 'object') return null
  const key = approvalText(raw.key, 120).trim()
  if (!key) return null
  return {
    key,
    toolName: approvalText(raw.toolName, 200),
    reason: approvalText(raw.reason, 1000),
    displayReason: approvalText(raw.displayReason, 1000),
    callId: approvalText(raw.callId, 200),
    sessionId: approvalText(raw.sessionId, 200),
    since: Number.isFinite(raw.since) ? raw.since : Date.now(),
  }
}

function normalizeUsage(raw) {
  if (!raw || typeof raw !== 'object') return null
  const count = (value) => (Number.isFinite(value) && value > 0 ? Math.floor(value) : 0)
  return {
    sessionTokens: count(raw.sessionTokens),
    sessionOutputTokens: count(raw.sessionOutputTokens),
    tps: Number.isFinite(raw.tps) && raw.tps > 0 ? raw.tps : 0,
    at: Number.isFinite(raw.at) ? raw.at : Date.now(),
  }
}

function normalizeQuestion(raw) {
  if (!raw || typeof raw !== 'object') return null
  const key = approvalText(raw.key, 240).trim()
  if (!key) return null
  const kind = raw.kind === 'plan-review' ? 'plan-review' : 'question'
  const questions = (Array.isArray(raw.questions) ? raw.questions : [])
    .slice(0, 8)
    .map((question) => {
      if (!question || typeof question !== 'object') return null
      const id = approvalText(question.id, 200).trim()
      if (!id) return null
      return {
        id,
        question: approvalText(question.question, 4000),
        ...(question.header ? { header: approvalText(question.header, 400) } : {}),
        ...(question.detail ? { detail: approvalText(question.detail, 8000) } : {}),
        ...(Array.isArray(question.options)
          ? {
              options: question.options
                .slice(0, 12)
                .map((option) => {
                  if (!option || typeof option !== 'object') return null
                  const label = approvalText(option.label, 400)
                  if (!label) return null
                  return {
                    label,
                    ...(option.description
                      ? { description: approvalText(option.description, 1200) }
                      : {}),
                  }
                })
                .filter(Boolean),
            }
          : {}),
        ...(question.multiSelect === true ? { multiSelect: true } : {}),
      }
    })
    .filter(Boolean)
  if (!questions.length) return null
  const countdown = raw.countdown && typeof raw.countdown === 'object'
    ? {
        remainingMs: Number.isFinite(raw.countdown.remainingMs)
          ? Math.max(0, Math.floor(raw.countdown.remainingMs))
          : 0,
        running: raw.countdown.running === true,
      }
    : null
  return {
    key,
    sessionId: approvalText(raw.sessionId, 200),
    kind,
    callId: approvalText(raw.callId, 200),
    state: raw.state === 'continued' ? 'continued' : 'open',
    waitState: approvalText(raw.waitState, 40),
    countdown,
    questions,
  }
}

function normalizeQuestionAnswers(raw) {
  return (Array.isArray(raw) ? raw : [])
    .slice(0, 8)
    .map((answer) => {
      if (!answer || typeof answer !== 'object') return null
      const id = approvalText(answer.id, 200).trim()
      if (!id || !Array.isArray(answer.selected)) return null
      const selected = answer.selected
        .map((value) => approvalText(value, 400))
        .filter(Boolean)
        .slice(0, 12)
      return {
        id,
        selected,
        ...(typeof answer.custom === 'string' && answer.custom.trim()
          ? { custom: answer.custom.trim().slice(0, 4000) }
          : {}),
      }
    })
    .filter(Boolean)
}

function normalizeLiveRow(row, rememberImage) {  if (!row || typeof row !== 'object') return null
  const kind = ['user', 'steering', 'assistant', 'tool-result', 'turn-error'].includes(row.kind)
    ? row.kind
    : null
  if (!kind) return null
  const normalized = { kind, time: Number.isFinite(row.time) ? row.time : Date.now() }
  if (typeof row.text === 'string') normalized.text = row.text.slice(0, 4000)
  if (Array.isArray(row.blocks)) {
    normalized.blocks = row.blocks.slice(0, 16).map(normalizeLiveBlock).filter(Boolean)
  }
  if (typeof row.name === 'string') normalized.name = row.name.slice(0, 200)
  if (typeof row.isError === 'boolean') normalized.isError = row.isError
  if (typeof row.message === 'string') normalized.message = row.message.slice(0, 2000)
  if (typeof row.interrupted === 'boolean') normalized.interrupted = row.interrupted
  if (typeof row.hasImage === 'boolean') normalized.hasImage = row.hasImage
  if (Array.isArray(row.images)) {
    const images = row.images
      .slice(0, 4)
      .map(normalizeImageEntry)
      .filter(Boolean)
    if (images.length) {
      normalized.images = images.map((image) => {
        if (rememberImage) rememberImage(image.id, image.ref)
        return image.meta
      })
      normalized.hasImage = true
    }
  }
  return normalized
}

function normalizeState(raw) {
  const state = emptyState()
  if (!raw || typeof raw !== 'object') return state
  if (Number.isFinite(raw.rev) && raw.rev >= 0) state.rev = raw.rev
  if (Array.isArray(raw.todos)) {
    state.todos = raw.todos.map(normalizeTodo).filter(Boolean).slice(0, 3000)
  }
  if (Array.isArray(raw.reminders)) {
    state.reminders = raw.reminders.map(normalizeReminder).filter(Boolean).slice(0, 3000)
  }
  if (raw.settings && typeof raw.settings === 'object' && !Array.isArray(raw.settings)) {
    state.settings = raw.settings
  }
  state.activeSessionId =
    typeof raw.activeSessionId === 'string' && raw.activeSessionId ? raw.activeSessionId : null
  return state
}

function loadState() {
  try {
    return normalizeState(JSON.parse(readFileSync(stateFile(), 'utf8')))
  } catch (_error) {
    return emptyState()
  }
}

function saveState(state) {
  try {
    mkdirSync(stateDirectory(), { recursive: true })
    const target = stateFile()
    const temporary = `${target}.${process.pid}.tmp`
    writeFileSync(temporary, JSON.stringify(state, null, 2), 'utf8')
    renameSync(temporary, target)
  } catch (_error) {
    /* the store is best effort; the panel keeps working from its local copy */
  }
}

function sendJson(response, status, value) {
  response.statusCode = status
  response.setHeader('content-type', 'application/json; charset=utf-8')
  response.setHeader('cache-control', 'no-store')
  response.end(JSON.stringify(value))
}

function requestUrl(request) {
  try {
    return new URL(request.url || '/', 'http://127.0.0.1')
  } catch (_error) {
    return null
  }
}

function tokenFrom(request, url) {
  const header = request.headers && request.headers['x-quick-panel-token']
  if (typeof header === 'string' && header) return header
  return url ? url.searchParams.get('token') : null
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    request.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('body too large'))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    request.on('error', reject)
  })
}

export function apply(ctx) {
  const webServer = ctx.get('webServer')
  if (!webServer) return

  const token = randomUUID().replace(/-/g, '')
  let state = loadState()
  let live = {
    feed: [],
    feedAt: 0,
    partial: null,
    running: false,
    latest: '',
    approval: null,
    usage: null,
    question: null,
    questionAnswer: null,
    questionDebug: null,
    dshFocused: null,
  }
  let approvalSeq = 0
  let pendingApproval = null
  let hostFeed = []
  let hostFeedSession = null
  let hostFeedHasOlder = false
  let hostFeedLastUser = null
  const toolNames = new Map()
  let usageCache = {
    at: 0,
    tokens: 0,
    outputTokens: 0,
    sessions: 0,
    byId: new Map(),
  }
  const balanceCache = {
    at: 0,
    inFlight: false,
    view: { status: 'loading', wallets: [], bonusWallets: [] },
  }
  let child = null
  let companionBeat = 0
  let companionSpawnedAt = 0
  /** Durable image refs currently referenced by the mirrored live feed. */
  const imageRefs = new Map()
  /** Decoded bytes for the thumbnails the companion actually requested. */
  const imageCache = new Map()
  const imageInflight = new Map()
  let imageCacheBytes = 0

  const rememberImage = (id, ref) => {
    if (!id || !ref) return
    imageRefs.delete(id)
    imageRefs.set(id, ref)
    while (imageRefs.size > IMAGE_REF_ENTRIES) {
      const oldest = imageRefs.keys().next().value
      if (oldest === undefined) break
      imageRefs.delete(oldest)
    }
  }

  const evictImageCache = () => {
    while (imageCache.size > IMAGE_CACHE_ENTRIES || imageCacheBytes > IMAGE_CACHE_BYTES) {
      const oldest = imageCache.keys().next().value
      if (oldest === undefined) break
      const entry = imageCache.get(oldest)
      imageCache.delete(oldest)
      imageCacheBytes -= entry ? entry.bytes.length : 0
    }
  }

  /**
   * Read one referenced image through the session controller. Attachment
   * objects are immutable, so bytes are cached by attachment id; concurrent
   * thumbnail requests share one read.
   */
  const loadImage = async (id) => {
    const cached = imageCache.get(id)
    if (cached) {
      imageCache.delete(id)
      imageCache.set(id, cached)
      return cached
    }
    const pending = imageInflight.get(id)
    if (pending) return pending
    const task = (async () => {
      const ref = imageRefs.get(id)
      if (!ref) return { error: 'not-found' }
      const mediaType = typeof ref.mediaType === 'string' ? ref.mediaType : ''
      if (!IMAGE_MEDIA_TYPES.has(mediaType)) return { error: 'unsupported-type' }
      const controller = ctx.get('sessionController')
      if (!controller || typeof controller.attachment !== 'function') {
        return { error: 'session-unavailable' }
      }
      let result
      try {
        result = await controller.attachment({
          sessionId: state.activeSessionId || 'session-quick-panel',
          attachment: ref,
        })
      } catch (error) {
        note(`attachment read failed ${id}: ${String((error && error.message) || error)}`)
        return { error: 'read-failed' }
      }
      const data = result && typeof result.data === 'string' ? result.data : ''
      if (!data) return { error: 'read-failed' }
      let bytes
      try {
        bytes = Buffer.from(data, 'base64')
      } catch (_error) {
        return { error: 'read-failed' }
      }
      if (!bytes.length) return { error: 'read-failed' }
      if (bytes.length > MAX_PREVIEW_IMAGE_BYTES) return { error: 'too-large' }
      const entry = { id, mediaType, bytes }
      imageCache.set(id, entry)
      imageCacheBytes += bytes.length
      evictImageCache()
      return entry
    })().finally(() => {
      imageInflight.delete(id)
    })
    imageInflight.set(id, task)
    return task
  }

  const hostRowFromEvent = (event) => {
    const row = mapHostRow(event)
    if (row && Number.isSafeInteger(event.seq)) row.seq = event.seq
    return row
  }

  const mapHostRow = (event) => {
    if (!event || typeof event !== 'object' || typeof event.type !== 'string') return null
    const time = Number.isFinite(event.time) ? event.time : Date.now()
    if (event.type === 'user/message') {
      if (event.surfaceOp !== undefined && event.surfaceOp !== 'append') return null
      const data = event.data || {}
      const source = data.source
      if (source && typeof source.kind === 'string' && source.kind !== 'user') return null
      const content = Array.isArray(data.content) ? data.content : []
      const images = content
        .filter(
          (block) =>
            block &&
            (block.type === 'image' || block.kind === 'image') &&
            block.attachment &&
            typeof block.attachment === 'object',
        )
        .slice(0, 4)
        .map((block) => ({ ref: block.attachment }))
      const hasImage =
        images.length > 0 ||
        content.some((block) => block && (block.type === 'image' || block.kind === 'image'))
      const row = {
        kind: 'user',
        time,
        text: eventContentText(content).slice(0, 4000),
        hasImage,
      }
      if (images.length) row.images = images
      return normalizeLiveRow(row, rememberImage)
    }
    if (event.type === 'assistant/message') {
      if (event.surfaceOp !== undefined && event.surfaceOp !== 'append') return null
      const blocks = eventAssistantBlocks(event.data && event.data.message && event.data.message.content)
      if (!blocks.length) return null
      return normalizeLiveRow(
        { kind: 'assistant', time, interrupted: false, blocks },
        rememberImage,
      )
    }
    if (event.type === 'tool/call') {
      const callId = String((event.data && event.data.callId) || '')
      if (callId) toolNames.set(callId, String((event.data && event.data.name) || ''))
      return null
    }
    if (event.type === 'tool/result') {
      if (event.surfaceOp !== undefined && event.surfaceOp !== 'append') return null
      const message = event.data && event.data.message
      const callId = String((message && message.source && message.source.callId) || '')
      const name = toolNames.get(callId) || '工具'
      if (callId) toolNames.delete(callId)
      return normalizeLiveRow(
        {
          kind: 'tool-result',
          time,
          name: name.slice(0, 200),
          isError: Boolean(message && message.isError === true),
        },
        rememberImage,
      )
    }
    if (event.type === 'turn/end') {
      const reason = event.data && event.data.reason
      if (reason && reason.kind === 'error') {
        const message =
          (reason.error && reason.error.message) || reason.message || '本轮运行失败'
        return normalizeLiveRow(
          { kind: 'turn-error', time, message: String(message).slice(0, 2000) },
          rememberImage,
        )
      }
    }
    return null
  }

  const seedHostFeed = (sessionId) => {
    hostFeed = []
    hostFeedSession = sessionId || null
    hostFeedHasOlder = false
    hostFeedLastUser = null
    toolNames.clear()
    if (!sessionId) return
    const sessions = ctx.get('sessions')
    const session = sessions && typeof sessions.get === 'function' ? sessions.get(sessionId) : null
    if (!session || typeof session.snapshotEvents !== 'function') {
      hostFeedSession = null
      return
    }
    const end = Number.isSafeInteger(session.seq) ? session.seq : 0
    if (typeof session.running === 'boolean') live.running = session.running
    if (end <= 0) return
    let events = []
    try {
      events = session.snapshotEvents(Math.max(0, end - 300), end)
    } catch (_error) {
      return
    }
    for (const event of events) {
      const row = hostRowFromEvent(event)
      if (row) {
        hostFeed.push(row)
        if (row.kind === 'user' || row.kind === 'steering') hostFeedLastUser = row
      }
    }
    hostFeed = hostFeed.slice(-60)
    if (
      hostFeedLastUser &&
      !hostFeed.some((row) => row.seq === hostFeedLastUser.seq)
    ) {
      hostFeed = [hostFeedLastUser, ...hostFeed]
    }
    hostFeedHasOlder = hostFeed.length > 0 && Number.isSafeInteger(hostFeed[0].seq) && hostFeed[0].seq > 0
  }

  const ensureHostFeed = () => {
    if (!state.activeSessionId || hostFeedSession === state.activeSessionId) return
    seedHostFeed(state.activeSessionId)
  }

  const hostFeedLatest = () => {
    for (let index = hostFeed.length - 1; index >= 0; index -= 1) {
      const row = hostFeed[index]
      if (!row) continue
      if ((row.kind === 'user' || row.kind === 'steering') && row.text) return row.text
      if (row.kind === 'assistant' && Array.isArray(row.blocks)) {
        for (let blockIndex = row.blocks.length - 1; blockIndex >= 0; blockIndex -= 1) {
          const block = row.blocks[blockIndex]
          if (block && block.kind === 'text' && block.text) return block.text
        }
      }
      if (row.kind === 'turn-error' && row.message) return row.message
    }
    return ''
  }

  const companionIsOpen = () =>
    (companionBeat > 0 && Date.now() - companionBeat < 20000) ||
    (Boolean(child && !child.killed) &&
      companionSpawnedAt > 0 &&
      Date.now() - companionSpawnedAt < 15000)

  /**
   * Claim an interactive approval while the companion can present it. If the
   * companion is closed or goes away, delegate to DSH's built-in approval UI
   * so the agent never deadlocks on a missing panel.
   */
  const handleApprovalRequest = (request, next) => {
    if (!request || typeof request !== 'object') return next()
    const sessionId = agentSessionId(request.agent)
    if (!companionIsOpen() || !sessionId || sessionId !== state.activeSessionId) {
      return next()
    }
    // DSH's own card stays authoritative while its window has focus; the
    // external panel only takes over when DSH is in the background.
    if (live.dshFocused !== false) return next()
    if (pendingApproval) return next()
    const signal = request.signal
    if (signal && signal.aborted) return 'cancelled'
    const key = `approval:${(approvalSeq += 1)}`
    const delegate = () => {
      try {
        return next()
      } catch (_error) {
        return 'unavailable'
      }
    }
    return new Promise((resolve) => {
      let settled = false
      let watchdog = 0
      let monitor = 0
      const clear = () => {
        if (watchdog) {
          clearTimeout(watchdog)
          watchdog = 0
        }
        if (monitor) {
          clearInterval(monitor)
          monitor = 0
        }
        if (signal) signal.removeEventListener('abort', onAbort)
        if (pendingApproval && pendingApproval.key === key) pendingApproval = null
        if (live.approval && live.approval.key === key) live.approval = null
      }
      const settle = (outcome) => {
        if (settled) return
        settled = true
        clear()
        resolve(outcome)
      }
      const onAbort = () => settle('cancelled')
      if (signal) signal.addEventListener('abort', onAbort, { once: true })
      // Closing or losing the companion hands the request back to the DSH UI.
      monitor = setInterval(() => {
        if (settled) return
        if (!companionIsOpen() || live.dshFocused === true) {
          settled = true
          clear()
          resolve(delegate())
        }
      }, 2000)
      // Nobody answered for a long time; let the in-window card take over.
      watchdog = setTimeout(() => {
        if (settled) return
        settled = true
        clear()
        resolve(delegate())
      }, 120000)
      pendingApproval = {
        key,
        sessionId,
        answer: (outcome) => settle(outcome),
      }
      live.approval = normalizeApproval({
        key,
        toolName: request.toolName,
        reason: request.reason,
        displayReason: request.displayReason,
        callId: request.callId,
        sessionId,
        since: Date.now(),
      })
      note(`approval claimed key=${key} tool=${String(request.toolName || '')}`)
    })
  }

  const walletList = (value) =>
    (Array.isArray(value) ? value : [])
      .filter(
        (wallet) =>
          wallet &&
          typeof wallet.currency === 'string' &&
          typeof wallet.balance === 'string',
      )
      .slice(0, 5)
      .map((wallet) => ({
        currency: wallet.currency.slice(0, 8),
        balance: wallet.balance.slice(0, 40),
      }))

  const ensureBalance = () => {
    if (balanceCache.inFlight) return
    if (balanceCache.at && Date.now() - balanceCache.at < 5 * 60 * 1000) return
    const account = ctx.get('deepseekAccount')
    if (!account || typeof account.getBalance !== 'function') {
      // Retry soon in case the account service activates after this plugin.
      balanceCache.at = Date.now() - 5 * 60 * 1000 + 30000
      balanceCache.view = { status: 'unavailable', wallets: [], bonusWallets: [] }
      return
    }
    balanceCache.inFlight = true
    Promise.resolve()
      .then(() =>
        account.getBalance({
          version: process.env.DSH_VERSION || '0.2.2-rc.1',
          locale: process.env.DSH_LOCALE || 'zh-CN',
          timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
        }),
      )
      .then((result) => {
        if (!result) {
          balanceCache.view = { status: 'unavailable', wallets: [], bonusWallets: [] }
          return
        }
        if (result.status === 'ready') {
          balanceCache.view = {
            status: 'ready',
            wallets: walletList(result.value),
            bonusWallets: walletList(result.bonusWallets),
          }
          return
        }
        balanceCache.view = { status: 'failed', wallets: [], bonusWallets: [] }
      })
      .catch(() => {
        balanceCache.view = { status: 'failed', wallets: [], bonusWallets: [] }
      })
      .finally(() => {
        balanceCache.at = Date.now()
        balanceCache.inFlight = false
      })
  }

  /** Sum tokenUsage projections for Sessions that saw a prompt in the last 30 days. */
  const refreshUsageAggregate = () => {
    const now = Date.now()
    if (usageCache.at && now - usageCache.at < 5 * 60 * 1000) return usageCache
    const next = { at: now, tokens: 0, outputTokens: 0, sessions: 0, byId: new Map() }
    const cutoff = now - 30 * 24 * 60 * 60 * 1000
    const directory = sessionProjectionsDirectory()
    let names = []
    try {
      names = readdirSync(directory)
    } catch (_error) {
      usageCache = next
      return usageCache
    }
    for (const name of names) {
      if (!name.endsWith('.json')) continue
      const id = name.slice(0, -5)
      const path = join(directory, name)
      let parsed
      try {
        parsed = JSON.parse(readFileSync(path, 'utf8'))
      } catch (_error) {
        continue
      }
      const rows = parsed && parsed.record ? parsed.record.rows : null
      const row = Array.isArray(rows) ? rows[0] : rows
      if (!row || typeof row !== 'object') continue
      const tokenValue = row.tokenUsage && row.tokenUsage.val
      const totals = tokenValue && tokenValue.totals
      if (!totals) continue
      let lastAt =
        row.sessionListMetadata &&
        row.sessionListMetadata.val &&
        row.sessionListMetadata.val.lastPromptAt
      if (!Number.isFinite(lastAt)) {
        lastAt =
          row.timeContext && row.timeContext.val && row.timeContext.val.lastMessageTime
      }
      if (!Number.isFinite(lastAt)) {
        try {
          lastAt = statSync(path).mtimeMs
        } catch (_error) {
          continue
        }
      }
      if (lastAt < cutoff) continue
      const tokens = tokenBucketTotal(totals)
      const outputTokens =
        Number.isFinite(totals.outputTokens) && totals.outputTokens > 0
          ? totals.outputTokens
          : 0
      const stats = row.sessionStats && row.sessionStats.val
      const decodeTokens =
        stats && Number.isFinite(stats.decodeTokens) && stats.decodeTokens > 0
          ? stats.decodeTokens
          : 0
      const decodeMs =
        stats && Number.isFinite(stats.decodeMs) && stats.decodeMs > 0 ? stats.decodeMs : 0
      next.tokens += tokens
      next.outputTokens += outputTokens
      next.sessions += 1
      next.byId.set(id, { tokens, outputTokens, decodeTokens, decodeMs })
    }
    usageCache = next
    return usageCache
  }

  const usageView = () => {
    const aggregate = refreshUsageAggregate()
    let tokens = aggregate.tokens
    let outputTokens = aggregate.outputTokens
    let sessions = aggregate.sessions
    let current = live.usage
    if (!current && state.activeSessionId) {
      const cached = aggregate.byId.get(state.activeSessionId)
      if (cached) {
        current = {
          sessionTokens: cached.tokens,
          sessionOutputTokens: cached.outputTokens,
          tps:
            cached.decodeMs > 0 && cached.decodeTokens > 0
              ? cached.decodeTokens / (cached.decodeMs / 1000)
              : 0,
          at: aggregate.at,
        }
      }
    }
    if (current && state.activeSessionId) {
      const cached = aggregate.byId.get(state.activeSessionId)
      if (cached === undefined) {
        tokens += current.sessionTokens
        outputTokens += current.sessionOutputTokens
        sessions += 1
      } else {
        tokens += Math.max(0, current.sessionTokens - cached.tokens)
        outputTokens += Math.max(0, current.sessionOutputTokens - cached.outputTokens)
      }
    }
    ensureBalance()
    return {
      sessionKnown: Boolean(current),
      sessionTokens: current ? current.sessionTokens : 0,
      sessionOutputTokens: current ? current.sessionOutputTokens : 0,
      tps: current ? current.tps : 0,
      thirtyDayTokens: Math.max(0, tokens),
      thirtyDayOutputTokens: Math.max(0, outputTokens),
      sessionCount: sessions,
      balance: balanceCache.view,
    }
  }

  const sessionLabel = () => {    if (!state.activeSessionId) return ''
    const short = state.activeSessionId.replace(/^session-/, '').slice(0, 6)
    const userRow = [...live.feed]
      .reverse()
      .find((row) => row && (row.kind === 'user' || row.kind === 'steering'))
    const text =
      userRow && typeof userRow.text === 'string'
        ? userRow.text.replace(/\s+/g, ' ').trim().slice(0, 28)
        : ''
    return text ? `${text} · ${short}` : short
  }
  let sandboxFallback = false

  const launchWindow = (executable, main, url) => {
    const args = sandboxFallback ? ['--no-sandbox', main, `--url=${url}`] : [main, `--url=${url}`]
    const environment = { ...process.env, QUICK_PANEL_URL: url, QUICK_PANEL_HOST_PID: String(process.pid) }
    delete environment.ELECTRON_RUN_AS_NODE
    try {
      mkdirSync(stateDirectory(), { recursive: true })
    } catch (_error) {
      /* the home directory should exist */
    }
    const startedAt = Date.now()
    let spawned
    try {
      spawned = spawn(executable, args, {
        cwd: stateDirectory(),
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
        env: environment,
      })
    } catch (error) {
      return { ok: false, error: String((error && error.message) || error) }
    }
    child = spawned
    companionSpawnedAt = Date.now()
    companionBeat = 0
    note(`spawn pid=${spawned.pid} noSandbox=${sandboxFallback} url=${url.split('?')[0]}`)
    spawned.on('error', (error) => {
      note(`spawn error ${String((error && error.message) || error)}`)
      if (child === spawned) child = null
    })
    spawned.on('exit', (code, signal) => {
      note(`exit code=${code} signal=${signal}`)
      if (child === spawned) child = null
      const sandboxCrash = code === 2147483651 || code === -2147483645
      if (!sandboxFallback && sandboxCrash && Date.now() - startedAt < 5000) {
        sandboxFallback = true
        note('sandbox init failure; retrying with --no-sandbox')
        launchWindow(executable, main, url)
      }
    })
    spawned.unref()
    return { ok: true }
  }

  const openWindow = () => {
    if (child && !child.killed) return { ok: true, alreadyOpen: true }
    const executable = electronExecutable()
    if (!executable) return { ok: false, error: 'electron-missing' }
    const main = join(packageRoot, 'runtime', 'electron-helper', 'main.cjs')
    let origin
    try {
      origin = webServer.getOrigin()
    } catch (_error) {
      return { ok: false, error: 'origin-unavailable' }
    }
    const url = `${origin}${ROUTE_BASE}/panel?token=${encodeURIComponent(token)}`
    return launchWindow(executable, main, url)
  }

  const configRoute = {
    kind: 'exact',
    path: `${ROUTE_BASE}/config`,
    handler: (request, response) => {
      if (request.method !== 'GET') return sendJson(response, 405, { ok: false, error: 'method' })
      let origin = ''
      try {
        origin = webServer.getOrigin()
      } catch (_error) {
        return sendJson(response, 503, { ok: false, error: 'unavailable' })
      }
      const referer = typeof request.headers.referer === 'string' ? request.headers.referer : ''
      if (!referer.startsWith(origin)) {
        return sendJson(response, 403, { ok: false, error: 'forbidden' })
      }
      sendJson(response, 200, { ok: true, token, version: 1 })
    },
  }

  const stateRoute = {
    kind: 'exact',
    path: `${ROUTE_BASE}/state`,
    handler: (request, response) => {
      const url = requestUrl(request)
      if (!url) return sendJson(response, 400, { ok: false, error: 'bad-request' })
      if (request.method !== 'GET') return sendJson(response, 405, { ok: false, error: 'method' })
      if (tokenFrom(request, url) !== token) {
        return sendJson(response, 401, { ok: false, error: 'unauthorized' })
      }
      ensureHostFeed()
      const clientFeedFresh = live.feedAt > 0 && Date.now() - live.feedAt < 5000
      const useHostFeed =
        hostFeed.length > 0 &&
        hostFeedSession === state.activeSessionId &&
        (!clientFeedFresh || live.feed.length === 0)
      const feed = useHostFeed ? hostFeed : live.feed
      sendJson(response, 200, {
        ok: true,
        rev: state.rev,
        todos: state.todos,
        reminders: state.reminders,
        settings: state.settings,
        activeSessionId: state.activeSessionId,
        sessionLabel: sessionLabel(),
        companionOpen: companionIsOpen(),
        feed,
        feedSource: useHostFeed ? 'host' : 'client',
        feedHasOlder: Boolean(hostFeedHasOlder && useHostFeed),
        partial: live.partial,
        running: live.running,
        latest: useHostFeed ? hostFeedLatest() : live.latest,
        approval: live.approval,
        question: live.question,
        questionAnswer: live.questionAnswer,
        questionDebug: live.questionDebug,
        usage: usageView(),
      })
    },
  }

  const attachmentRoute = {
    kind: 'exact',
    path: `${ROUTE_BASE}/attachment`,
    handler: async (request, response) => {
      const url = requestUrl(request)
      if (!url) return sendJson(response, 400, { ok: false, error: 'bad-request' })
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return sendJson(response, 405, { ok: false, error: 'method' })
      }
      if (tokenFrom(request, url) !== token) {
        return sendJson(response, 401, { ok: false, error: 'unauthorized' })
      }
      const id = url.searchParams.get('id') || ''
      if (!id) return sendJson(response, 400, { ok: false, error: 'missing-id' })
      let entry
      try {
        entry = await loadImage(id)
      } catch (error) {
        note(`attachment route failed ${id}: ${String((error && error.message) || error)}`)
        entry = { error: 'read-failed' }
      }
      if (!entry || entry.error === 'not-found') {
        return sendJson(response, 404, { ok: false, error: 'not-found' })
      }
      if (entry.error) {
        const status =
          entry.error === 'too-large'
            ? 413
            : entry.error === 'unsupported-type'
              ? 415
              : entry.error === 'session-unavailable'
                ? 503
                : 502
        response.statusCode = status
        response.setHeader('cache-control', 'no-store')
        response.end()
        return
      }
      response.statusCode = 200
      response.setHeader('content-type', entry.mediaType)
      response.setHeader('content-length', String(entry.bytes.length))
      // The key is a content-addressed attachment id, so one URL names one version.
      response.setHeader('cache-control', 'private, max-age=31536000, immutable')
      response.setHeader('x-content-type-options', 'nosniff')
      response.setHeader('content-security-policy', "default-src 'none'; sandbox")
      if (request.method === 'HEAD') {
        response.end()
        return
      }
      response.end(entry.bytes)
    },
  }

  const actionRoute = {
    kind: 'exact',
    path: `${ROUTE_BASE}/action`,
    handler: async (request, response) => {
      const url = requestUrl(request)
      if (!url) return sendJson(response, 400, { ok: false, error: 'bad-request' })
      if (request.method !== 'POST') return sendJson(response, 405, { ok: false, error: 'method' })
      if (tokenFrom(request, url) !== token) {
        return sendJson(response, 401, { ok: false, error: 'unauthorized' })
      }
      let body
      try {
        body = JSON.parse(await readBody(request))
      } catch (_error) {
        return sendJson(response, 400, { ok: false, error: 'invalid-json' })
      }
      if (!body || typeof body !== 'object') {
        return sendJson(response, 400, { ok: false, error: 'invalid-body' })
      }
      if (body.type === 'open-window') {
        return sendJson(response, 200, openWindow())
      }
      if (body.type === 'companion-ping') {
        companionBeat = Date.now()
        return sendJson(response, 200, { ok: true })
      }
      if (body.type === 'feed-older') {
        ensureHostFeed()
        if (!state.activeSessionId || hostFeedSession !== state.activeSessionId) {
          return sendJson(response, 200, { ok: true, rows: [], hasOlder: false })
        }
        const first = hostFeed[0]
        const before = first && Number.isSafeInteger(first.seq) ? first.seq : 0
        if (before <= 0) {
          hostFeedHasOlder = false
          return sendJson(response, 200, { ok: true, rows: [], hasOlder: false })
        }
        const sessions = ctx.get('sessions')
        const session = sessions && typeof sessions.get === 'function'
          ? sessions.get(state.activeSessionId)
          : null
        if (!session || typeof session.snapshotEvents !== 'function') {
          return sendJson(response, 200, { ok: true, rows: [], hasOlder: false })
        }
        let events = []
        try {
          events = session.snapshotEvents(Math.max(0, before - 300), before)
        } catch (_error) {
          events = []
        }
        const older = []
        for (const event of events) {
          if (!Number.isSafeInteger(event.seq) || event.seq >= before) continue
          const row = hostRowFromEvent(event)
          if (row) older.push(row)
        }
        const page = older.slice(-20)
        if (page.length) hostFeed = [...page, ...hostFeed].slice(-120)
        hostFeedHasOlder = hostFeed.length > 0 && Number.isSafeInteger(hostFeed[0].seq) && hostFeed[0].seq > 0
        return sendJson(response, 200, {
          ok: true,
          rows: page,
          hasOlder: hostFeedHasOlder,
        })
      }
      if (body.type === 'question-answer') {
        const key = typeof body.key === 'string' ? body.key : ''
        const answers = normalizeQuestionAnswers(body.answers)
        if (!key || !answers.length) {
          return sendJson(response, 400, { ok: false, error: 'invalid-answer' })
        }
        if (!live.question || live.question.key !== key) {
          return sendJson(response, 409, { ok: false, error: 'stale-question' })
        }
        live.questionAnswer = {
          id: randomUUID(),
          key,
          answers,
          at: Date.now(),
        }
        return sendJson(response, 200, { ok: true })
      }
      if (body.type === 'question-answer-ack') {
        const key = typeof body.key === 'string' ? body.key : ''
        if (live.questionAnswer && live.questionAnswer.key === key) {
          live.questionAnswer = null
        }
        return sendJson(response, 200, { ok: true })
      }
      if (body.type === 'approval-answer') {
        const key = typeof body.key === 'string' ? body.key : ''
        const outcome = body.outcome === 'allow' ? 'allow' : body.outcome === 'reject' ? 'reject' : ''
        if (!key || !outcome) {
          return sendJson(response, 400, { ok: false, error: 'invalid-answer' })
        }
        if (!pendingApproval || !live.approval || pendingApproval.key !== key) {
          return sendJson(response, 409, { ok: false, error: 'stale-approval' })
        }
        pendingApproval.answer(outcome === 'allow' ? 'allowed-once' : 'rejected')
        note(`approval answered key=${key} outcome=${outcome}`)
        return sendJson(response, 200, { ok: true })
      }
      if (body.type === 'prompt' || body.type === 'stop') {
        const controller = ctx.get('sessionController')
        const sessionId = state.activeSessionId
        if (!controller) {
          return sendJson(response, 503, { ok: false, error: 'session-unavailable' })
        }
        if (!sessionId) {
          return sendJson(response, 409, { ok: false, error: 'no-active-session' })
        }
        if (body.type === 'stop') {
          try {
            controller.cancel({ sessionId })
            return sendJson(response, 200, { ok: true })
          } catch (error) {
            return sendJson(response, 500, {
              ok: false,
              error: String((error && error.message) || error),
            })
          }
        }
        const text = typeof body.text === 'string' ? body.text.trim() : ''
        if (!text) return sendJson(response, 400, { ok: false, error: 'empty-text' })
        const mode = body.mode === 'steer' ? 'steer' : 'queue'
        try {
          const result = await controller.prompt(
            {
              requestId: randomUUID(),
              sessionId,
              mode,
              content: [{ type: 'text', text: text.slice(0, 32000) }],
            },
            AbortSignal.timeout(30000),
          )
          return sendJson(response, 200, {
            ok: true,
            accepted: Boolean(result && result.accepted),
          })
        } catch (error) {
          return sendJson(response, 500, {
            ok: false,
            error: String((error && error.message) || error),
            code: error && error.code,
          })
        }
      }
      if (Array.isArray(body.imageRefs)) {
        for (const image of body.imageRefs.slice(-200)) {
          const entry = normalizeImageEntry(image)
          if (entry) rememberImage(entry.id, entry.ref)
        }
      }
      if ('usage' in body) {
        live.usage = normalizeUsage(body.usage)
      }
      if (Array.isArray(body.feed)) {
        live.feedAt = Date.now()
        live.feed = body.feed
          .slice(-24)
          .map((row) => normalizeLiveRow(row, rememberImage))
          .filter(Boolean)
      }
      if (body.partial === null) live.partial = null
      else if (body.partial && typeof body.partial === 'object') {
        live.partial = normalizeLivePartial(body.partial)
      }
      if (typeof body.running === 'boolean') live.running = body.running
      if (typeof body.dshFocused === 'boolean') live.dshFocused = body.dshFocused
      if (typeof body.latest === 'string') live.latest = body.latest.slice(0, 600)
      if ('question' in body) {
        live.question = normalizeQuestion(body.question)
        if (!live.question) live.questionAnswer = null
      }
      if (body.questionDebug && typeof body.questionDebug === 'object') {
        live.questionDebug = {
          hasUiSession: body.questionDebug.hasUiSession === true,
          sessionId: typeof body.questionDebug.sessionId === 'string'
            ? body.questionDebug.sessionId.slice(0, 200)
            : null,
          hasStatus: body.questionDebug.hasStatus === true,
          pendingKind: typeof body.questionDebug.pendingKind === 'string'
            ? body.questionDebug.pendingKind.slice(0, 40)
            : '',
          ...(body.questionDebug.error
            ? { error: String(body.questionDebug.error).slice(0, 300) }
            : {}),
        }
      }
      const persistent =
        Array.isArray(body.todos) ||
        Array.isArray(body.reminders) ||
        (body.settings && typeof body.settings === 'object' && !Array.isArray(body.settings)) ||
        'activeSessionId' in body
      if (!persistent) {
        return sendJson(response, 200, { ok: true, rev: state.rev })
      }
      let activeSessionId =
        typeof body.activeSessionId === 'string'
          ? body.activeSessionId
          : body.activeSessionId === null
            ? null
            : state.activeSessionId
      // Leaving the conversation page can briefly report "no session". Keep
      // the last one while the companion is open so its Host feed survives.
      if (!activeSessionId && state.activeSessionId && companionIsOpen()) {
        activeSessionId = state.activeSessionId
      }
      const next = {
        version: 1,
        rev: state.rev + 1,
        todos: Array.isArray(body.todos)
          ? body.todos.map(normalizeTodo).filter(Boolean).slice(0, 3000)
          : state.todos,
        reminders: Array.isArray(body.reminders)
          ? body.reminders.map(normalizeReminder).filter(Boolean).slice(0, 3000)
          : state.reminders,
        settings:
          body.settings && typeof body.settings === 'object' && !Array.isArray(body.settings)
            ? body.settings
            : state.settings,
        activeSessionId,
      }
      if (next.activeSessionId !== state.activeSessionId) {
        live.approval = null
        live.question = null
        live.questionAnswer = null
        live.questionDebug = null
        live.running = false
        live.partial = null
        hostFeedSession = null
        hostFeed = []
        hostFeedHasOlder = false
        hostFeedLastUser = null
        live.feedAt = 0
        seedHostFeed(next.activeSessionId)
      }
      state = next
      saveState(state)
      sendJson(response, 200, { ok: true, rev: state.rev })
    },
  }

  const assetRoutes = [
    { path: `${ROUTE_BASE}/panel`, file: 'index.html', type: 'text/html; charset=utf-8' },
    { path: `${ROUTE_BASE}/panel.js`, file: 'panel.js', type: 'text/javascript; charset=utf-8' },
    { path: `${ROUTE_BASE}/panel.css`, file: 'panel.css', type: 'text/css; charset=utf-8' },
    { path: `${ROUTE_BASE}/panel-icon.png`, file: 'icon.png', type: 'image/png' },
  ].map((asset) => ({
    kind: 'exact',
    path: asset.path,
    handler: (request, response) => {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.statusCode = 405
        response.end('method not allowed')
        return
      }
      try {
        const body = readFileSync(join(panelDirectory, asset.file))
        response.statusCode = 200
        response.setHeader('content-type', asset.type)
        response.setHeader('cache-control', 'no-store')
        response.end(body)
      } catch (_error) {
        response.statusCode = 404
        response.end('not found')
      }
    },
  }))

  ctx.effect(() => {
    const disposers = [
      ctx.on(
        'session/event',
        (session, event) => {
          if (!session || session.id !== state.activeSessionId) return
          if (hostFeedSession !== session.id) {
            seedHostFeed(session.id)
            return
          }
          if (event.type === 'turn/start') {
            live.running = true
            live.partial = null
          } else if (event.type === 'turn/end') {
            live.running = false
            live.partial = null
          }
          const row = hostRowFromEvent(event)
          if (!row) return
          hostFeed.push(row)
          if (row.kind === 'user' || row.kind === 'steering') hostFeedLastUser = row
          if (hostFeed.length > 120) hostFeed = hostFeed.slice(-120)
          if (
            hostFeedLastUser &&
            !hostFeed.some((item) => item.seq === hostFeedLastUser.seq)
          ) {
            hostFeed = [hostFeedLastUser, ...hostFeed]
          }
          hostFeedHasOlder =
            hostFeed.length > 0 && Number.isSafeInteger(hostFeed[0].seq) && hostFeed[0].seq > 0
        },
        { global: true },
      ),
      ctx.on('approval/request', handleApprovalRequest, { prepend: true }),
      webServer.register(configRoute),
      webServer.register(stateRoute),
      webServer.register(attachmentRoute),
      webServer.register(actionRoute),
      ...assetRoutes.map((route) => webServer.register(route)),
    ]
    disposers.push(
      ctx.on('webserver/index-inject', (table) => {
        table.push({
          kind: 'global',
          name: '__QUICK_PANEL_CONFIG__',
          value: { token, version: 1 },
        })
      }),
    )
    return () => {
      for (const dispose of disposers) {
        try {
          dispose()
        } catch (_error) {
          /* route already gone */
        }
      }
      if (pendingApproval) {
        pendingApproval.answer('cancelled')
        pendingApproval = null
      }
      if (child) {
        try {
          child.kill()
        } catch (_error) {
          /* already gone */
        }
        child = null
      }
    }
  }, 'quick-panel: host api')
}
