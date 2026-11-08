import { MODE_KEY, POS_KEY, TODO_KEY, REMINDER_KEY, MODES, HOST_ROUTE } from './constants.js'
import { maybeEnsureNotifyPermission, ensureAudio } from './notify.js'
import { pad2, userImageRefs, hostLiveRow, hostLivePartial } from './text.js'

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
      /** Asks the DSH page to open a Session; set once by main.js. */
      switcher: null,
      lastSwitchRequestId: '',

      setSwitcher(switcher) {
        this.switcher = typeof switcher === 'function' ? switcher : null
      },

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

      /** Apply a numbered-switch request from the companion, then acknowledge it. */
      async handleSwitchRequest(request) {
        if (!request || typeof request !== 'object') return
        const id = typeof request.id === 'string' ? request.id : ''
        if (!id || id === this.lastSwitchRequestId) return
        this.lastSwitchRequestId = id
        const sessionId = typeof request.sessionId === 'string' ? request.sessionId : ''
        let ok = false
        if (sessionId && this.switcher) {
          try {
            ok = this.switcher(sessionId) === true
          } catch (_error) {
            ok = false
          }
        }
        try {
          await fetch(`${HOST_ROUTE}/action?token=${encodeURIComponent(this.token)}`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-quick-panel-token': this.token,
            },
            body: JSON.stringify({ type: 'switch-session-ack', id, ok }),
          })
        } catch (_error) {
          /* the Host expires the request on its own */
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
        await this.handleSwitchRequest(state.switchRequest)
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


export { store, readMode, writeMode, setMode, openPanel, collapsePanel, togglePanel, loadAnchor, saveAnchor, clampRange, newId, splitLines, loadTodos, todoStore, defaultWhenParts, formatWhen, computeAt, nextOccurrence, loadReminders, reminderStore, hostSync }
