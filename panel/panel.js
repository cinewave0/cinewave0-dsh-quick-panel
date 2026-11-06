'use strict'

const BASE = '/quick-panel'
const TOKEN = new URLSearchParams(location.search).get('token') || ''
const INITIAL_MODE = new URLSearchParams(location.search).get('mode')
if (INITIAL_MODE === 'island') document.body.classList.add('mode-island')
const $ = (id) => document.getElementById(id)

let snapshot = {
  todos: [],
  reminders: [],
  activeSessionId: null,
  feed: [],
  feedSource: 'client',
  feedHasOlder: false,
  partial: null,
  running: false,
  latest: '',
  sessionLabel: '',
  approval: null,
  question: null,
  questionAnswer: null,
  usage: null,
  rev: -1,
}
let busy = false
let following = true
let loadingOlder = false
let feedSignature = ''
let approvalSignature = ''
let approvalAnswering = false
let questionSignature = ''
let questionDraft = null
let questionIndex = 0
let questionBusy = false
let approvalWaitTimer = 0
let lastRunning = false
let runStartedAt = 0
let doneText = ''
let doneUntil = 0
let doneToastTimer = 0

function pad(value) {
  return String(value).padStart(2, '0')
}

function formatDuration(ms) {
  const total = Math.max(0, Math.floor(ms / 1000))
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`
}

function element(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

function formatWhen(at) {
  const date = new Date(at)
  const now = new Date()
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`
  if (date.toDateString() === now.toDateString()) return `今天 ${time}`
  const tomorrow = new Date(now)
  tomorrow.setDate(now.getDate() + 1)
  if (date.toDateString() === tomorrow.toDateString()) return `明天 ${time}`
  return `${date.getMonth() + 1}-${date.getDate()} ${time}`
}

function formatFeedTime(time) {
  const date = new Date(time)
  if (!Number.isFinite(date.getTime())) return ''
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function compactTokens(value) {
  if (!Number.isFinite(value) || value < 0) return '—'
  if (value >= 1e9) return `${(value / 1e9).toFixed(2)}G`
  if (value >= 1e6) return `${(value / 1e6).toFixed(2)}M`
  if (value >= 1e3) return `${(value / 1e3).toFixed(1)}k`
  return String(Math.round(value))
}

function formatTps(value) {
  if (!Number.isFinite(value) || value <= 0) return ''
  return value >= 10 ? String(Math.round(value)) : String(Math.round(value * 10) / 10)
}

function formatMoney(amount, currency) {
  const value = Number(amount)
  if (!Number.isFinite(value)) return '—'
  const symbol = currency === 'CNY' ? '¥' : currency === 'USD' ? '$' : `${currency} `
  if (value > 0 && value < 0.01) return `<${symbol}0.01`
  return `${symbol}${value.toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

function formatBalance(balance) {
  if (!balance || balance.status !== 'ready') return '—'
  if (!Array.isArray(balance.wallets) || !balance.wallets.length) return '—'
  return balance.wallets.map((wallet) => formatMoney(wallet.balance, wallet.currency)).join(' / ')
}

function renderUsage() {
  const session = $('usage-session')
  const tps = $('usage-tps')
  const thirty = $('usage-30d')
  const balance = $('usage-balance')
  const context = $('context-usage')
  const contextValue = $('context-value')
  const workingDir = $('working-dir')
  const modelInfo = $('model-info')
  if (
    !session ||
    !tps ||
    !thirty ||
    !balance ||
    !context ||
    !contextValue ||
    !workingDir ||
    !modelInfo
  ) return
  const effortLabel = (value) => {
    const raw = typeof value === 'string' ? value.trim() : ''
    if (!raw) return ''
    const labels = {
      minimal: '极低',
      low: '低',
      medium: '中',
      high: '高',
      xhigh: '最高',
      max: '最高',
    }
    return labels[raw.toLowerCase()] || raw
  }
  const drawModel = (usage) => {
    const model = usage && typeof usage.model === 'string' ? usage.model.trim() : ''
    const effort = usage && typeof usage.reasoningEffort === 'string' ? usage.reasoningEffort : ''
    const label = [model, effortLabel(effort)].filter(Boolean).join(' · ')
    modelInfo.hidden = !label || !snapshot.sessionLabel
    modelInfo.textContent = label
    modelInfo.title = [
      model ? `当前模型：${model}` : '',
      effort ? `推理深度：${effort}${effortLabel(effort) && effortLabel(effort) !== effort ? `（${effortLabel(effort)}）` : ''}` : '',
      usage && usage.modelProvider ? `Provider：${usage.modelProvider}` : '',
    ].filter(Boolean).join('；')
  }
  const drawContext = (usage) => {
    const percent = usage && Number.isFinite(usage.contextPercent) ? usage.contextPercent : null
    const directory =
      usage && typeof usage.workingDirectory === 'string' ? usage.workingDirectory.trim() : ''
    if (directory) {
      workingDir.textContent = directory
      workingDir.title = `工作目录：${directory}`
      workingDir.hidden = false
    } else {
      workingDir.textContent = ''
      workingDir.title = ''
      workingDir.hidden = true
    }
    if (percent === null) {
      contextValue.textContent = '—'
      context.title = '等待上下文用量统计'
      context.classList.remove('is-high')
      return
    }
    contextValue.textContent = `${Math.round(percent)}%`
    context.title = `上下文 ${percent.toFixed(1)}% · ${Number(usage.contextTokens || 0).toLocaleString('zh-CN')} / ${Number(usage.contextWindow || 0).toLocaleString('zh-CN')} tokens${directory ? `\n工作目录：${directory}` : ''}`
    context.classList.toggle('is-high', percent >= 80)
  }
  const usage = snapshot.usage
  if (!usage || typeof usage !== 'object') {
    session.textContent = '—'
    tps.textContent = '—'
    thirty.textContent = '—'
    balance.textContent = '—'
    session.title = '等待当前对话的 token 统计'
    thirty.title = '最近 30 天本机 DSH 会话 token 总量'
    balance.title = '账号余额未加载'
    drawContext(null)
    drawModel(null)
    return
  }
  const sessionKnown = usage.sessionKnown !== false
  session.textContent = sessionKnown ? compactTokens(usage.sessionTokens) : '—'
  session.title = sessionKnown
    ? `本次会话 ${Number(usage.sessionTokens || 0).toLocaleString('zh-CN')} tokens；输出 ${Number(usage.sessionOutputTokens || 0).toLocaleString('zh-CN')} tokens`
    : '等待当前对话的 token 统计'
  const speed = sessionKnown ? formatTps(usage.tps) : ''
  tps.textContent = speed ? `${speed} tok/s` : '—'
  tps.title = '本次会话平均输出速度（decode tokens / decode time）'
  thirty.textContent = compactTokens(usage.thirtyDayTokens)
  thirty.title = `最近 30 天约 ${Number(usage.thirtyDayTokens || 0).toLocaleString('zh-CN')} tokens（${Number(usage.sessionCount || 0)} 个会话，含缓存读取）`
  balance.textContent = formatBalance(usage.balance)
  const bonus = usage.balance && Array.isArray(usage.balance.bonusWallets)
    ? usage.balance.bonusWallets.map((wallet) => formatMoney(wallet.balance, wallet.currency)).join(' / ')
    : ''
  balance.title = bonus
    ? `充值余额；赠金 ${bonus}`
    : usage.balance && usage.balance.status === 'unavailable'
      ? '账号余额不可用（未登录或仅使用 API Key）'
      : '充值余额'
  drawContext(usage)
  drawModel(usage)
}

async function readState() {
  const response = await fetch(`${BASE}/state?token=${encodeURIComponent(TOKEN)}`, {
    cache: 'no-store',
  })
  if (!response.ok) throw new Error('state')
  return await response.json()
}

async function post(body) {
  const response = await fetch(`${BASE}/action?token=${encodeURIComponent(TOKEN)}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-quick-panel-token': TOKEN,
    },
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new Error('action')
  return await response.json()
}

/* --------------------------------------------------------------- todos */

function renderTodos() {
  const list = $('todo-list')
  list.replaceChildren()
  const todos = Array.isArray(snapshot.todos) ? snapshot.todos : []
  const pending = todos.filter((todo) => !todo.done).length
  $('todo-count').textContent = `${pending}/${todos.length}`
  if (!todos.length) {
    list.append(element('div', 'empty', '还没有待办'))
    return
  }
  const ordered = [...todos.filter((todo) => !todo.done), ...todos.filter((todo) => todo.done)]
  for (const [index, todo] of ordered.entries()) {
    const row = element('div', `todo${todo.done ? ' done' : ''}`)
    const check = element('button', `check${todo.done ? ' on' : ''}`, todo.done ? '✓' : '')
    check.type = 'button'
    check.setAttribute('aria-pressed', String(Boolean(todo.done)))
    check.setAttribute('aria-label', todo.done ? '标记未完成' : '标记完成')
    check.addEventListener('click', () => {
      void setTodoDone(todo, !todo.done)
    })
    const text = element('span', 'todo-text', todo.text)
    text.title = `${todo.text} · 点击编辑`
    text.addEventListener('click', () => {
      startEditTodo(todo, text)
    })
    const handoff = element('button', 'handoff', '↵')
    handoff.type = 'button'
    handoff.title = '填入输入框'
    handoff.setAttribute('aria-label', '填入输入框')
    handoff.addEventListener('click', () => {
      fillComposer(todo.text)
    })
    const copy = element('button', 'copy', '⧉')
    copy.type = 'button'
    copy.title = '复制'
    copy.setAttribute('aria-label', '复制')
    copy.addEventListener('click', () => {
      void copyText(todo.text)
    })
    const remove = element('button', 'delete', '×')
    remove.type = 'button'
    remove.title = '删除'
    remove.setAttribute('aria-label', '删除')
    remove.addEventListener('click', () => {
      void removeTodo(todo)
    })
    row.append(check, text, handoff, copy, remove)
    row.prepend(element('span', 'todo-index', `${index + 1}.`))
    list.append(row)
  }
}

async function copyText(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text)
      setSync('已复制')
      return
    }
  } catch (_error) {
    /* fall back */
  }
  try {
    const area = document.createElement('textarea')
    area.value = text
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.append(area)
    area.select()
    document.execCommand('copy')
    area.remove()
    setSync('已复制')
  } catch (_error) {
    setSync('复制失败')
  }
}

function startEditTodo(todo, textElement) {
  if (textElement.querySelector('input')) return
  const input = document.createElement('input')
  input.className = 'todo-edit'
  input.value = todo.text
  let finished = false
  const finish = async (save) => {
    if (finished) return
    finished = true
    const value = input.value.trim()
    input.remove()
    textElement.textContent = value || todo.text
    if (!save || !value || value === todo.text) return
    const next = snapshot.todos.map((item) =>
      item.id === todo.id ? { ...item, text: value } : item,
    )
    try {
      await post({ todos: next })
      await refresh(true)
    } catch (_error) {
      setSync('保存失败，稍后重试')
      await refresh(true)
    }
  }
  textElement.replaceChildren(input)
  input.focus()
  input.select()
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      void finish(true)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      void finish(false)
    }
  })
  input.addEventListener('blur', () => {
    void finish(true)
  })
}

function renderReminders() {
  const list = $('reminder-list')
  list.replaceChildren()
  const reminders = Array.isArray(snapshot.reminders) ? snapshot.reminders : []
  if (!reminders.length) {
    list.append(element('div', 'empty', '还没有提醒'))
    return
  }
  const now = Date.now()
  const sorted = [...reminders].sort((left, right) => left.at - right.at)
  for (const [index, reminder] of sorted.entries()) {
    const due = reminder.at <= now && reminder.firedFor !== reminder.at
    const row = element('div', `reminder${reminder.at <= now ? ' is-past' : ''}${due ? ' is-due' : ''}`)
    const time = element('span', 'reminder-time', formatWhen(reminder.at))
    const text = element('span', 'reminder-text', reminder.text)
    text.title = reminder.text
    const remove = element('button', 'delete', '×')
    remove.type = 'button'
    remove.title = '删除'
    remove.setAttribute('aria-label', '删除')
    remove.addEventListener('click', () => {
      void removeReminder(reminder)
    })
    row.append(time, text)
    row.prepend(element('span', 'reminder-index', `${index + 1}.`))
    if (due) row.append(element('span', 'reminder-due', '到点'))
    row.append(remove)
    list.append(row)
  }
}

async function setTodoDone(todo, done) {
  const next = snapshot.todos.map((item) => (item.id === todo.id ? { ...item, done } : item))
  await send({ todos: next })
}

async function removeTodo(todo) {
  const next = snapshot.todos.filter((item) => item.id !== todo.id)
  await send({ todos: next })
}

async function removeReminder(reminder) {
  const next = snapshot.reminders.filter((item) => item.id !== reminder.id)
  await send({ reminders: next })
}

async function send(patch) {
  try {
    await post(patch)
    await refresh(true)
  } catch (_error) {
    setSync('保存失败，稍后重试')
  }
}

async function addTodo() {
  const input = $('todo-input')
  const text = input.value.trim()
  if (!text) return
  const todo = {
    id: crypto.randomUUID(),
    text,
    done: false,
    handedOff: false,
    createdAt: Date.now(),
  }
  input.value = ''
  input.style.height = ''
  await send({ todos: [todo, ...snapshot.todos] })
}

/* ---------------------------------------------------------------- feed */

function feedKey() {
  return JSON.stringify({
    feed: snapshot.feed,
    partial: snapshot.partial,
    running: snapshot.running,
  })
}

function updateFeedStatus() {
  $('feed-status').textContent = snapshot.running
    ? '运行中'
    : snapshot.activeSessionId
      ? '在线'
      : ''
}

function updateJump() {
  const feed = $('feed')
  const jump = $('feed-jump')
  if (!feed || !jump) return
  jump.hidden = following || feed.scrollHeight <= feed.clientHeight + 4
}

function appendRichText(container, text) {
  const pattern = /```([\w-]*)\r?\n?([\s\S]*?)```/g
  let last = 0
  let match
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) container.append(document.createTextNode(text.slice(last, match.index)))
    const card = element('div', 'code-card')
    card.append(element('div', 'code-head', match[1] || 'code'))
    card.append(element('pre', 'code-body', match[2]))
    container.append(card)
    last = pattern.lastIndex
  }
  if (last < text.length) container.append(document.createTextNode(text.slice(last)))
}

function appendBlock(container, block, caret) {
  if (!block || typeof block !== 'object') return
  if (block.kind === 'reasoning') {
    const box = element('div', 'reasoning')
    box.append(element('div', 'reasoning-label', '推理'))
    box.append(element('div', 'reasoning-text', block.text || ''))
    container.append(box)
    return
  }
  if (block.kind === 'tool-call') {
    const chip = element('div', 'tool-chip')
    chip.append(element('span', 'tool-dot'))
    chip.append(element('span', null, block.name || '工具'))
    container.append(chip)
    return
  }
  if (block.kind === 'image') {
    container.append(element('div', 'feed-text', '[图片]'))
    return
  }
  const wrap = element('div', 'feed-text')
  appendRichText(wrap, block.text || '')
  if (caret) wrap.append(element('span', 'caret'))
  container.append(wrap)
}

function buildChip(text, isError) {
  const chip = element('div', `tool-chip is-result${isError ? ' is-error' : ''}`)
  chip.append(element('span', 'tool-dot'))
  chip.append(element('span', null, text))
  return chip
}

function attachmentSrc(image) {
  const id = image && typeof image.id === 'string' ? image.id : ''
  if (!id || !TOKEN) return ''
  return `${BASE}/attachment?id=${encodeURIComponent(id)}&token=${encodeURIComponent(TOKEN)}`
}

function openImageViewer(image) {
  const viewer = $('image-viewer')
  const target = $('image-viewer-img')
  const source = attachmentSrc(image)
  if (!viewer || !target || !source) return
  target.src = source
  target.alt = (image && image.name) || '图片'
  viewer.hidden = false
  document.body.classList.add('viewer-open')
  const close = $('image-viewer-close')
  if (close) close.focus()
}

function closeImageViewer() {
  const viewer = $('image-viewer')
  const target = $('image-viewer-img')
  if (!viewer) return
  viewer.hidden = true
  document.body.classList.remove('viewer-open')
  if (target) target.removeAttribute('src')
}

function wireImageViewer() {
  const viewer = $('image-viewer')
  const close = $('image-viewer-close')
  if (close) close.addEventListener('click', closeImageViewer)
  if (viewer) {
    viewer.addEventListener('click', (event) => {
      if (event.target === viewer) closeImageViewer()
    })
  }
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && viewer && !viewer.hidden) closeImageViewer()
  })
}

function buildFeedImages(images) {
  const wrap = element('div', 'feed-images')
  for (const image of images.slice(0, 4)) {
    const source = attachmentSrc(image)
    if (!source) continue
    const button = element('button', 'feed-image')
    button.type = 'button'
    const label = (image && image.name) || '图片'
    button.title = `${label} · 点击查看原图`
    button.setAttribute('aria-label', button.title)
    const img = document.createElement('img')
    img.alt = label
    img.loading = 'lazy'
    img.decoding = 'async'
    let attempt = 0
    img.addEventListener('error', () => {
      attempt += 1
      if (attempt <= 2) {
        window.setTimeout(() => {
          img.src = `${source}&retry=${attempt}`
        }, 450 * attempt)
        return
      }
      button.classList.add('is-failed')
      button.disabled = true
      button.replaceChildren(element('span', 'feed-image-fallback', '[图片]'))
    })
    img.src = source
    button.append(img)
    button.addEventListener('click', () => openImageViewer(image))
    wrap.append(button)
  }
  return wrap
}

function buildFeedRow(row) {
  if (!row || typeof row !== 'object') return null
  if (row.kind === 'user' || row.kind === 'steering') {
    const node = element('div', `feed-row ${row.kind === 'steering' ? 'is-steering' : 'is-user'}`)
    node.append(
      element(
        'div',
        'feed-meta',
        `${row.kind === 'steering' ? '转向' : '你'} · ${formatFeedTime(row.time)}`,
      ),
    )
    const images = Array.isArray(row.images)
      ? row.images.filter((image) => image && typeof image.id === 'string' && image.id)
      : []
    if (images.length) node.append(buildFeedImages(images))
    else if (row.hasImage) node.append(element('span', 'feed-image-tag', '[图片]'))
    node.append(element('div', 'feed-text', row.text || ''))
    return node
  }
  if (row.kind === 'assistant') {
    const node = element('div', 'feed-row is-assistant')
    const meta = `DSH · ${formatFeedTime(row.time)}${row.interrupted ? ' · 已中断' : ''}`
    node.append(element('div', 'feed-meta', meta))
    for (const block of Array.isArray(row.blocks) ? row.blocks : []) {
      appendBlock(node, block, false)
    }
    return node
  }
  if (row.kind === 'tool-result') {
    return buildChip(`${row.name || '工具'} · ${row.isError ? '失败' : '完成'}`, row.isError)
  }
  if (row.kind === 'turn-error') {
    const node = element('div', 'feed-row is-error')
    node.append(element('div', 'feed-meta', `DSH · ${formatFeedTime(row.time)}`))
    node.append(element('div', 'feed-error', row.message || '出错了'))
    return node
  }
  return null
}

function buildPartialRow(partial) {
  const node = element('div', 'feed-row is-assistant is-streaming')
  node.append(element('div', 'feed-meta', 'DSH · 生成中'))
  const blocks = Array.isArray(partial.blocks) ? partial.blocks : []
  let caretAdded = false
  blocks.forEach((block, index) => {
    const last = index === blocks.length - 1
    const caret = last && block && block.kind === 'text'
    appendBlock(node, block, caret)
    if (caret) caretAdded = true
  })
  if (!caretAdded) node.append(element('span', 'caret'))
  return node
}

function renderFeed(force) {
  const key = feedKey()
  if (!force && key === feedSignature) {
    updateFeedStatus()
    updateComposer()
    return
  }
  feedSignature = key
  const rows = $('feed-rows')
  const empty = $('feed-empty')
  const fragment = document.createDocumentFragment()
  for (const row of Array.isArray(snapshot.feed) ? snapshot.feed : []) {
    const node = buildFeedRow(row)
    if (node) fragment.append(node)
  }
  if (snapshot.partial) fragment.append(buildPartialRow(snapshot.partial))
  rows.replaceChildren(fragment)
  empty.hidden = rows.childElementCount > 0
  updateFeedStatus()
  updateComposer()
  if (following) {
    const feed = $('feed')
    feed.scrollTop = feed.scrollHeight
  }
  updateJump()
}

async function loadOlderFeed() {
  if (loadingOlder || snapshot.feedSource !== 'host' || !snapshot.feedHasOlder) return
  loadingOlder = true
  const feed = $('feed')
  const previousHeight = feed.scrollHeight
  const previousTop = feed.scrollTop
  try {
    const result = await post({ type: 'feed-older' })
    if (!result || !result.ok || !Array.isArray(result.rows)) return
    const seen = new Set(
      (snapshot.feed || []).map((row) => row && row.seq).filter((seq) => Number.isSafeInteger(seq)),
    )
    const older = result.rows.filter((row) => row && !seen.has(row.seq))
    if (!older.length) {
      snapshot = { ...snapshot, feedHasOlder: Boolean(result.hasOlder) }
      return
    }
    snapshot = {
      ...snapshot,
      feed: [...older, ...(snapshot.feed || [])],
      feedHasOlder: Boolean(result.hasOlder),
    }
    following = false
    renderFeed(true)
    feed.scrollTop = feed.scrollHeight - previousHeight + previousTop
  } catch (_error) {
    /* keep the current feed; the next scroll-top retries */
  } finally {
    loadingOlder = false
  }
}

function wireFeed() {
  const feed = $('feed')
  feed.addEventListener('scroll', () => {
    const distance = feed.scrollHeight - feed.scrollTop - feed.clientHeight
    following = distance < 24
    if (feed.scrollTop <= 4) void loadOlderFeed()
    updateJump()
  })
  $('feed-jump').addEventListener('click', () => {
    following = true
    feed.scrollTop = feed.scrollHeight
    updateJump()
  })
}

/* ------------------------------------------------------------ approval */

function approvalSignatureOf(approval) {
  return approval ? `${approval.key}|${approval.toolName}|${approval.reason}` : ''
}

function renderApproval(force) {
  const card = $('approval-card')
  if (!card) return
  const approval = snapshot.approval
  const signature = approvalSignatureOf(approval)
  if (!force && signature === approvalSignature) {
    updateComposer()
    return
  }
  const changed = signature !== approvalSignature
  approvalSignature = signature
  if (changed) approvalAnswering = false
  if (!approval) {
    if (approvalWaitTimer) {
      clearTimeout(approvalWaitTimer)
      approvalWaitTimer = 0
    }
    card.hidden = true
    approvalAnswering = false
    updateComposer()
    return
  }
  $('approval-tool').textContent = approval.toolName || '工具'
  $('approval-reason').textContent =
    approval.reason || approval.displayReason || '工具请求越权执行'
  card.hidden = false
  $('approval-allow').disabled = approvalAnswering
  $('approval-reject').disabled = approvalAnswering
  updateComposer()
  if (changed && !approvalAnswering) {
    if (document.body.classList.contains('mode-island')) {
      const desktop = window.quickPanelDesktop
      if (desktop && typeof desktop.expand === 'function') void desktop.expand()
    } else {
      const active = document.activeElement
      if (active && typeof active.blur === 'function') active.blur()
      if (document.hasFocus()) {
        const allow = $('approval-allow')
        if (allow) allow.focus()
      }
    }
  }
}

async function answerApproval(outcome) {
  const approval = snapshot.approval
  if (!approval || approvalAnswering) return
  approvalAnswering = true
  renderApproval(true)
  setSync(outcome === 'allow' ? '已允许，等待对话确认…' : '已拒绝，等待对话确认…')
  if (approvalWaitTimer) clearTimeout(approvalWaitTimer)
  approvalWaitTimer = window.setTimeout(() => {
    approvalWaitTimer = 0
    if (snapshot.approval && snapshot.approval.key === approval.key) {
      approvalAnswering = false
      renderApproval(true)
      setSync('未收到对话确认，可重试')
    }
  }, 8000)
  try {
    const result = await post({
      type: 'approval-answer',
      key: approval.key,
      outcome,
    })
    if (!result || !result.ok) {
      approvalAnswering = false
      renderApproval(true)
      setSync(result && result.error === 'stale-approval' ? '该权限请求已处理' : '权限回答失败')
    }
  } catch (_error) {
    approvalAnswering = false
    renderApproval(true)
    setSync('权限回答失败，稍后重试')
  }
}

function wireApproval() {
  $('approval-allow').addEventListener('click', () => {
    void answerApproval('allow')
  })
  $('approval-reject').addEventListener('click', () => {
    void answerApproval('reject')
  })
  window.addEventListener('keydown', (event) => {
    if (!snapshot.approval || approvalAnswering) return
    if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return
    const target = event.target
    if (
      target &&
      typeof target.closest === 'function' &&
      target.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]')
    ) {
      return
    }
    if (event.key === 'Enter') {
      if (
        target &&
        typeof target.closest === 'function' &&
        target.closest('button, a[href], [role="button"]')
      ) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      void answerApproval('allow')
    } else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      void answerApproval('reject')
    }
  })
}

/* ------------------------------------------------------------ questions */

function questionDraftFor(question) {
  return {
    key: question.key,
    index: 0,
    answers: question.questions.map(() => ({ selected: [], custom: '' })),
  }
}

function questionAnswered(question, answer) {
  return Boolean(answer && (answer.selected.length > 0 || answer.custom.trim()))
}

function renderQuestion() {
  const card = $('question-card')
  if (!card) return
  const question = snapshot.question
  if (!question || !Array.isArray(question.questions) || !question.questions.length) {
    card.hidden = true
    questionSignature = ''
    questionDraft = null
    questionBusy = false
    return
  }
  const signature = JSON.stringify({
    key: question.key,
    kind: question.kind,
    questions: question.questions,
  })
  if (signature !== questionSignature || !questionDraft || questionDraft.key !== question.key) {
    questionSignature = signature
    questionDraft = questionDraftFor(question)
    questionIndex = 0
    questionBusy = false
  } else {
    card.hidden = false
    return
  }
  card.hidden = false
  renderQuestionBody()
}

function renderQuestionBody() {
  const card = $('question-card')
  const question = snapshot.question
  const draft = questionDraft
  if (!card || !question || !draft) return
  const index = Math.min(Math.max(questionIndex, 0), question.questions.length - 1)
  questionIndex = index
  const item = question.questions[index]
  const answer = draft.answers[index]
  $('question-kind').textContent = question.kind === 'plan-review' ? '计划审阅' : '需要选择'
  $('question-progress').textContent =
    question.questions.length > 1
      ? `${index + 1} / ${question.questions.length}`
      : question.waitState === 'continued'
        ? '可稍后回答'
        : ''
  $('question-title').textContent = item.question || '未命名问题'
  const detail = $('question-detail')
  detail.textContent = item.detail || ''
  detail.hidden = !item.detail
  const options = $('question-options')
  options.textContent = ''
  for (const option of item.options || []) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'question-option'
    if (answer.selected.includes(option.label)) button.classList.add('selected')
    const label = document.createElement('span')
    label.textContent = option.label
    button.appendChild(label)
    if (option.description) {
      const description = document.createElement('span')
      description.className = 'question-option-desc'
      description.textContent = option.description
      button.appendChild(description)
    }
    button.addEventListener('click', () => {
      if (questionBusy) return
      if (item.multiSelect === true) {
        const at = answer.selected.indexOf(option.label)
        if (at >= 0) answer.selected.splice(at, 1)
        else answer.selected.push(option.label)
      } else {
        answer.selected = [option.label]
        answer.custom = ''
      }
      renderQuestionBody()
    })
    options.appendChild(button)
  }
  const custom = $('question-custom')
  custom.value = answer.custom
  custom.disabled = questionBusy
  $('question-custom-row').hidden = question.kind === 'plan-review'
  const pager = card.querySelector('.question-pager')
  pager.hidden = question.questions.length <= 1
  $('question-prev').disabled = questionBusy || index === 0
  $('question-next').disabled = questionBusy || index === question.questions.length - 1
  $('question-submit').disabled = questionBusy
}

async function submitQuestion() {
  const question = snapshot.question
  const draft = questionDraft
  if (!question || !draft || questionBusy) return
  const answers = []
  for (let index = 0; index < question.questions.length; index += 1) {
    const item = question.questions[index]
    const answer = draft.answers[index]
    if (!questionAnswered(item, answer)) {
      questionIndex = index
      renderQuestionBody()
      setSync('还有题目未选择')
      return
    }
    const custom = answer.custom.trim()
    answers.push({
      id: item.id,
      selected: item.multiSelect === true || !custom ? [...answer.selected] : [],
      ...(custom ? { custom } : {}),
    })
  }
  questionBusy = true
  renderQuestionBody()
  setSync('提交中…')
  try {
    const result = await post({
      type: 'question-answer',
      key: question.key,
      answers,
    })
    if (!result || !result.ok) {
      questionBusy = false
      renderQuestionBody()
      setSync('提交失败，请重试')
      return
    }
    setSync('已提交，等待 DSH 确认')
    window.setTimeout(() => {
      if (questionBusy) {
        questionBusy = false
        renderQuestionBody()
        setSync('仍在等待 DSH，确认后可重试')
      }
    }, 5000)
  } catch (_error) {
    questionBusy = false
    renderQuestionBody()
    setSync('提交失败，请重试')
  }
}

function wireQuestion() {
  $('question-prev').addEventListener('click', () => {
    if (questionIndex > 0) {
      questionIndex -= 1
      renderQuestionBody()
    }
  })
  $('question-next').addEventListener('click', () => {
    if (questionDraft && questionIndex < questionDraft.answers.length - 1) {
      questionIndex += 1
      renderQuestionBody()
    }
  })
  $('question-submit').addEventListener('click', () => {
    void submitQuestion()
  })
  $('question-custom').addEventListener('input', (event) => {
    if (!questionDraft || questionBusy) return
    const answer = questionDraft.answers[questionIndex]
    if (!answer) return
    answer.custom = event.target.value
    if (answer.custom.trim()) {
      const item = snapshot.question && snapshot.question.questions[questionIndex]
      if (item && item.multiSelect !== true) answer.selected = []
    }
  })
}

/* ------------------------------------------------------------ composer */

function updateComposer() {
  const input = $('quick-input')
  const sendButton = $('quick-send')
  const stopButton = $('quick-stop')
  if (!input || !sendButton || !stopButton) return
  const connected = Boolean(snapshot.activeSessionId)
  const approvalPending = Boolean(snapshot.approval)
  const questionPending = Boolean(snapshot.question)
  sendButton.disabled = !connected || approvalPending || questionPending || !input.value.trim()
  stopButton.hidden = !snapshot.running
  stopButton.disabled = !connected
  input.disabled = !connected || approvalPending || questionPending
  input.placeholder = approvalPending
    ? '请先处理权限请求'
    : questionPending
      ? '请先回答上方问题'
      : connected
        ? '输入消息，Enter 发送…'
        : '先在 DSH 打开一个对话'
  $('quick-hint').textContent = approvalPending
    ? 'Enter 允许一次 · Esc 拒绝 · 也可点上方按钮'
    : questionPending
      ? '请在上方问题卡中选择或填写答案'
      : snapshot.running
      ? 'Enter 排队 · Ctrl/Cmd+Enter 转向 · ■ 停止'
      : 'Enter 发送 · Shift+Enter 换行'
}

async function sendMessage(mode) {
  const input = $('quick-input')
  const text = input.value.trim()
  if (!text || !snapshot.activeSessionId) return
  const previous = input.value
  input.value = ''
  input.style.height = ''
  updateComposer()
  try {
    const result = await post({ type: 'prompt', text, mode })
    if (!result || !result.ok) {
      input.value = previous
      setSync(result && result.error ? `发送失败：${result.error}` : '发送失败')
    } else {
      setSync(mode === 'steer' ? '已转向' : '已发送')
    }
  } catch (_error) {
    input.value = previous
    setSync('发送失败，稍后重试')
  }
  updateComposer()
}

async function stopTurn() {
  if (!snapshot.activeSessionId) return
  try {
    const result = await post({ type: 'stop' })
    setSync(result && result.ok ? '已停止' : '停止失败')
  } catch (_error) {
    setSync('停止失败，稍后重试')
  }
}

function wireComposer() {
  const input = $('quick-input')
  input.addEventListener('input', () => {
    input.style.height = 'auto'
    input.style.height = `${Math.min(input.scrollHeight, 70)}px`
    updateComposer()
  })
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.shiftKey) return
    if (event.nativeEvent && event.nativeEvent.isComposing) return
    event.preventDefault()
    void sendMessage(event.ctrlKey || event.metaKey ? 'steer' : 'queue')
  })
  $('quick-send').addEventListener('click', () => {
    void sendMessage('queue')
  })
  $('quick-stop').addEventListener('click', () => {
    void stopTurn()
  })
  updateComposer()
}

/* --------------------------------------------------------------- state */

async function refresh(force) {
  if (busy) return
  busy = true
  try {
    const next = await readState()
    const changedTodos = force || JSON.stringify(next.todos || []) !== JSON.stringify(snapshot.todos || [])
    const changedReminders =
      force || JSON.stringify(next.reminders || []) !== JSON.stringify(snapshot.reminders || [])
    const previousFeed = feedKey()
    const previousFeedSource = snapshot.feedSource
    const previousApproval = snapshot.approval
    const previousQuestion = questionSignature
    snapshot = {
      ...snapshot,
      ...next,
      todos: Array.isArray(next.todos) ? next.todos : [],
      reminders: Array.isArray(next.reminders) ? next.reminders : [],
      feed: Array.isArray(next.feed) ? next.feed : [],
      feedSource: next.feedSource === 'host' ? 'host' : 'client',
      feedHasOlder: Boolean(next.feedHasOlder),
      partial: next.partial || null,
      running: Boolean(next.running),
      approval: next.approval && typeof next.approval === 'object' ? next.approval : null,
      question: next.question && typeof next.question === 'object' ? next.question : null,
      usage: next.usage && typeof next.usage === 'object' ? next.usage : null,
      sessionLabel: typeof next.sessionLabel === 'string' ? next.sessionLabel : '',
      activeSessionId: typeof next.activeSessionId === 'string' ? next.activeSessionId : null,
    }
    if (snapshot.running && !lastRunning) {
      runStartedAt = Date.now()
      doneUntil = 0
      if (doneToastTimer) clearTimeout(doneToastTimer)
      doneToastTimer = 0
      const toast = $('done-toast')
      if (toast) toast.hidden = true
    }
    if (!snapshot.running && lastRunning) {
      const elapsed = runStartedAt ? Date.now() - runStartedAt : 0
      doneText = `本轮完成 · ${formatDuration(elapsed)}`
      doneUntil = Date.now() + 8000
      showDoneToast(doneText)
      if (elapsed >= 2000) {
        void playChime('done')
        if (!document.hasFocus()) {
          try {
            if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
              new Notification('本轮已完成', {
                body: `用时 ${formatDuration(elapsed)}`,
                silent: true,
              })
            }
          } catch (_error) {
            /* notifications are optional */
          }
        }
      }
      runStartedAt = 0
    }
    lastRunning = Boolean(snapshot.running)
    if (previousFeedSource !== snapshot.feedSource) following = true
    if (changedTodos) renderTodos()
    if (changedReminders) renderReminders()
    if (
      force ||
      previousFeedSource !== snapshot.feedSource ||
      changedTodos ||
      changedReminders ||
      feedKey() !== previousFeed
    ) {
      renderFeed(force)
    }
    const approvalChanged =
      (previousApproval && previousApproval.key) !== (snapshot.approval && snapshot.approval.key)
    renderApproval(approvalChanged)
    renderQuestion(previousQuestion)
    updateComposer()
    renderIsland()
    renderSessionLabel()
    renderUsage()
    if (!approvalAnswering) setSync(Date.now() < doneUntil && doneText ? doneText : '已同步')
  } catch (_error) {
    setSync('离线，重试中…')
  } finally {
    busy = false
  }
}

function setSync(text) {
  const now = new Date()
  $('sync').textContent = `${text} · ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
}

function tick() {
  const now = new Date()
  $('clock').textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}`
  try {
    $('date').textContent = new Intl.DateTimeFormat('zh-CN', {
      month: 'long',
      day: 'numeric',
      weekday: 'long',
    }).format(now)
  } catch (_error) {
    $('date').textContent = now.toDateString()
  }
  renderIsland()
}

function applyMode(next) {
  const island = next === 'island'
  if (island) closeImageViewer()
  document.body.classList.toggle('mode-island', island)
  renderIsland()
  updateComposer()
}

function renderIsland() {
  const text = $('island-text')
  if (!text) return
  text.textContent = snapshot.latest || '快捷面板'
  $('island-dot').classList.toggle('on', Boolean(snapshot.running))
  $('island-time').textContent = `${pad(new Date().getHours())}:${pad(new Date().getMinutes())}`
}

function renderSessionLabel() {
  const element = $('session-label')
  if (!element) return
  const label = typeof snapshot.sessionLabel === 'string' ? snapshot.sessionLabel : ''
  element.textContent = label ? `对话 · ${label}` : ''
  element.hidden = !label
}

function showDoneToast(text) {
  const toast = $('done-toast')
  if (!toast) return
  toast.textContent = text
  toast.hidden = false
  if (doneToastTimer) clearTimeout(doneToastTimer)
  doneToastTimer = setTimeout(() => {
    doneToastTimer = 0
    toast.hidden = true
  }, 8000)
}

function pingCompanion() {
  if (!TOKEN) return
  fetch(`${BASE}/action?token=${encodeURIComponent(TOKEN)}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-quick-panel-token': TOKEN,
    },
    body: JSON.stringify({ type: 'companion-ping' }),
  }).catch(() => {})
}

function wireWindowControls() {
  const desktop = window.quickPanelDesktop
  if (!desktop || typeof desktop.minimize !== 'function') return
  const actions = $('win-actions')
  actions.hidden = false
  const pin = actions.querySelector('[data-action="pin"]')
  const minimize = actions.querySelector('[data-action="minimize"]')
  const close = actions.querySelector('[data-action="close"]')
  if (pin) {
    pin.addEventListener('click', async () => {
      try {
        const next = await desktop.togglePin()
        pin.classList.toggle('active', Boolean(next))
      } catch (_error) {
        /* ignore */
      }
    })
    Promise.resolve(desktop.pinState()).then(
      (value) => pin.classList.toggle('active', Boolean(value)),
      () => {},
    )
  }
  if (minimize) {
    minimize.addEventListener('click', () => {
      void desktop.minimize()
    })
  }
  if (close) {
    close.addEventListener('click', () => {
      void desktop.close()
    })
  }
  if (typeof desktop.expand === 'function') {
    $('island-text').addEventListener('click', () => {
      void desktop.expand()
    })
    $('island-expand').addEventListener('click', () => {
      void desktop.expand()
    })
    $('island-more').addEventListener('click', () => {
      void desktop.openMenu()
    })
  }
  const grip = $('island-grip')
  if (grip && typeof desktop.dragStart === 'function') {
    grip.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return
      event.preventDefault()
      try {
        grip.setPointerCapture(event.pointerId)
      } catch (_error) {
        /* pointer capture is best effort */
      }
      void desktop.dragStart(event.screenX, event.screenY)
      const onMove = (moveEvent) => {
        void desktop.dragMove(moveEvent.screenX, moveEvent.screenY)
      }
      const onEnd = () => {
        grip.removeEventListener('pointermove', onMove)
        grip.removeEventListener('pointerup', onEnd)
        grip.removeEventListener('pointercancel', onEnd)
        void desktop.dragEnd()
      }
      grip.addEventListener('pointermove', onMove)
      grip.addEventListener('pointerup', onEnd)
      grip.addEventListener('pointercancel', onEnd)
    })
  }
  if (typeof desktop.getMode === 'function') {
    const syncMode = () => {
      Promise.resolve(desktop.getMode()).then(
        (value) => applyMode(value),
        () => {},
      )
    }
    syncMode()
    setInterval(syncMode, 3000)
  }
  if (typeof desktop.onMode === 'function') {
    desktop.onMode((value) => applyMode(value))
  }
}

function wireTodos() {
  const input = $('todo-input')
  const add = $('todo-add')
  add.addEventListener('click', () => {
    void addTodo()
  })
  input.addEventListener('input', () => {
    input.style.height = 'auto'
    input.style.height = `${Math.min(input.scrollHeight, 82)}px`
  })
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.shiftKey) return
    event.preventDefault()
    void addTodo()
  })
}

let dueQueue = []
const firingIds = new Set()
let audioContext = null

function defaultWhenParts(timestamp) {
  const date = new Date(timestamp)
  return {
    date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    hour: pad(date.getHours()),
    minute: pad(date.getMinutes()),
  }
}

function computeAt(repeat, dateValue, hourValue, minuteValue, now) {
  const hours = Number(hourValue)
  const minutes = Number(minuteValue)
  if (!Number.isInteger(hours) || hours < 0 || hours > 23) return null
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > 59) return null
  if (repeat === 'none') {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateValue || ''))
    if (!match) return null
    const at = new Date(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      hours,
      minutes,
      0,
      0,
    ).getTime()
    if (!Number.isFinite(at) || at <= now) return null
    return at
  }
  const date = new Date(now)
  date.setHours(hours, minutes, 0, 0)
  if (date.getTime() <= now) date.setDate(date.getDate() + 1)
  if (repeat === 'weekdays') {
    while (date.getDay() === 0 || date.getDay() === 6) date.setDate(date.getDate() + 1)
  }
  return date.getTime()
}

function nextOccurrence(item, now) {
  if (item.repeat === 'none') return null
  const previous = new Date(item.at)
  const spec = item.timeOfDay || `${pad(previous.getHours())}:${pad(previous.getMinutes())}`
  const match = /^(\d{2}):(\d{2})$/.exec(spec)
  const hours = match ? Number(match[1]) : previous.getHours()
  const minutes = match ? Number(match[2]) : previous.getMinutes()
  const next = new Date(now)
  next.setHours(hours, minutes, 0, 0)
  if (next.getTime() <= now) next.setDate(next.getDate() + 1)
  if (item.repeat === 'weekdays') {
    while (next.getDay() === 0 || next.getDay() === 6) next.setDate(next.getDate() + 1)
  }
  return next.getTime()
}

function fillComposer(text) {
  const input = $('quick-input')
  if (!input) return
  input.value = text
  input.style.height = 'auto'
  input.style.height = `${Math.min(input.scrollHeight, 70)}px`
  updateComposer()
  input.focus()
}

function ensureAudio() {
  try {
    const Ctor = window.AudioContext || window.webkitAudioContext
    if (!Ctor) return null
    if (!audioContext) audioContext = new Ctor()
    if (audioContext.state === 'suspended') {
      const resumed = audioContext.resume()
      if (resumed && typeof resumed.catch === 'function') resumed.catch(() => {})
    }
    return audioContext
  } catch (_error) {
    return null
  }
}

async function playChime(kind) {
  const context = ensureAudio()
  if (!context) return
  try {
    if (context.state === 'suspended') await context.resume()
  } catch (_error) {
    return
  }
  const notes = kind === 'reminder' ? [880, 1108.73, 1318.51] : [659.25, 880]
  const start = context.currentTime + 0.02
  notes.forEach((frequency, index) => {
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    oscillator.type = 'sine'
    oscillator.frequency.value = frequency
    const at = start + index * 0.14
    gain.gain.setValueAtTime(0.0001, at)
    gain.gain.exponentialRampToValueAtTime(0.22, at + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.8)
    oscillator.connect(gain)
    gain.connect(context.destination)
    oscillator.start(at)
    oscillator.stop(at + 0.85)
  })
}

function notifyReminder(item) {
  try {
    if (typeof Notification === 'undefined') return
    if (Notification.permission === 'default') {
      const pending = Notification.requestPermission()
      if (pending && typeof pending.catch === 'function') pending.catch(() => {})
    }
    if (Notification.permission !== 'granted') return
    const notice = new Notification('提醒', { body: item.text, silent: true })
    notice.onclick = () => {
      const desktop = window.quickPanelDesktop
      if (desktop && typeof desktop.expand === 'function') void desktop.expand()
      notice.close()
    }
  } catch (_error) {
    /* notifications are optional */
  }
}

function setupWheel(container, count, getValue, setValue) {
  const prev = container.querySelector('.wheel-step.prev')
  const current = container.querySelector('.wheel-current')
  const next = container.querySelector('.wheel-step.next')
  const format = (value) => String(((value % count) + count) % count).padStart(2, '0')
  const render = () => {
    const index = Number(getValue()) || 0
    prev.textContent = format(index - 1)
    current.textContent = format(index)
    next.textContent = format(index + 1)
  }
  const step = (delta) => {
    const index = (Number(getValue()) + delta + count) % count
    setValue(format(index))
    render()
    current.classList.remove('animate')
    void current.offsetWidth
    current.classList.add('animate')
  }
  prev.addEventListener('click', () => step(-1))
  next.addEventListener('click', () => step(1))
  container.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault()
      step(event.deltaY > 0 ? 1 : -1)
    },
    { passive: false },
  )
  container.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      step(-1)
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      step(1)
    }
  })
  render()
  return { render }
}

function wireReminders() {
  const form = $('reminder-form')
  const addButton = $('reminder-add')
  const cancelButton = $('reminder-cancel')
  const testButton = $('reminder-test')
  const textInput = $('reminder-text')
  const dateInput = $('reminder-date')
  const repeatInput = $('reminder-repeat')
  const error = $('reminder-error')
  const initial = defaultWhenParts(Date.now() + 10 * 60000)
  let dateValue = initial.date
  let hourValue = initial.hour
  let minuteValue = initial.minute
  const hourWheel = setupWheel($('hour-wheel'), 24, () => hourValue, (value) => {
    hourValue = value
  })
  const minuteWheel = setupWheel($('minute-wheel'), 60, () => minuteValue, (value) => {
    minuteValue = value
  })

  const reset = () => {
    const parts = defaultWhenParts(Date.now() + 10 * 60000)
    dateValue = parts.date
    hourValue = parts.hour
    minuteValue = parts.minute
    textInput.value = ''
    repeatInput.value = 'none'
    dateInput.value = dateValue
    dateInput.hidden = false
    error.hidden = true
    hourWheel.render()
    minuteWheel.render()
  }

  const showForm = () => {
    reset()
    form.hidden = false
    textInput.focus()
  }

  addButton.addEventListener('click', () => {
    if (form.hidden) showForm()
    else form.hidden = true
  })
  cancelButton.addEventListener('click', () => {
    form.hidden = true
  })
  testButton.addEventListener('click', () => {
    void playChime('reminder')
  })
  dateInput.addEventListener('input', () => {
    dateValue = dateInput.value
  })
  repeatInput.addEventListener('change', () => {
    dateInput.hidden = repeatInput.value !== 'none'
  })
  textInput.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.shiftKey) return
    if (event.nativeEvent && event.nativeEvent.isComposing) return
    event.preventDefault()
    if (typeof form.requestSubmit === 'function') form.requestSubmit()
  })
  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    const at = computeAt(repeatInput.value, dateValue, hourValue, minuteValue, Date.now())
    if (at === null) {
      error.textContent = repeatInput.value === 'none' ? '请选择将来的日期和时间' : '时间无效'
      error.hidden = false
      return
    }
    error.hidden = true
    const reminder = {
      id: crypto.randomUUID(),
      text: textInput.value.trim() || '提醒',
      at,
      repeat: repeatInput.value,
      timeOfDay: repeatInput.value === 'none' ? null : `${hourValue}:${minuteValue}`,
      dshTask: false,
      firedFor: null,
      createdAt: Date.now(),
    }
    try {
      await post({ reminders: [...snapshot.reminders, reminder] })
      form.hidden = true
      await refresh(true)
      setSync('提醒已保存')
    } catch (_error) {
      setSync('保存失败，稍后重试')
    }
  })
  document.addEventListener('pointerdown', () => ensureAudio(), { once: true })
}

function renderDue() {
  const banner = $('due-banner')
  const due = dueQueue[0]
  if (!due) {
    banner.hidden = true
    return
  }
  banner.hidden = false
  $('due-text').textContent = due.text
}

function checkDue() {
  const reminders = Array.isArray(snapshot.reminders) ? snapshot.reminders : []
  const now = Date.now()
  const due = reminders.filter(
    (item) => item.at <= now && item.firedFor !== item.at && !firingIds.has(item.id),
  )
  if (!due.length) return
  const updated = reminders.map((item) =>
    due.some((entry) => entry.id === item.id) ? { ...item, firedFor: item.at } : item,
  )
  for (const item of due) firingIds.add(item.id)
  snapshot = { ...snapshot, reminders: updated }
  post({ reminders: updated }).then(
    () => {
      for (const item of due) firingIds.delete(item.id)
      void refresh(false)
    },
    () => {
      for (const item of due) firingIds.delete(item.id)
    },
  )
  dueQueue.push(...due)
  void playChime('reminder')
  for (const item of due.slice(0, 3)) notifyReminder(item)
  if (document.body.classList.contains('mode-island')) {
    const desktop = window.quickPanelDesktop
    if (desktop && typeof desktop.expand === 'function') void desktop.expand()
  }
  renderDue()
}

function completeDue(action) {
  const due = dueQueue.shift()
  if (!due) return
  const reminders = snapshot.reminders
    .map((item) => {
      if (item.id !== due.id) return item
      if (action === 'snooze') {
        return { ...item, at: Date.now() + 10 * 60000, firedFor: null }
      }
      const next = nextOccurrence(item, Date.now())
      return next === null ? null : { ...item, at: next, firedFor: null }
    })
    .filter(Boolean)
  snapshot = { ...snapshot, reminders }
  post({ reminders }).then(
    () => refresh(false),
    () => {},
  )
  renderDue()
}

function wireDue() {
  $('due-snooze').addEventListener('click', () => completeDue('snooze'))
  $('due-done').addEventListener('click', () => completeDue('done'))
}

function wireDropGuard() {
  window.addEventListener('dragover', (event) => {
    event.preventDefault()
  })
  window.addEventListener('drop', (event) => {
    event.preventDefault()
    setSync('独立窗暂不支持拖入图片，请在 DSH 面板发送')
  })
}

function boot() {
  tick()
  wireDropGuard()
  wireTodos()
  wireReminders()
  wireDue()
  wireComposer()
  wireFeed()
  wireApproval()
  wireQuestion()
  wireImageViewer()
  wireWindowControls()
  setInterval(tick, 1000)
  if (!TOKEN) {
    setSync('缺少 token，请从 DSH 面板打开')
    return
  }
  void refresh(true)
  pingCompanion()
  setInterval(pingCompanion, 5000)
  setInterval(checkDue, 1000)
  setInterval(() => {
    void refresh(false)
  }, 1000)
  window.addEventListener('focus', () => {
    void refresh(false)
  })
}

boot()
