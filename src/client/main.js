import { React, h, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from './runtime.js'
import { NS, MODE_KEY, POS_KEY, TODO_KEY, REMINDER_KEY, HOST_ROUTE, MODES, DSH_TASKS_ENABLED } from './constants.js'
import { zh, en } from './locales.js'
import { CSS } from './styles.js'
import { IconPanel, IconGrip, IconWindow, IconChevronDown, IconChevronRight, IconCheck, IconBell, IconPlus, IconCopy, IconTrash, IconSend, IconStop } from './icons.js'
import { useNow, useViewport, clockOf } from './hooks.js'
import { formatDuration, contentText, latestText, hostLiveBlocks, userImageRefs, hostLiveRow, hostLivePartial, codeSegments, timeLabel, buildHandoff } from './text.js'
import { ensureNotifyPermission, maybeEnsureNotifyPermission, ensureAudio, playChime, showNotification } from './notify.js'

    const store = {
      state: Object.freeze({
        mode: readMode(),
        sessionId: null,
        bridgeReady: false,
        running: false,
        feed: [],
        partial: null,
        latest: '',
        loadingOlder: false,
        hasMore: false,
        canPrompt: false,
        canCancel: false,
        companionOpen: false,
        usage: null,
      }),
      inputActions: null,
      listeners: new Set(),
      subscribe: (listener) => {
        store.listeners.add(listener)
        return () => {
          store.listeners.delete(listener)
        }
      },
      getSnapshot: () => store.state,
      patch(next) {
        let changed = false
        for (const key of Object.keys(next)) {
          if (store.state[key] !== next[key]) changed = true
        }
        if (!changed) return
        store.state = Object.freeze({ ...store.state, ...next })
        for (const listener of Array.from(store.listeners)) listener()
      },
    }

    function readMode() {
      try {
        const raw = window.localStorage.getItem(MODE_KEY)
        if (!raw) return 'island'
        const parsed = JSON.parse(raw)
        if (parsed && parsed.mode === 'drawer') return 'panel'
        if (parsed && parsed.mode === 'hidden') return 'island'
        return parsed && MODES.includes(parsed.mode) ? parsed.mode : 'island'
      } catch (_error) {
        return 'island'
      }
    }

    function writeMode(mode) {
      try {
        window.localStorage.setItem(MODE_KEY, JSON.stringify({ mode }))
      } catch (_error) {
        /* localStorage can be unavailable; runtime state still works. */
      }
    }

    function setMode(mode) {
      if (!MODES.includes(mode)) return
      store.patch({ mode })
      writeMode(mode)
    }

    const openPanel = () => {
      maybeEnsureNotifyPermission()
      ensureAudio()
      setMode('panel')
    }
    const collapsePanel = () => setMode('island')

    function togglePanel() {
      ensureAudio()
      setMode(store.state.mode === 'panel' ? 'island' : 'panel')
    }

    function loadAnchor() {
      const fallback = { cx: window.innerWidth / 2, top: 8 }
      try {
        const raw = window.localStorage.getItem(POS_KEY)
        if (!raw) return fallback
        const parsed = JSON.parse(raw)
        if (Number.isFinite(parsed.cx) && Number.isFinite(parsed.top)) {
          return { cx: parsed.cx, top: parsed.top }
        }
      } catch (_error) {
        /* fall through to the default anchor */
      }
      return fallback
    }

    function saveAnchor(anchor) {
      try {
        window.localStorage.setItem(POS_KEY, JSON.stringify(anchor))
      } catch (_error) {
        /* position persistence is best effort */
      }
    }

    function clampRange(value, min, max) {
      if (max < min) return (min + max) / 2
      return Math.min(Math.max(value, min), max)
    }

    // ------------------------------------------------------------- todos

    function newId() {
      try {
        return window.crypto.randomUUID()
      } catch (_error) {
        return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
      }
    }

    function splitLines(raw) {
      return String(raw)
        .split(/\r?\n/)
        .map((line) =>
          line
            .replace(/^\s*(?:[-*+]\s+)?(?:\[[ xX]\]\s*)?(?:\d+[.)]\s+)?/, '')
            .trim(),
        )
        .filter(Boolean)
    }

    function loadTodos() {
      try {
        const raw = window.localStorage.getItem(TODO_KEY)
        if (!raw) return []
        const parsed = JSON.parse(raw)
        if (!Array.isArray(parsed)) return []
        return parsed
          .filter((item) => item && typeof item.text === 'string' && item.text.trim())
          .map((item, index) => ({
            id: typeof item.id === 'string' && item.id ? item.id : newId(),
            text: item.text.trim(),
            done: Boolean(item.done),
            handedOff: Boolean(item.handedOff),
            createdAt: Number.isFinite(item.createdAt) ? item.createdAt : Date.now() + index,
          }))
      } catch (_error) {
        return []
      }
    }

    const todoStore = {
      items: loadTodos(),
      listeners: new Set(),
      subscribe(listener) {
        todoStore.listeners.add(listener)
        return () => {
          todoStore.listeners.delete(listener)
        }
      },
      getSnapshot: () => todoStore.items,
      commit(items) {
        todoStore.items = items
        try {
          window.localStorage.setItem(TODO_KEY, JSON.stringify(items))
        } catch (_error) {
          /* persistence is best effort */
        }
        for (const listener of Array.from(todoStore.listeners)) listener()
        hostSync.schedule()
      },
      addMany(texts) {
        const lines = texts.map((text) => text.trim()).filter(Boolean)
        if (!lines.length) return
        const now = Date.now()
        const fresh = lines.map((text, index) => ({
          id: newId(),
          text,
          done: false,
          handedOff: false,
          createdAt: now + index,
        }))
        todoStore.commit([...fresh, ...todoStore.items])
      },
      update(id, patch) {
        todoStore.commit(todoStore.items.map((item) => (item.id === id ? { ...item, ...patch } : item)))
      },
      remove(id) {
        todoStore.commit(todoStore.items.filter((item) => item.id !== id))
      },
    }

    // ----------------------------------------------------------- reminders

    function pad2(value) {
      return String(value).padStart(2, '0')
    }

    function defaultWhenParts(timestamp) {
      const date = new Date(timestamp)
      return {
        date: `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`,
        hour: pad2(date.getHours()),
        minute: pad2(date.getMinutes()),
      }
    }

    function formatWhen(t, at, now) {
      const date = new Date(at)
      const current = new Date(now)
      const time = `${pad2(date.getHours())}:${pad2(date.getMinutes())}`
      if (date.toDateString() === current.toDateString()) return `${t('today')} ${time}`
      const tomorrow = new Date(current)
      tomorrow.setDate(current.getDate() + 1)
      if (date.toDateString() === tomorrow.toDateString()) return `${t('tomorrow')} ${time}`
      return `${date.getMonth() + 1}-${date.getDate()} ${time}`
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
      const spec = item.timeOfDay || `${pad2(previous.getHours())}:${pad2(previous.getMinutes())}`
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

    function loadReminders() {
      try {
        const raw = window.localStorage.getItem(REMINDER_KEY)
        if (!raw) return []
        const parsed = JSON.parse(raw)
        if (!Array.isArray(parsed)) return []
        return parsed
          .filter((item) => item && typeof item.text === 'string' && Number.isFinite(item.at))
          .map((item, index) => ({
            id: typeof item.id === 'string' && item.id ? item.id : newId(),
            text: item.text.trim(),
            at: item.at,
            repeat: ['none', 'daily', 'weekdays'].includes(item.repeat) ? item.repeat : 'none',
            timeOfDay: typeof item.timeOfDay === 'string' ? item.timeOfDay : null,
            dshTask: Boolean(item.dshTask),
            firedFor: Number.isFinite(item.firedFor) ? item.firedFor : null,
            createdAt: Number.isFinite(item.createdAt) ? item.createdAt : Date.now() + index,
          }))
      } catch (_error) {
        return []
      }
    }

    const reminderStore = {
      items: loadReminders(),
      listeners: new Set(),
      subscribe(listener) {
        reminderStore.listeners.add(listener)
        return () => {
          reminderStore.listeners.delete(listener)
        }
      },
      getSnapshot: () => reminderStore.items,
      commit(items) {
        reminderStore.items = items
        try {
          window.localStorage.setItem(REMINDER_KEY, JSON.stringify(items))
        } catch (_error) {
          /* persistence is best effort */
        }
        for (const listener of Array.from(reminderStore.listeners)) listener()
        hostSync.schedule()
      },
      add(entry) {
        const item = {
          id: newId(),
          text: entry.text,
          at: entry.at,
          repeat: entry.repeat,
          timeOfDay: entry.timeOfDay || null,
          dshTask: Boolean(entry.dshTask),
          firedFor: null,
          createdAt: Date.now(),
        }
        reminderStore.commit([...reminderStore.items, item])
        return item.id
      },
      update(id, patch) {
        reminderStore.commit(
          reminderStore.items.map((item) => (item.id === id ? { ...item, ...patch } : item)),
        )
      },
      remove(id) {
        reminderStore.commit(reminderStore.items.filter((item) => item.id !== id))
      },
      snooze(id, minutes) {
        reminderStore.commit(
          reminderStore.items.map((item) =>
            item.id === id ? { ...item, at: Date.now() + minutes * 60000, firedFor: null } : item,
          ),
        )
      },
      complete(id) {
        const item = reminderStore.items.find((entry) => entry.id === id)
        if (!item) return
        const next = nextOccurrence(item, Date.now())
        if (next === null) {
          reminderStore.remove(id)
          return
        }
        reminderStore.commit(
          reminderStore.items.map((entry) =>
            entry.id === id ? { ...entry, at: next, firedFor: null } : entry,
          ),
        )
      },
      takeDue(now) {
        const due = reminderStore.items.filter((item) => item.at <= now && item.firedFor !== item.at)
        if (!due.length) return []
        reminderStore.commit(
          reminderStore.items.map((item) =>
            due.some((entry) => entry.id === item.id) ? { ...item, firedFor: item.at } : item,
          ),
        )
        return due
      },
    }

    // --------------------------------------------------------------- host sync

    const hostSync = {
      ctx: null,
      uiSession: null,
      token: null,
      rev: -1,
      ready: false,
      applying: false,
      syncTimer: 0,
      pollTimer: 0,
      sessionTimer: 0,
      liveTimer: 0,
      liveInFlight: false,
      liveSignature: '',
      unsubscribeLive: null,
      unsubscribeQuestions: null,
      focusHandler: null,
      visibilityHandler: null,
      lastQuestionAnswerId: '',

      async init() {
        try {
          const injected = window.__QUICK_PANEL_CONFIG__
          if (injected && typeof injected.token === 'string' && injected.token) {
            this.token = injected.token
          } else {
            const configResponse = await fetch(`${HOST_ROUTE}/config`, {
              credentials: 'same-origin',
              cache: 'no-store',
            })
            if (!configResponse.ok) return
            const config = await configResponse.json()
            if (!config || !config.token) return
            this.token = config.token
          }
          const state = await this.readState()
          if (!state) return
          const hostTodos = Array.isArray(state.todos) ? state.todos : []
          const hostReminders = Array.isArray(state.reminders) ? state.reminders : []
          const hasHostData = hostTodos.length > 0 || hostReminders.length > 0
          const hasLocalData = todoStore.items.length > 0 || reminderStore.items.length > 0
          this.applying = true
          if (hasHostData || !hasLocalData) {
            todoStore.commit(hostTodos)
            reminderStore.commit(hostReminders)
          }
          this.applying = false
          this.rev = Number.isFinite(state.rev) ? state.rev : 0
          this.ready = true
          store.patch({ companionOpen: Boolean(state.companionOpen) })
          if (!hasHostData && hasLocalData) await this.push()
          this.setSession(store.state.sessionId)
          this.unsubscribeLive = store.subscribe(() => this.scheduleLive())
          this.bindQuestions()
          this.scheduleLive(true)
          this.focusHandler = () => this.scheduleLive(true)
          this.visibilityHandler = () => this.scheduleLive(true)
          window.addEventListener('focus', this.focusHandler)
          window.addEventListener('blur', this.focusHandler)
          document.addEventListener('visibilitychange', this.visibilityHandler)
          this.pollTimer = window.setInterval(() => this.poll(), 2500)
        } catch (_error) {
          /* the Host bridge is optional; localStorage remains the fallback */
        }
      },

      async readState() {
        if (!this.token) return null
        try {
          const response = await fetch(
            `${HOST_ROUTE}/state?token=${encodeURIComponent(this.token)}`,
            { cache: 'no-store' },
          )
          if (!response.ok) return null
          return await response.json()
        } catch (_error) {
          return null
        }
      },

      schedule() {
        if (!this.ready || this.applying) return
        if (this.syncTimer) window.clearTimeout(this.syncTimer)
        this.syncTimer = window.setTimeout(() => {
          this.syncTimer = 0
          void this.push()
        }, 350)
      },

      async push() {
        if (!this.ready || !this.token || this.applying) return
        try {
          const response = await fetch(
            `${HOST_ROUTE}/action?token=${encodeURIComponent(this.token)}`,
            {
              method: 'POST',
              headers: {
                'content-type': 'application/json',
                'x-quick-panel-token': this.token,
              },
              body: JSON.stringify({
                todos: todoStore.items,
                reminders: reminderStore.items,
              }),
            },
          )
          if (!response.ok) return
          const result = await response.json()
          if (result && result.ok && Number.isFinite(result.rev)) this.rev = result.rev
        } catch (_error) {
          /* retry on the next change */
        }
      },

      scheduleLive(immediate) {
        if (!this.ready) return
        if (immediate) {
          void this.pushLive()
          return
        }
        if (this.liveTimer) window.clearTimeout(this.liveTimer)
        this.liveTimer = window.setTimeout(() => {
          this.liveTimer = 0
          void this.pushLive()
        }, 300)
      },

      bindQuestions() {
        const uiSession = this.uiSession
        if (!uiSession || !uiSession.sessionStatus) return
        if (typeof uiSession.sessionStatus.subscribe !== 'function') return
        if (this.unsubscribeQuestions) return
        this.unsubscribeQuestions = uiSession.sessionStatus.subscribe(() => this.scheduleLive())
        if (this.ready) this.scheduleLive(true)
      },

      questionDebug() {
        try {
          const uiSession = this.uiSession
          const sessionId = store.state.sessionId
          const status =
            uiSession && uiSession.sessionStatus
              ? uiSession.sessionStatus.getSnapshot().get(sessionId)
              : null
          return {
            hasUiSession: Boolean(uiSession),
            sessionId: sessionId || null,
            hasStatus: Boolean(status),
            pendingKind: status && status.pendingInteraction
              ? String(status.pendingInteraction.kind || '')
              : '',
          }
        } catch (error) {
          return { error: String((error && error.message) || error) }
        }
      },

      readQuestion() {
        try {
          const uiSession = this.uiSession
          const sessionId = store.state.sessionId
          const status = uiSession && uiSession.sessionStatus
            ? uiSession.sessionStatus.getSnapshot().get(sessionId)
            : null
          const pending = status && status.pendingInteraction
          if (!pending || !Array.isArray(pending.questions)) return null
          if (pending.kind !== 'question' && pending.kind !== 'plan-review') return null
          const state = typeof pending.snapshot === 'function' ? pending.snapshot() : {}
          return {
            key: String(pending.key || ''),
            sessionId,
            kind: pending.kind,
            callId: pending.callId ? String(pending.callId) : '',
            state: state.state === 'continued' ? 'continued' : 'open',
            waitState: state.waitState ? String(state.waitState) : '',
            countdown: state.countdown
              ? {
                  remainingMs: Number.isFinite(state.countdown.remainingMs)
                    ? state.countdown.remainingMs
                    : 0,
                  running: state.countdown.running === true,
                }
              : null,
            questions: pending.questions.map((question) => ({
              id: String(question.id || ''),
              question: String(question.question || ''),
              ...(question.header ? { header: String(question.header) } : {}),
              ...(question.detail ? { detail: String(question.detail) } : {}),
              ...(Array.isArray(question.options)
                ? {
                    options: question.options.map((option) => ({
                      label: String(option.label || ''),
                      ...(option.description
                        ? { description: String(option.description) }
                        : {}),
                    })),
                  }
                : {}),
              ...(question.multiSelect === true ? { multiSelect: true } : {}),
            })),
          }
        } catch (_error) {
          return null
        }
      },

      async handleQuestionAnswer(request) {
        if (!request || typeof request !== 'object' || !request.id) return
        if (request.id === this.lastQuestionAnswerId) return
        this.lastQuestionAnswerId = request.id
        try {
          const uiSession = this.uiSession
          const sessionId = store.state.sessionId
          const status = uiSession && uiSession.sessionStatus
            ? uiSession.sessionStatus.getSnapshot().get(sessionId)
            : null
          const pending = status && status.pendingInteraction
          if (
            pending &&
            pending.key === request.key &&
            typeof pending.answer === 'function' &&
            Array.isArray(request.answers)
          ) {
            await pending.answer({ answers: request.answers })
          }
        } catch (_error) {
          /* leave the panel card visible; the user can retry */
        }
        try {
          await fetch(
            `${HOST_ROUTE}/action?token=${encodeURIComponent(this.token)}`,
            {
              method: 'POST',
              headers: {
                'content-type': 'application/json',
                'x-quick-panel-token': this.token,
              },
              body: JSON.stringify({
                type: 'question-answer-ack',
                key: request.key,
              }),
            },
          )
        } catch (_error) {
          /* the next poll retries the ack */
        }
      },

      async pushLive() {
        if (!this.ready || !this.token) return
        // The Host live mirror only serves the companion; skip it while closed.
        if (!store.state.companionOpen) return
        if (this.liveInFlight) {
          this.scheduleLive(false)
          return
        }
        const payload = {
          feed: (store.state.feed || []).slice(-24).map(hostLiveRow).filter(Boolean),
          // Register refs for the whole loaded history so the DSH panel can
          // preview images outside the 24-row companion mirror.
          imageRefs: (store.state.feed || [])
            .flatMap((node) => userImageRefs(node))
            .slice(-200),
          partial: hostLivePartial(store.state.partial),
          running: Boolean(store.state.running),
          latest: String(store.state.latest || '').slice(0, 600),
          usage: store.state.usage || null,
          question: this.readQuestion(),
          questionDebug: this.questionDebug(),
          dshFocused: document.hasFocus(),
          dshVisible: document.visibilityState === 'visible',
        }
        const signature = JSON.stringify(payload)
        if (signature === this.liveSignature) return
        this.liveInFlight = true
        try {
          const response = await fetch(
            `${HOST_ROUTE}/action?token=${encodeURIComponent(this.token)}`,
            {
              method: 'POST',
              headers: {
                'content-type': 'application/json',
                'x-quick-panel-token': this.token,
              },
              body: JSON.stringify(payload),
            },
          )
          if (!response.ok) return
          const result = await response.json()
          if (result && result.ok) {
            this.liveSignature = signature
            if (Number.isFinite(result.rev)) this.rev = result.rev
          }
        } catch (_error) {
          /* the next store change retries */
        } finally {
          this.liveInFlight = false
        }
      },

      async poll() {
        if (!this.ready || this.applying) return
        const state = await this.readState()
        if (!state) return
        if (typeof state.companionOpen === 'boolean') {
          const wasOpen = store.state.companionOpen
          store.patch({ companionOpen: state.companionOpen })
          if (state.companionOpen && !wasOpen) this.scheduleLive(true)
        }
        await this.handleQuestionAnswer(state.questionAnswer)
        const rev = Number.isFinite(state.rev) ? state.rev : 0
        if (rev === this.rev) return
        this.applying = true
        try {
          todoStore.commit(Array.isArray(state.todos) ? state.todos : [])
          reminderStore.commit(Array.isArray(state.reminders) ? state.reminders : [])
          this.rev = rev
        } finally {
          this.applying = false
        }
      },

      setSession(sessionId) {
        if (!this.ready || !this.token) return
        if (this.sessionTimer) window.clearTimeout(this.sessionTimer)
        this.sessionTimer = window.setTimeout(() => {
          this.sessionTimer = 0
          fetch(`${HOST_ROUTE}/action?token=${encodeURIComponent(this.token)}`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-quick-panel-token': this.token,
            },
            body: JSON.stringify({ activeSessionId: sessionId || null }),
          }).catch(() => {})
        }, 200)
      },

      async openWindow() {
        if (!this.token) return { ok: false, error: 'host-unavailable' }
        try {
          const response = await fetch(
            `${HOST_ROUTE}/action?token=${encodeURIComponent(this.token)}`,
            {
              method: 'POST',
              headers: {
                'content-type': 'application/json',
                'x-quick-panel-token': this.token,
              },
              body: JSON.stringify({ type: 'open-window' }),
            },
          )
          if (!response.ok) return { ok: false, error: 'request-failed' }
          const result = await response.json()
          if (result && result.ok) store.patch({ companionOpen: true })
          return result
        } catch (error) {
          return { ok: false, error: String((error && error.message) || error) }
        }
      },

      dispose() {
        if (this.syncTimer) window.clearTimeout(this.syncTimer)
        if (this.pollTimer) window.clearInterval(this.pollTimer)
        if (this.sessionTimer) window.clearTimeout(this.sessionTimer)
        if (this.liveTimer) window.clearTimeout(this.liveTimer)
        if (this.unsubscribeLive) this.unsubscribeLive()
        if (this.unsubscribeQuestions) this.unsubscribeQuestions()
        if (this.focusHandler) {
          window.removeEventListener('focus', this.focusHandler)
          window.removeEventListener('blur', this.focusHandler)
          this.focusHandler = null
        }
        if (this.visibilityHandler) {
          document.removeEventListener('visibilitychange', this.visibilityHandler)
          this.visibilityHandler = null
        }
        this.syncTimer = 0
        this.pollTimer = 0
        this.sessionTimer = 0
        this.liveTimer = 0
        this.unsubscribeLive = null
        this.unsubscribeQuestions = null
        this.ready = false
      },
    }

    function Overlay({ t, schedule, openSchedule, loadOlder, sendPrompt, stopTurn }) {
      const state = useSyncExternalStore(store.subscribe, store.getSnapshot)
      const now = useNow(1000)
      const viewport = useViewport()
      const [anchor, setAnchorState] = useState(loadAnchor)
      const anchorRef = useRef(anchor)
      const suppressClick = useRef(false)
      const [dueQueue, setDueQueue] = useState([])
      const due = dueQueue[0] || null
      const lastRunning = useRef(false)
      const runStarted = useRef(0)
      const lastSession = useRef(state.sessionId)

      const panelWidth = Math.min(380, Math.max(280, viewport.w - 16))
      const half = panelWidth / 2 + 8
      const clampAnchor = (next) => ({
        cx: clampRange(next.cx, half, viewport.w - half),
        top: clampRange(next.top, 8, viewport.h - 72),
      })
      const setAnchor = (next) => {
        const clamped = clampAnchor(next)
        anchorRef.current = clamped
        setAnchorState(clamped)
      }
      const safeAnchor = clampAnchor(anchor)

      useEffect(() => {
        anchorRef.current = safeAnchor
        setAnchorState(safeAnchor)
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [viewport.w, viewport.h])

      useEffect(() => {
        const onKeyDown = (event) => {
          if (!(event.ctrlKey || event.metaKey) || !event.shiftKey) return
          if (event.key !== 'L' && event.key !== 'l') return
          event.preventDefault()
          togglePanel()
        }
        window.addEventListener('keydown', onKeyDown)
        return () => window.removeEventListener('keydown', onKeyDown)
      }, [])

      const companionRef = useRef(false)
      useEffect(() => {
        companionRef.current = Boolean(state.companionOpen)
      }, [state.companionOpen])

      useEffect(() => {
        const check = () => {
          if (companionRef.current) return
          const items = reminderStore.takeDue(Date.now())
          if (!items.length) return
          playChime('reminder')
          items.slice(0, 3).forEach((item) => {
            showNotification(t('notifyReminderTitle'), item.text, `qp-reminder-${item.id}`)
          })
          setDueQueue((queue) => [...queue, ...items])
        }
        check()
        const timer = window.setInterval(check, 1000)
        return () => window.clearInterval(timer)
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [])

      const running = Boolean(state.running)
      useEffect(() => {
        if (lastSession.current !== state.sessionId) {
          lastSession.current = state.sessionId
          lastRunning.current = running
          runStarted.current = running ? Date.now() : 0
          return
        }
        if (running && !lastRunning.current) runStarted.current = Date.now()
        if (!running && lastRunning.current) {
          const elapsed = runStarted.current ? Date.now() - runStarted.current : 0
          if (elapsed >= 2000 && !companionRef.current) {
            playChime('done')
            if (!document.hasFocus()) {
              showNotification(
                t('turnDone'),
                String(t('turnDoneBody')).replace('{time}', formatDuration(elapsed)),
                'qp-turn-done',
              )
            }
          }
        }
        lastRunning.current = running
      }, [running, state.sessionId])

      const snoozeDue = () => {
        if (!due) return
        reminderStore.snooze(due.id, 10)
        setDueQueue((queue) => queue.slice(1))
      }

      const completeDue = () => {
        if (!due) return
        reminderStore.complete(due.id)
        setDueQueue((queue) => queue.slice(1))
      }

      const beginDrag = (event, kind) => {
        if (event.button !== 0) return
        if (
          kind === 'panel' &&
          event.target &&
          event.target.closest &&
          event.target.closest('button, a, input, textarea, select, [data-qp-no-drag]')
        ) {
          return
        }
        if (kind === 'panel') event.preventDefault()

        const start = {
          x: event.clientX,
          y: event.clientY,
          cx: anchorRef.current.cx,
          top: anchorRef.current.top,
        }
        let moved = false

        const onMove = (moveEvent) => {
          const dx = moveEvent.clientX - start.x
          const dy = moveEvent.clientY - start.y
          if (!moved && Math.hypot(dx, dy) < 4) return
          moved = true
          setAnchor({ cx: start.cx + dx, top: start.top + dy })
        }

        const onUp = () => {
          window.removeEventListener('pointermove', onMove)
          window.removeEventListener('pointerup', onUp)
          window.removeEventListener('pointercancel', onUp)
          window.removeEventListener('blur', onUp)
          if (!moved) return
          saveAnchor(anchorRef.current)
          if (kind === 'island') {
            suppressClick.current = true
            window.setTimeout(() => {
              suppressClick.current = false
            }, 0)
          }
        }

        window.addEventListener('pointermove', onMove)
        window.addEventListener('pointerup', onUp)
        window.addEventListener('pointercancel', onUp)
        window.addEventListener('blur', onUp)
      }

      return h(
        React.Fragment,
        null,
        h('style', { key: 'qp-style' }, CSS),
        state.mode === 'panel'
          ? h(Panel, {
              t,
              now,
              state,
              anchor: safeAnchor,
              width: panelWidth,
              maxHeight: Math.max(300, viewport.h - safeAnchor.top - 12),
              onDragStart: beginDrag,
              due,
              onSnooze: snoozeDue,
              onComplete: completeDue,
              schedule,
              openSchedule,
              loadOlder,
              sendPrompt,
              stopTurn,
            })
          : state.mode === 'island'
            ? h(Island, {
                t,
                now,
                state,
                anchor: safeAnchor,
                due,
                onSnooze: snoozeDue,
                onComplete: completeDue,
                onDragStart: beginDrag,
                onClick: () => {
                  if (suppressClick.current) {
                    suppressClick.current = false
                    return
                  }
                  openPanel()
                },
              })
            : null,
      )
    }

    function Island({ t, now, state, anchor, due, onSnooze, onComplete, onDragStart, onClick }) {
      if (due) {
        return h(
          'div',
          { className: 'qp-island-anchor', style: { left: anchor.cx, top: anchor.top } },
          h(
            'div',
            {
              className: 'qp-due-card',
              role: 'button',
              tabIndex: 0,
              onClick,
              onKeyDown: (event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.preventDefault()
                onClick()
              },
            },
            h(
              'div',
              { className: 'qp-due-head' },
              h(IconBell, { size: 12 }),
              h('span', null, `${t('reminderDue')} · ${formatWhen(t, due.at, now)}`),
            ),
            h('div', { className: 'qp-due-text' }, due.text),
            h(
              'div',
              { className: 'qp-due-actions' },
              h(
                'button',
                {
                  type: 'button',
                  onClick: (event) => {
                    event.stopPropagation()
                    onSnooze()
                  },
                },
                t('snooze10'),
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'is-primary',
                  onClick: (event) => {
                    event.stopPropagation()
                    onComplete()
                  },
                },
                t('markReminderDone'),
              ),
            ),
          ),
        )
      }

      const clock = clockOf(now)
      const todos = useSyncExternalStore(todoStore.subscribe, todoStore.getSnapshot)
      const connected = Boolean(state.sessionId)
      const pending = todos.filter((todo) => !todo.done).length
      const latest = state.latest || ''
      const live = Boolean(state.running)
      const text =
        latest ||
        (pending > 0 ? `${pending} ${t('todos')}` : connected ? t('islandConnected') : t('islandIdle'))

      return h(
        'div',
        { className: 'qp-island-anchor', style: { left: anchor.cx, top: anchor.top } },
        h(
          'button',
          {
            type: 'button',
            className: 'qp-island',
            onPointerDown: (event) => onDragStart(event, 'island'),
            onClick,
            title: `${t('open')} · ${t('dragHint')}`,
            'aria-label': t('open'),
          },
          h('span', { className: live ? 'qp-dot is-live' : 'qp-dot' }),
          h('span', { className: 'qp-island-brand' }, t('panel')),
          h('span', { className: 'qp-island-sep' }),
          h('span', { className: 'qp-island-text' }, text),
          h('span', { className: 'qp-island-time' }, `${clock.hh}:${clock.mm}`),
          h(IconChevronRight, { size: 13 }),
        ),
      )
    }

    function Section({ title, action, children }) {
      return h(
        'section',
        { className: 'qp-section' },
        h('div', { className: 'qp-section-title' }, h('span', null, title), action || null),
        children,
      )
    }

    function Capture({ t, onAdd }) {
      const [value, setValue] = useState('')
      const inputRef = useRef(null)

      const commit = () => {
        const lines = splitLines(value)
        if (!lines.length) return
        onAdd(lines)
        setValue('')
        if (inputRef.current) inputRef.current.focus()
      }

      const onPaste = (event) => {
        const text = event.clipboardData ? event.clipboardData.getData('text') : ''
        if (!text || !/[\r\n]/.test(text)) return
        const lines = splitLines(text)
        if (lines.length < 2) return
        event.preventDefault()
        onAdd(lines)
      }

      return h(
        'div',
        { className: 'qp-capture' },
        h('textarea', {
          ref: inputRef,
          className: 'qp-capture-input',
          rows: Math.min(3, Math.max(1, value.split('\n').length)),
          value,
          placeholder: t('capturePlaceholder'),
          'aria-label': t('capturePlaceholder'),
          onChange: (event) => setValue(event.target.value),
          onKeyDown: (event) => {
            if (event.key !== 'Enter' || event.shiftKey) return
            if (event.nativeEvent && event.nativeEvent.isComposing) return
            event.preventDefault()
            commit()
          },
          onPaste,
        }),
        h(
          'button',
          {
            type: 'button',
            className: 'qp-add',
            onClick: commit,
            disabled: !value.trim(),
            title: t('add'),
            'aria-label': t('add'),
          },
          h(IconPlus, { size: 16 }),
        ),
      )
    }

    function TodoRow({ todo, index, t, onHandoff, onDone, onEdit, onDelete, onCopy }) {
      const [editing, setEditing] = useState(false)
      const [draft, setDraft] = useState(todo.text)
      const settled = useRef(false)
      const cancelled = useRef(false)

      useEffect(() => {
        if (!editing) setDraft(todo.text)
      }, [todo.text, editing])

      const begin = () => {
        settled.current = false
        cancelled.current = false
        setDraft(todo.text)
        setEditing(true)
      }

      const save = () => {
        if (settled.current) return
        settled.current = true
        const text = draft.trim()
        setEditing(false)
        if (!text) {
          setDraft(todo.text)
          return
        }
        if (text !== todo.text) onEdit(todo.id, text)
      }

      const cancel = () => {
        settled.current = true
        cancelled.current = true
        setDraft(todo.text)
        setEditing(false)
      }

      return h(
        'div',
        { className: `qp-todo${todo.done ? ' is-done' : ''}` },
        h('span', { className: 'qp-todo-index' }, `${index + 1}.`),
        h(
          'button',
          {
            type: 'button',
            role: 'checkbox',
            'aria-checked': todo.handedOff,
            className: `qp-todo-check${todo.handedOff ? ' is-on' : ''}`,
            onClick: () => onHandoff(todo),
            title: t('handoff'),
            'aria-label': t('handoff'),
          },
          todo.handedOff ? h(IconCheck, { size: 12 }) : null,
        ),
        editing
          ? h('input', {
              className: 'qp-edit-input',
              value: draft,
              autoFocus: true,
              onChange: (event) => setDraft(event.target.value),
              onBlur: () => {
                if (cancelled.current) {
                  cancelled.current = false
                  return
                }
                save()
              },
              onKeyDown: (event) => {
                if (event.key === 'Enter' && !(event.nativeEvent && event.nativeEvent.isComposing)) {
                  event.preventDefault()
                  save()
                } else if (event.key === 'Escape') {
                  event.stopPropagation()
                  cancel()
                }
              },
            })
          : h(
              'div',
              {
                className: 'qp-todo-main',
                onDoubleClick: begin,
                title: `${todo.text}\n${t('editHint')}`,
              },
              h('span', { className: 'qp-todo-text' }, todo.text),
              todo.handedOff ? h('span', { className: 'qp-tag' }, t('handed')) : null,
            ),
        h(
          'div',
          { className: 'qp-todo-actions' },
          h(
            'button',
            {
              type: 'button',
              className: 'qp-mini',
              onClick: () => onCopy(todo),
              title: t('copy'),
              'aria-label': t('copy'),
            },
            h(IconCopy, { size: 13 }),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'qp-mini',
              onClick: () => onDelete(todo),
              title: t('delete'),
              'aria-label': t('delete'),
            },
            h(IconTrash, { size: 13 }),
          ),
        ),
        h(
          'button',
          {
            type: 'button',
            className: `qp-done-dot${todo.done ? ' is-on' : ''}`,
            onClick: () => onDone(todo),
            title: todo.done ? t('markUndone') : t('markDone'),
            'aria-label': todo.done ? t('markUndone') : t('markDone'),
            'aria-pressed': todo.done,
          },
          todo.done ? h(IconCheck, { size: 11 }) : null,
        ),
      )
    }

    function Wheel({ value, count, onChange, label }) {
      const index = Math.min(count - 1, Math.max(0, Number(value) || 0))
      const format = (number) => String((number + count) % count).padStart(2, '0')
      const elementRef = useRef(null)
      const latest = useRef(index)
      latest.current = index

      useEffect(() => {
        const element = elementRef.current
        if (!element) return
        const onWheel = (event) => {
          event.preventDefault()
          const direction = event.deltaY > 0 ? 1 : -1
          onChange(format(latest.current + direction))
        }
        element.addEventListener('wheel', onWheel, { passive: false })
        return () => element.removeEventListener('wheel', onWheel)
      }, [onChange, count])

      const step = (direction) => onChange(format(index + direction))

      return h(
        'div',
        {
          ref: elementRef,
          className: 'qp-wheel',
          role: 'spinbutton',
          tabIndex: 0,
          'aria-label': label,
          'aria-valuemin': 0,
          'aria-valuemax': count - 1,
          'aria-valuenow': index,
          onKeyDown: (event) => {
            if (event.key === 'ArrowUp') {
              event.preventDefault()
              step(-1)
            } else if (event.key === 'ArrowDown') {
              event.preventDefault()
              step(1)
            }
          },
        },
        h(
          'button',
          {
            type: 'button',
            className: 'qp-wheel-step',
            tabIndex: -1,
            'aria-hidden': true,
            onClick: () => step(-1),
          },
          format(index - 1),
        ),
        h('div', { className: 'qp-wheel-current', key: value }, format(index)),
        h(
          'button',
          {
            type: 'button',
            className: 'qp-wheel-step',
            tabIndex: -1,
            'aria-hidden': true,
            onClick: () => step(1),
          },
          format(index + 1),
        ),
      )
    }

    function ReminderSection({ t, now, reminders, dueId, sessionId, schedule, openSchedule, onAdd, onRemove }) {
      const [open, setOpen] = useState(false)
      const [text, setText] = useState('')
      const [repeat, setRepeat] = useState('none')
      const [withDsh, setWithDsh] = useState(false)
      const [dateValue, setDateValue] = useState(() => defaultWhenParts(Date.now() + 10 * 60000).date)
      const [hourValue, setHourValue] = useState(() => defaultWhenParts(Date.now() + 10 * 60000).hour)
      const [minuteValue, setMinuteValue] = useState(() => defaultWhenParts(Date.now() + 10 * 60000).minute)
      const [error, setError] = useState(null)
      const scheduleApi = schedule ? schedule() : null
      const canDsh =
        DSH_TASKS_ENABLED && Boolean(sessionId && scheduleApi && typeof scheduleApi.create === 'function')

      const reset = () => {
        const parts = defaultWhenParts(Date.now() + 10 * 60000)
        setText('')
        setRepeat('none')
        setWithDsh(false)
        setDateValue(parts.date)
        setHourValue(parts.hour)
        setMinuteValue(parts.minute)
        setError(null)
      }

      const save = () => {
        const clean = text.trim()
        const at = computeAt(repeat, dateValue, hourValue, minuteValue, Date.now())
        if (at === null) {
          setError(t('invalidTime'))
          return
        }
        onAdd({
          text: clean || t('reminderDefault'),
          at,
          repeat,
          timeOfDay: repeat === 'none' ? null : `${hourValue}:${minuteValue}`,
          dshTask: Boolean(withDsh && canDsh),
        })
        maybeEnsureNotifyPermission()
        ensureAudio()
        reset()
        setOpen(false)
      }

      const sorted = [...reminders].sort((a, b) => a.at - b.at)

      return h(
        'section',
        { className: 'qp-section' },
        h(
          'div',
          { className: 'qp-section-title' },
          h('span', null, t('reminders')),
          h(
            'button',
            {
              type: 'button',
              className: 'qp-section-action',
              onClick: () => {
                setOpen((value) => !value)
                setError(null)
              },
              title: t('addReminder'),
              'aria-label': t('addReminder'),
              'aria-expanded': open,
            },
            open ? h(IconChevronDown, { size: 13 }) : h(IconPlus, { size: 13 }),
          ),
        ),
        open
          ? h(
              'div',
              { className: 'qp-reminder-form' },
              h('input', {
                type: 'text',
                className: 'qp-form-input',
                value: text,
                autoFocus: true,
                placeholder: t('reminderPlaceholder'),
                'aria-label': t('reminderPlaceholder'),
                onChange: (event) => setText(event.target.value),
                onKeyDown: (event) => {
                  if (event.key !== 'Enter' || (event.nativeEvent && event.nativeEvent.isComposing)) return
                  event.preventDefault()
                  save()
                },
              }),
              repeat === 'none'
                ? h('input', {
                    type: 'text',
                    className: 'qp-form-input qp-date-input',
                    value: dateValue,
                    placeholder: 'YYYY-MM-DD',
                    onChange: (event) => setDateValue(event.target.value),
                    'aria-label': t('when'),
                  })
                : null,
              h(
                'div',
                { className: 'qp-clockpick' },
                h(Wheel, { value: hourValue, count: 24, onChange: setHourValue, label: t('when') }),
                h('span', { className: 'qp-clockpick-colon' }, ':'),
                h(Wheel, { value: minuteValue, count: 60, onChange: setMinuteValue, label: t('when') }),
              ),
              error ? h('div', { className: 'qp-form-error' }, error) : null,
              canDsh
                ? h(
                    'label',
                    { className: 'qp-checkline' },
                    h('input', {
                      type: 'checkbox',
                      className: 'qp-checkline-box',
                      checked: withDsh,
                      onChange: (event) => setWithDsh(event.target.checked),
                    }),
                    h('span', null, t('alsoSchedule')),
                    h('span', { className: 'qp-checkline-hint' }, t('alsoScheduleHint')),
                  )
                : null,
              h(
                'div',
                { className: 'qp-form-row qp-bottom-row' },
                h('span', { className: 'qp-form-label' }, t('repeat')),
                h(
                  'select',
                  {
                    className: 'qp-form-select qp-repeat-select',
                    value: repeat,
                    onChange: (event) => setRepeat(event.target.value),
                    'aria-label': t('repeat'),
                  },
                  h('option', { value: 'none' }, t('repeatNone')),
                  h('option', { value: 'daily' }, t('repeatDaily')),
                  h('option', { value: 'weekdays' }, t('repeatWeekdays')),
                ),
                h(
                  'div',
                  { className: 'qp-action-group' },
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'qp-btn',
                      onClick: () => playChime('reminder'),
                    },
                    t('testSound'),
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'qp-btn',
                      onClick: () => {
                        setOpen(false)
                        reset()
                      },
                    },
                    t('cancel'),
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'qp-btn is-primary',
                      onClick: save,
                    },
                    t('save'),
                  ),
                ),
              ),
            )
          : null,
        sorted.length === 0
          ? open
            ? null
            : h('div', { className: 'qp-placeholder' }, t('noReminders'))
          : h(
              'div',
              { className: 'qp-reminder-list' },
              sorted.map((item, index) =>
                h(
                  'div',
                  {
                    key: item.id,
                    className: `qp-reminder${dueId === item.id ? ' is-due' : ''}${item.at <= now ? ' is-past' : ''}`,
                  },
                  h('span', { className: 'qp-reminder-index' }, `${index + 1}.`),
                  h('span', { className: 'qp-reminder-time' }, formatWhen(t, item.at, now)),
                  h('span', { className: 'qp-reminder-text', title: item.text }, item.text),
                  item.repeat !== 'none'
                    ? h(
                        'span',
                        { className: 'qp-tag' },
                        item.repeat === 'daily' ? t('repeatDaily') : t('repeatWeekdays'),
                      )
                    : null,
                  item.dshTask && DSH_TASKS_ENABLED
                    ? h(
                        'button',
                        {
                          type: 'button',
                          className: 'qp-tag is-link',
                          onClick: openSchedule,
                          title: t('openSchedule'),
                        },
                        t('dshTaskTag'),
                      )
                    : null,
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'qp-mini',
                      onClick: () => onRemove(item.id),
                      title: t('deleteReminder'),
                      'aria-label': t('deleteReminder'),
                    },
                    h(IconTrash, { size: 13 }),
                  ),
                ),
              ),
            ),
        scheduleApi && DSH_TASKS_ENABLED
          ? h(
              'button',
              { type: 'button', className: 'qp-link-btn', onClick: openSchedule },
              `${t('openSchedule')} ↗`,
            )
          : null,
      )
    }

    function AssistantBlockView({ block, t, streaming }) {
      if (!block) return null
      if (block.kind === 'reasoning') {
        return h(
          'div',
          { className: 'qp-reasoning' },
          h('div', { className: 'qp-reasoning-label' }, t('reasoning')),
          h('div', { className: 'qp-reasoning-text' }, block.text || ''),
        )
      }
      if (block.kind === 'tool-call') {
        return h(
          'div',
          { className: 'qp-tool-chip' },
          h('span', { className: 'qp-tool-dot' }),
          h('span', { className: 'qp-tool-name' }, block.name || t('tool')),
        )
      }
      if (block.kind === 'image') {
        return h('div', { className: 'qp-feed-note' }, t('imageOnly'))
      }
      if (block.kind === 'text') {
        const segments = codeSegments(block.text || '')
        return h(
          'div',
          { className: 'qp-feed-text' },
          segments.map((segment, index) =>
            segment.type === 'code'
              ? h(
                  'div',
                  { key: `c${index}`, className: 'qp-code' },
                  h('div', { className: 'qp-code-head' }, segment.lang || 'code'),
                  h('pre', null, segment.text),
                )
              : h('span', { key: `t${index}` }, segment.text),
          ),
          streaming ? h('span', { className: 'qp-caret' }) : null,
        )
      }
      return null
    }

    function hostAttachmentSrc(attachment) {
      const id =
        attachment && typeof attachment.attachmentId === 'string' ? attachment.attachmentId : ''
      if (!id) return ''
      const injected = window.__QUICK_PANEL_CONFIG__
      const token =
        (injected && typeof injected.token === 'string' && injected.token) || hostSync.token || ''
      if (!token) return ''
      return `${HOST_ROUTE}/attachment?id=${encodeURIComponent(id)}&token=${encodeURIComponent(token)}`
    }

    const FeedImage = React.memo(function FeedImage({ attachment, t }) {
      const source = hostAttachmentSrc(attachment)
      const [attempt, setAttempt] = useState(0)
      const [failed, setFailed] = useState(false)
      if (!source || failed) {
        return h('span', { className: 'qp-feed-image-tag' }, t('imageOnly'))
      }
      return h('img', {
        className: 'qp-feed-image',
        src: attempt ? `${source}&retry=${attempt}` : source,
        alt: t('imageOnly'),
        loading: 'lazy',
        decoding: 'async',
        onError: () => {
          if (attempt < 2) {
            window.setTimeout(() => setAttempt(attempt + 1), 500)
          } else {
            setFailed(true)
          }
        },
      })
    })

    const FeedRow = React.memo(function FeedRow({ node, t }) {
      if (!node) return null
      const metaTime = timeLabel(node.time)
      if (node.kind === 'user' || node.kind === 'steering') {
        const text = contentText(node.content)
        const images = Array.isArray(node.content)
          ? node.content
              .filter(
                (block) =>
                  block &&
                  (block.type === 'image' || block.kind === 'image') &&
                  block.attachment &&
                  typeof block.attachment === 'object',
              )
              .slice(0, 4)
          : []
        const hasImage =
          images.length > 0 ||
          (Array.isArray(node.content) &&
            node.content.some((block) => block && (block.type === 'image' || block.kind === 'image')))
        return h(
          'div',
          { className: `qp-feed-row${node.kind === 'steering' ? ' is-steering' : ' is-user'}` },
          h(
            'div',
            { className: 'qp-feed-meta' },
            `${node.kind === 'steering' ? t('steering') : t('you')} · ${metaTime}`,
          ),
          images.length
            ? h(
                'div',
                { className: 'qp-feed-images' },
                images.map((block, index) =>
                  h(FeedImage, { key: index, attachment: block.attachment, t }),
                ),
              )
            : hasImage
              ? h('span', { className: 'qp-feed-image-tag' }, t('imageOnly'))
              : null,
          h('div', { className: 'qp-feed-body' }, text || (hasImage ? '' : t('nonText'))),
        )
      }
      if (node.kind === 'assistant') {
        const blocks = Array.isArray(node.blocks) ? node.blocks : []
        return h(
          'div',
          { className: 'qp-feed-row is-assistant' },
          h(
            'div',
            { className: 'qp-feed-meta' },
            `DSH · ${metaTime}${node.interrupted ? ` · ${t('interrupted')}` : ''}`,
          ),
          blocks.map((block, index) =>
            h(AssistantBlockView, { key: index, block, t, streaming: false }),
          ),
        )
      }
      if (node.kind === 'tool-result') {
        return h(
          'div',
          { className: `qp-tool-chip is-result${node.isError ? ' is-error' : ''}` },
          h('span', { className: 'qp-tool-dot' }),
          h(
            'span',
            null,
            `${node.name || t('tool')} · ${node.isError ? t('toolFailed') : t('toolDone')}`,
          ),
        )
      }
      if (node.kind === 'turn-error') {
        return h(
          'div',
          { className: 'qp-feed-row is-error' },
          h('div', { className: 'qp-feed-meta' }, `DSH · ${metaTime}`),
          h('div', { className: 'qp-feed-error' }, node.message || node.code || t('toolFailed')),
        )
      }
      return null
    })

    function FeedSection({ t, state, onLoadOlder, followTick }) {
      const feed = Array.isArray(state.feed) ? state.feed : []
      const partial = state.partial || null
      const connected = Boolean(state.sessionId)
      const feedRef = useRef(null)
      const contentRef = useRef(null)
      const pinnedRef = useRef(true)
      const anchorRef = useRef(null)
      const userScrollRef = useRef(false)
      const userTimer = useRef(0)
      const followTimer = useRef(0)
      const lastTopRef = useRef(0)
      const [following, setFollowing] = useState(true)

      const scrollToBottom = () => {
        const element = feedRef.current
        if (!element) return
        element.scrollTop = element.scrollHeight
        window.requestAnimationFrame(() => {
          const current = feedRef.current
          if (current) current.scrollTop = current.scrollHeight
        })
        if (followTimer.current) window.clearTimeout(followTimer.current)
        followTimer.current = window.setTimeout(() => {
          followTimer.current = 0
          if (!pinnedRef.current) return
          const current = feedRef.current
          if (current) current.scrollTop = current.scrollHeight
        }, 180)
        if (!pinnedRef.current) {
          pinnedRef.current = true
          setFollowing(true)
        }
      }

      useEffect(() => {
        if (pinnedRef.current) scrollToBottom()
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [feed, partial])

      useEffect(() => {
        scrollToBottom()
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [followTick])

      useEffect(
        () => () => {
          if (userTimer.current) window.clearTimeout(userTimer.current)
          if (followTimer.current) window.clearTimeout(followTimer.current)
        },
        [],
      )

      useLayoutEffect(() => {
        const element = feedRef.current
        if (!element) return
        if (anchorRef.current) {
          element.scrollTop += element.scrollHeight - anchorRef.current.height
          anchorRef.current = null
        }
      }, [feed.length])

      useEffect(() => {
        if (!state.loadingOlder && anchorRef.current) anchorRef.current = null
      }, [state.loadingOlder])

      useEffect(() => {
        const element = feedRef.current
        const content = contentRef.current
        if (!element || !content || typeof window.ResizeObserver === 'undefined') return
        const observer = new window.ResizeObserver(() => {
          if (pinnedRef.current) element.scrollTop = element.scrollHeight
        })
        observer.observe(content)
        return () => observer.disconnect()
      }, [])

      const markUserScroll = () => {
        userScrollRef.current = true
        if (userTimer.current) window.clearTimeout(userTimer.current)
        userTimer.current = window.setTimeout(() => {
          userScrollRef.current = false
        }, 220)
      }

      const onScroll = () => {
        const element = feedRef.current
        if (!element) return
        const top = element.scrollTop
        const delta = top - lastTopRef.current
        lastTopRef.current = top
        if (!userScrollRef.current && delta < -2) markUserScroll()
        const distance = element.scrollHeight - top - element.clientHeight
        if (userScrollRef.current) {
          const next = distance < 28
          pinnedRef.current = next
          setFollowing(next)
        } else if (distance < 28 && !pinnedRef.current) {
          pinnedRef.current = true
          setFollowing(true)
        }
        if (element.scrollTop < 40 && state.hasMore && !state.loadingOlder && !anchorRef.current) {
          anchorRef.current = { height: element.scrollHeight }
          onLoadOlder()
        }
      }

      return h(
        'section',
        { className: 'qp-section qp-feed-section' },
        h(
          'div',
          { className: 'qp-section-title' },
          h('span', null, t('live')),
          h(
            'span',
            { className: 'qp-count' },
            state.running ? t('running') : connected ? t('idle') : '',
          ),
        ),
        connected
          ? h(
              React.Fragment,
              null,
              h(
                'div',
                {
                  className: 'qp-feed',
                  ref: feedRef,
                  onScroll,
                  onWheel: markUserScroll,
                  onTouchMove: markUserScroll,
                  onPointerDown: markUserScroll,
                },
                state.hasMore
                  ? h(
                      'div',
                      { className: 'qp-feed-more' },
                      state.loadingOlder ? t('loadingOlder') : t('scrollOlder'),
                    )
                  : feed.length
                    ? h('div', { className: 'qp-feed-more' }, t('oldest'))
                    : null,
                h(
                  'div',
                  { className: 'qp-feed-content', ref: contentRef },
                  feed.length === 0 && !partial
                    ? h('div', { className: 'qp-feed-note' }, t('feedEmpty'))
                    : feed.map((node) => h(FeedRow, { key: `${node.kind}:${node.seq}`, node, t })),
                  partial
                    ? h(
                        'div',
                        { className: 'qp-feed-row is-assistant is-streaming' },
                        h('div', { className: 'qp-feed-meta' }, `DSH · ${t('streaming')}`),
                        (partial.blocks || []).map((block, index) =>
                          h(AssistantBlockView, {
                            key: index,
                            block,
                            t,
                            streaming: index === (partial.blocks || []).length - 1,
                          }),
                        ),
                      )
                    : state.running
                      ? h(
                          'div',
                          { className: 'qp-feed-status' },
                          h('span', { className: 'qp-feed-dot' }),
                          t('thinking'),
                        )
                      : null,
                ),
              ),
              !following
                ? h(
                    'button',
                    {
                      type: 'button',
                      className: 'qp-feed-jump',
                      onClick: scrollToBottom,
                      title: t('jumpLatest'),
                    },
                    t('jumpLatest'),
                  )
                : null,
            )
          : h('div', { className: 'qp-placeholder' }, t('feedNoSession')),
      )
    }

    function draftStorageKey(sessionId) {
      return `dsh.quick-panel.draft.${sessionId || 'none'}`
    }

    function loadDraftValue(key) {
      try {
        return window.sessionStorage.getItem(key) || ''
      } catch (_error) {
        return ''
      }
    }

    function saveDraftValue(key, value) {
      try {
        if (value) window.sessionStorage.setItem(key, value)
        else window.sessionStorage.removeItem(key)
      } catch (_error) {
        /* draft persistence is best effort */
      }
    }

    function QuickInput({ t, state, onSend, onStop, onFlash, onSent }) {
      const sessionKey = state.sessionId || 'none'
      const [value, setValue] = useState(() => loadDraftValue(draftStorageKey(sessionKey)))

      useEffect(() => {
        setValue(loadDraftValue(draftStorageKey(sessionKey)))
      }, [sessionKey])

      const update = (next) => {
        setValue(next)
        saveDraftValue(draftStorageKey(sessionKey), next)
      }

      const send = (mode) => {
        const text = value.trim()
        if (!text) return
        if (!state.sessionId || !state.canPrompt) {
          onFlash(t('cannotSend'))
          return
        }
        const previous = value
        update('')
        Promise.resolve(onSend(text, mode)).then(
          (result) => {
            if (result && result.ok) {
              if (onSent) onSent()
              onFlash(mode === 'steer' ? t('steered') : t('sent'))
              return
            }
            update(previous)
            onFlash(t('sendFailed'))
          },
          () => {
            update(previous)
            onFlash(t('sendFailed'))
          },
        )
      }

      const stop = () => {
        Promise.resolve(onStop()).then(
          (result) => onFlash(result && result.ok ? t('stopped') : t('stopFailed')),
          () => onFlash(t('stopFailed')),
        )
      }

      const disabled = !state.sessionId || !state.canPrompt
      const placeholder = state.sessionId
        ? disabled
          ? t('cannotSend')
          : t('inputPlaceholder')
        : t('inputNoSession')

      return h(
        'div',
        { className: 'qp-quick-wrap' },
        h(
          'div',
          { className: 'qp-quick-box' },
          h('textarea', {
            className: 'qp-quick-input',
            rows: Math.min(3, Math.max(1, value.split('\n').length)),
            value,
            placeholder,
            disabled,
            'aria-label': t('inputPlaceholder'),
            onChange: (event) => update(event.target.value),
            onKeyDown: (event) => {
              if (event.key !== 'Enter' || event.shiftKey) return
              if (event.nativeEvent && event.nativeEvent.isComposing) return
              event.preventDefault()
              if (disabled) {
                onFlash(t('cannotSend'))
                return
              }
              send(event.ctrlKey || event.metaKey ? 'steer' : 'queue')
            },
          }),
          h(
            'div',
            { className: 'qp-quick-actions' },
            state.running
              ? h(
                  'button',
                  {
                    type: 'button',
                    className: 'qp-stop-btn',
                    onClick: stop,
                    disabled: !state.canCancel,
                    title: t('stop'),
                    'aria-label': t('stop'),
                  },
                  h(IconStop, { size: 11 }),
                )
              : null,
            h(
              'button',
              {
                type: 'button',
                className: 'qp-send-btn',
                onClick: () => send('queue'),
                disabled: disabled || !value.trim(),
                title: t('send'),
                'aria-label': t('send'),
              },
              h(IconSend, { size: 14 }),
            ),
          ),
        ),
        h(
          'div',
          { className: 'qp-quick-hint' },
          disabled
            ? state.sessionId
              ? t('cannotSend')
              : t('inputNoSession')
            : state.running
              ? t('hintRunning')
              : t('hintIdle'),
        ),
      )
    }

    function Panel({ t, now, state, anchor, width, maxHeight, onDragStart, due, onSnooze, onComplete, schedule, openSchedule, loadOlder, sendPrompt, stopTurn }) {
      const clock = clockOf(now)
      const connected = Boolean(state.sessionId)
      const todos = useSyncExternalStore(todoStore.subscribe, todoStore.getSnapshot)
      const reminders = useSyncExternalStore(reminderStore.subscribe, reminderStore.getSnapshot)
      const pending = todos.filter((todo) => !todo.done)
      const ordered = [...pending, ...todos.filter((todo) => todo.done)]
      const [flash, setFlash] = useState(null)
      const flashTimer = useRef(0)
      const [followTick, setFollowTick] = useState(0)

      useEffect(
        () => () => {
          window.clearTimeout(flashTimer.current)
        },
        [],
      )

      const showFlash = (text) => {
        setFlash(text)
        window.clearTimeout(flashTimer.current)
        flashTimer.current = window.setTimeout(() => setFlash(null), 2600)
      }

      const handoff = (todo) => {
        if (todo.handedOff) {
          todoStore.update(todo.id, { handedOff: false })
          return
        }
        const actions = store.inputActions
        if (!store.state.sessionId || !actions) {
          showFlash(t('needSession'))
          return
        }
        let span
        try {
          span = actions.captureInsertion()
        } catch (_error) {
          span = undefined
        }
        if (!span) {
          showFlash(t('insertFailed'))
          return
        }
        const prefix = Number.isFinite(span.start) && span.start > 0 ? '\n\n' : ''
        let inserted = false
        try {
          inserted = actions.insertText(prefix + buildHandoff(t, todo), span)
        } catch (_error) {
          inserted = false
        }
        if (!inserted) {
          showFlash(t('insertFailed'))
          return
        }
        todoStore.update(todo.id, { handedOff: true })
        showFlash(t('inserted'))
      }

      const copy = (todo) => {
        const clipboard = window.navigator && window.navigator.clipboard
        if (!clipboard || !clipboard.writeText) {
          showFlash(t('copyFailed'))
          return
        }
        clipboard.writeText(todo.text).then(
          () => showFlash(t('copied')),
          () => showFlash(t('copyFailed')),
        )
      }

      const addReminder = (entry) => {
        const id = reminderStore.add({ ...entry, dshTask: false })
        showFlash(t('reminderAdded'))
        if (!entry.dshTask) return
        const api = schedule ? schedule() : null
        if (!api || typeof api.create !== 'function' || !state.sessionId) {
          showFlash(t('scheduleFailed'))
          return
        }
        let timeZone = 'UTC'
        try {
          timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
        } catch (_error) {
          /* fall back to UTC */
        }
        const date = new Date(entry.at)
        const time = `${pad2(date.getHours())}:${pad2(date.getMinutes())}`
        const dateText = `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
        const timing = () => {
          if (entry.repeat === 'none') {
            return { kind: 'at', at: { date: dateText, time, time_zone: timeZone } }
          }
          if (entry.repeat === 'daily') {
            return { kind: 'daily', daily: { time, time_zone: timeZone } }
          }
          return { kind: 'weekly', weekly: { time, time_zone: timeZone, weekdays: [1, 2, 3, 4, 5] } }
        }
        const payload = (value) => ({
          title: entry.text.slice(0, 60),
          prompt: entry.text,
          timing: value,
          target: { kind: 'session', sessionId: state.sessionId },
        })
        const fail = (result) => {
          reminderStore.update(id, { dshTask: false })
          let detail = ''
          try {
            if (result && result.error) {
              detail = String(result.error.code || result.error.message || '')
              if (result.error.details && result.error.details.code) {
                detail += ` · ${result.error.details.code}`
              }
            }
          } catch (_error) {
            /* ignore */
          }
          try {
            console.warn('quick-panel: schedule create failed', result)
          } catch (_error) {
            /* ignore */
          }
          showFlash(detail ? `${t('scheduleFailed')} (${detail})` : t('scheduleFailed'))
        }
        const succeed = () => {
          reminderStore.update(id, { dshTask: true })
          showFlash(t('scheduleCreated'))
        }
        const attempt = (value, canRetry) => {
          let request
          try {
            request = api.create(payload(value))
          } catch (error) {
            fail(error)
            return
          }
          Promise.resolve(request).then(
            (result) => {
              if (result && result.ok) {
                succeed()
                return
              }
              const code = result && result.error ? String(result.error.code || '') : ''
              const detailCode =
                result && result.error && result.error.details
                  ? String(result.error.details.code || '')
                  : ''
              if (
                canRetry &&
                entry.repeat === 'none' &&
                (code === 'schedule/input-invalid' ||
                  detailCode === 'not_future' ||
                  detailCode === 'invalid_time_zone')
              ) {
                attempt({ kind: 'at', at: new Date(entry.at).toISOString() }, false)
                return
              }
              fail(result)
            },
            (error) => fail(error),
          )
        }
        attempt(timing(), true)
      }

      return h(
        'div',
        { className: 'qp-panel-anchor', style: { left: anchor.cx, top: anchor.top } },
        h(
          'section',
          {
            className: 'qp-panel',
            style: { width, maxHeight },
            role: 'dialog',
            'aria-label': t('panel'),
            onKeyDown: (event) => {
              if (event.key !== 'Escape') return
              event.stopPropagation()
              collapsePanel()
            },
          },
          h(
            'header',
            {
              className: 'qp-head',
              onPointerDown: (event) => onDragStart(event, 'panel'),
              title: t('dragHint'),
            },
            h(
              'div',
              { className: 'qp-head-top' },
              h(
                'div',
                { className: 'qp-title' },
                h('span', { className: 'qp-grip' }, h(IconGrip)),
                h(IconPanel, { size: 14 }),
                h('span', null, t('panel')),
                h('span', { className: 'qp-badge' }, 'M6'),
              ),
              h(
                'div',
                { className: 'qp-head-actions', 'data-qp-no-drag': '' },
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'qp-iconbtn',
                    onClick: () => {
                      hostSync.openWindow().then((result) => {
                        showFlash(result && result.ok ? t('windowOpened') : t('windowFailed'))
                      })
                    },
                    title: t('openWindow'),
                    'aria-label': t('openWindow'),
                  },
                  h(IconWindow, { size: 15 }),
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'qp-iconbtn',
                    onClick: collapsePanel,
                    title: t('collapse'),
                    'aria-label': t('collapse'),
                  },
                  h(IconChevronDown, { size: 16 }),
                ),
              ),
            ),
            h(
              'div',
              { className: 'qp-clock' },
              h('span', null, `${clock.hh}:${clock.mm}`),
              h('span', { className: 'qp-clock-sec' }, `:${clock.ss}`),
            ),
            h('div', { className: 'qp-date' }, clock.date),
            h(
              'div',
              { className: 'qp-head-status' },
              h('span', { className: state.running ? 'qp-dot is-live' : 'qp-dot' }),
              h(
                'span',
                null,
                state.running ? t('running') : connected ? t('connected') : t('noSessionShort'),
              ),
            ),
          ),
          due
            ? h(
                'div',
                { className: 'qp-due-banner' },
                h(IconBell, { size: 12 }),
                h('span', { className: 'qp-due-banner-text', title: due.text }, due.text),
                h(
                  'button',
                  { type: 'button', className: 'qp-due-banner-btn', onClick: onSnooze },
                  t('snooze10'),
                ),
                h(
                  'button',
                  { type: 'button', className: 'qp-due-banner-btn is-primary', onClick: onComplete },
                  t('markReminderDone'),
                ),
              )
            : null,
          h(
            'div',
            { className: 'qp-capture-wrap' },
            h(
              'div',
              { className: 'qp-section-title' },
              h('span', null, t('todos')),
              h('span', { className: 'qp-count' }, `${pending.length}/${todos.length}`),
            ),
            h(Capture, {
              t,
              onAdd: (lines) => {
                todoStore.addMany(lines)
              },
            }),
            todos.length ? h('div', { className: 'qp-hint' }, t('handoffHint')) : null,
          ),
          h(
            'div',
            { className: 'qp-body' },
            todos.length === 0
              ? h(
                  'div',
                  { className: 'qp-empty' },
                  h('div', { className: 'qp-empty-title' }, t('emptyTitle')),
                  h('div', null, t('emptyHint')),
                )
              : h(
                  'div',
                  { className: 'qp-todo-list' },
                  ordered.map((todo, index) =>
                    h(TodoRow, {
                      key: todo.id,
                      todo,
                      index,
                      t,
                      onHandoff: handoff,
                      onDone: (item) => todoStore.update(item.id, { done: !item.done }),
                      onEdit: (id, text) => todoStore.update(id, { text }),
                      onDelete: (item) => {
                        todoStore.remove(item.id)
                        showFlash(t('deleted'))
                      },
                      onCopy: copy,
                    }),
                  ),
                ),
            h(ReminderSection, {
              t,
              now,
              reminders,
              dueId: due ? due.id : null,
              sessionId: state.sessionId,
              schedule,
              openSchedule,
              onAdd: addReminder,
              onRemove: (id) => reminderStore.remove(id),
            }),
            h(FeedSection, { t, state, onLoadOlder: loadOlder, followTick }),
          ),
          h(
            'footer',
            { className: 'qp-foot' },
            h(
              'button',
              {
                type: 'button',
                className: 'qp-window-row',
                onClick: () => {
                  hostSync.openWindow().then((result) => {
                    showFlash(result && result.ok ? t('windowOpened') : t('windowFailed'))
                  })
                },
              },
              h(IconWindow, { size: 13 }),
              h('span', null, t('openWindow')),
            ),
            h(QuickInput, {
              t,
              state,
              onSend: sendPrompt,
              onStop: stopTurn,
              onFlash: showFlash,
              onSent: () => setFollowTick((value) => value + 1),
            }),
            h(
              'div',
              { className: 'qp-foot-meta' },
              h('span', null, t('version')),
              h('span', null, t('esc')),
            ),
          ),
          flash ? h('div', { className: 'qp-flash', role: 'status' }, flash) : null,
        ),
      )
    }

    // ------------------------------------------------------- sidebar footer

    function FooterAction({ t, wide }) {
      const state = useSyncExternalStore(store.subscribe, store.getSnapshot)
      const open = state.mode === 'panel'
      return h(
        'button',
        {
          type: 'button',
          className: wide ? 'qp-side-btn is-wide' : 'qp-side-btn',
          onClick: togglePanel,
          title: t('open'),
          'aria-label': t('open'),
          'aria-pressed': open,
        },
        h(IconPanel, { size: 17 }),
        state.bridgeReady ? h('span', { className: 'qp-side-dot' }) : null,
      )
    }

    // ---------------------------------------------------- composer bridge

    function Bridge({ slot, t }) {
      const sessionId = slot.sessionId || null
      const inputActions = slot.inputActions || null
      const canPrompt = typeof slot.useAccess === 'function' ? Boolean(slot.useAccess('session/prompt')) : false
      const canCancel = typeof slot.useAccess === 'function' ? Boolean(slot.useAccess('session/cancel')) : false

      useEffect(() => {
        store.inputActions = inputActions
        store.patch({ bridgeReady: Boolean(inputActions) })
      }, [inputActions])

      useEffect(() => {
        store.patch({ canPrompt: Boolean(canPrompt), canCancel: Boolean(canCancel) })
      }, [canPrompt, canCancel])

      useEffect(() => {
        store.patch({ sessionId })
        hostSync.setSession(sessionId)
        return () => {
          if (store.state.sessionId !== sessionId) return
          hostSync.setSession(null)
          store.inputActions = null
          store.patch({
            sessionId: null,
            bridgeReady: false,
            running: false,
            feed: [],
            partial: null,
            latest: '',
            loadingOlder: false,
            hasMore: false,
            canPrompt: false,
            canCancel: false,
          })
        }
      }, [sessionId])

      useEffect(() => {
        if (!sessionId) return undefined
        const report = () => {
          if (document.visibilityState === 'hidden') return
          if (store.state.sessionId !== sessionId) return
          hostSync.setSession(sessionId)
        }
        window.addEventListener('focus', report)
        document.addEventListener('visibilitychange', report)
        report()
        return () => {
          window.removeEventListener('focus', report)
          document.removeEventListener('visibilitychange', report)
        }
      }, [sessionId])

      return h(
        'button',
        {
          type: 'button',
          className: 'qp-composer-btn',
          onClick: openPanel,
          title: t('open'),
          'aria-label': t('open'),
        },
        h(IconPanel, { size: 16 }),
      )
    }

    function StatusBridge({ slot }) {
      const useSession = slot.useSession
      const flags =
        typeof useSession === 'function'
          ? useSession((snapshot) =>
              snapshot
                ? (snapshot.running ? 1 : 0) |
                  (snapshot.loadingOlder ? 2 : 0) |
                  (snapshot.hasMore ? 4 : 0)
                : 0,
            )
          : 0
      const running = Boolean(flags & 1)
      const loadingOlder = Boolean(flags & 2)
      const hasMore = Boolean(flags & 4)
      useEffect(() => {
        store.patch({ running, loadingOlder, hasMore })
      }, [running, loadingOlder, hasMore])
      return null
    }

    function useNoProjection() {
      return null
    }

    function UsageBridge({ slot }) {
      const useProjection =
        typeof slot.useProjection === 'function' ? slot.useProjection : useNoProjection
      const tokenUsage = useProjection('tokenUsage')
      const stats = useProjection('sessionStats')
      const contextPressure = useProjection('contextPressure')
      const workingDirectory = useProjection('workingDirectory')
      const modelSelection = useProjection('modelSelection')
      useEffect(() => {
        const pressure =
          contextPressure && contextPressure.val && typeof contextPressure.val === 'object'
            ? contextPressure.val
            : contextPressure
        const directoryValue =
          workingDirectory && workingDirectory.val !== undefined
            ? workingDirectory.val
            : workingDirectory
        const workingDirectoryPath =
          typeof directoryValue === 'string'
            ? directoryValue
            : directoryValue && typeof directoryValue.path === 'string'
              ? directoryValue.path
              : ''
        const selectionValue =
          modelSelection && modelSelection.val !== undefined ? modelSelection.val : modelSelection
        const selection =
          selectionValue && typeof selectionValue === 'object'
            ? selectionValue.next || selectionValue.pending || selectionValue.lastUsed || null
            : null
        const model = selection && typeof selection.model === 'string' ? selection.model : ''
        const modelProvider =
          selection && typeof selection.provider === 'string' ? selection.provider : ''
        const reasoningEffort =
          selection && typeof selection.reasoningEffort === 'string'
            ? selection.reasoningEffort
            : ''
        const contextWindow =
          pressure && Number.isFinite(pressure.contextWindow) && pressure.contextWindow > 0
            ? pressure.contextWindow
            : 0
        const contextTokens =
          pressure &&
          Number.isFinite(
            pressure.projectedTokens ?? pressure.pressureTokens ?? pressure.surfaceTokens,
          )
            ? Math.max(
                0,
                pressure.projectedTokens ?? pressure.pressureTokens ?? pressure.surfaceTokens,
              )
            : 0
        const contextPercent =
          contextWindow > 0 && contextTokens >= 0
            ? Math.min(100, (contextTokens / contextWindow) * 100)
            : null
        const contextData = {
          ...(contextPercent === null ? {} : { contextPercent }),
          contextTokens,
          contextWindow,
          workingDirectory: workingDirectoryPath,
          model,
          modelProvider,
          reasoningEffort,
        }
        const totals =
          tokenUsage && tokenUsage.totals && typeof tokenUsage.totals === 'object'
            ? tokenUsage.totals
            : tokenUsage
        if (!totals || typeof totals !== 'object') {
          store.patch({
            usage: contextPercent === null
              ? null
              : {
                  ...contextData,
                  sessionKnown: false,
                  sessionTokens: 0,
                  sessionOutputTokens: 0,
                  tps: 0,
                  at: Date.now(),
                },
          })
          return
        }
        const count = (value) => (Number.isFinite(value) && value > 0 ? Math.floor(value) : 0)
        const sessionTokens =
          count(totals.uncachedInputTokens) +
          count(totals.cacheReadTokens) +
          count(totals.cacheWriteTokens) +
          count(totals.outputTokens)
        const sessionOutputTokens = count(totals.outputTokens)
        const tps =
          stats &&
          Number.isFinite(stats.decodeMs) &&
          stats.decodeMs > 0 &&
          Number.isFinite(stats.decodeTokens)
            ? Math.max(0, stats.decodeTokens / (stats.decodeMs / 1000))
            : 0
        store.patch({
          usage: {
            sessionTokens,
            sessionOutputTokens,
            tps,
            at: Date.now(),
            ...contextData,
          },
        })
      }, [tokenUsage, stats, contextPressure, workingDirectory, modelSelection])
      return null
    }

    function FeedBridge({ slot }) {
      const useChat = slot.useChat
      const legacy =
        typeof useChat === 'function' ? useChat((snapshot) => (snapshot ? snapshot.legacy : null)) : null
      const latestRef = useRef(legacy)
      latestRef.current = legacy
      const timer = useRef(0)

      useEffect(() => {
        if (timer.current) return
        timer.current = window.setTimeout(() => {
          timer.current = 0
          const value = latestRef.current
          const nodes = value && Array.isArray(value.nodes) ? value.nodes : []
          const partial = value && value.partial ? value.partial : null
          store.patch({ feed: nodes, partial, latest: latestText(nodes, partial) })
        }, 90)
      }, [legacy])

      useEffect(
        () => () => {
          if (timer.current) {
            window.clearTimeout(timer.current)
            timer.current = 0
          }
        },
        [],
      )

      return null
    }

    // --------------------------------------------------------------- apply

    function apply(ctx) {
      hostSync.ctx = ctx
      try {
        ctx.inject(['uiSession'], (uiCtx) => {
          hostSync.uiSession = uiCtx.uiSession
          hostSync.bindQuestions()
        })
      } catch (_error) {
        /* question mirror is optional */
      }
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'quick-panel: dictionaries')
      const t = ctx.locale.bind(NS)
      ctx.effect(() => {
        void hostSync.init()
        return () => hostSync.dispose()
      }, 'quick-panel: host sync')
      const scheduleOf = () => {
        try {
          const direct = ctx.get('remote.schedule')
          if (direct) return direct
          const remote = ctx.get('remote')
          return remote && remote.schedule ? remote.schedule : null
        } catch (_error) {
          return null
        }
      }
      const openSchedule = () => {
        try {
          const layout = ctx.get('layout')
          if (layout && typeof layout.selectPanel === 'function') layout.selectPanel('schedules')
        } catch (_error) {
          /* the Automation tasks panel may be unavailable */
        }
      }
      const loadOlder = () => {
        try {
          const sessions = ctx.get('sessions')
          const sessionId = store.state.sessionId
          if (!sessions || !sessionId) return
          const binding = sessions.binding(sessionId)
          const session = binding && binding.session
          if (session && typeof session.loadOlder === 'function') {
            const result = session.loadOlder()
            if (result && typeof result.catch === 'function') result.catch(() => {})
          }
        } catch (_error) {
          /* paging is best effort */
        }
      }
      const sendPrompt = async (text, mode) => {
        try {
          const sessions = ctx.get('sessions')
          const sessionId = store.state.sessionId
          if (!sessions || !sessionId) return { ok: false }
          const binding = sessions.binding(sessionId)
          const session = binding && binding.session
          if (!session) return { ok: false }
          let handle = null
          try {
            handle = session.beginSubmission({ mode, text, attachments: [] })
          } catch (_error) {
            handle = null
          }
          try {
            return await session.prompt(
              [{ type: 'text', text }],
              mode,
              undefined,
              handle ? handle.requestId : undefined,
            )
          } catch (error) {
            if (handle && typeof handle.abandon === 'function') handle.abandon()
            return { ok: false, error }
          }
        } catch (error) {
          return { ok: false, error }
        }
      }
      const stopTurn = async () => {
        try {
          const sessions = ctx.get('sessions')
          const sessionId = store.state.sessionId
          if (!sessions || !sessionId) return { ok: false }
          const binding = sessions.binding(sessionId)
          const session = binding && binding.session
          if (!session || typeof session.cancel !== 'function') return { ok: false }
          return await session.cancel()
        } catch (error) {
          return { ok: false, error }
        }
      }

      ctx.slots.inject('shell.overlay', () =>
        ctx.slots.register({ name: 'shell.overlay', id: 'quick-panel', order: 900 }, (props) =>
          h(Overlay, {
            ...props,
            t,
            schedule: scheduleOf,
            openSchedule,
            loadOlder,
            sendPrompt,
            stopTurn,
          }),
        ),
      )

      ctx.slots.inject('sidebar.footer.action', () =>
        ctx.slots.register(
          {
            name: 'sidebar.footer.action',
            id: 'quick-panel',
            order: 20,
            label: () => t('panel'),
          },
          (props) => h(FooterAction, { ...props, t }),
        ),
      )

      ctx.slots.inject('conversation.input.left', () => {
        const panelEntry = ctx.slots.register(
          {
            name: 'conversation.input.left',
            id: 'quick-panel',
            order: 10,
            label: () => t('panel'),
          },
          (props) => h(Bridge, { slot: props, t }),
        )
        const statusEntry = ctx.slots.register(
          { name: 'conversation.input.left', id: 'quick-panel-status', order: 11 },
          (props) => h(StatusBridge, { slot: props }),
        )
        const feedEntry = ctx.slots.register(
          { name: 'conversation.input.left', id: 'quick-panel-feed', order: 12 },
          (props) => h(FeedBridge, { slot: props }),
        )
        const usageEntry = ctx.slots.register(
          { name: 'conversation.input.left', id: 'quick-panel-usage', order: 13 },
          (props) => h(UsageBridge, { slot: props }),
        )
        return () => {
          panelEntry()
          statusEntry()
          feedEntry()
          usageEntry()
        }
      })
    }
export default { inject: ['slots', 'locale'], apply }
