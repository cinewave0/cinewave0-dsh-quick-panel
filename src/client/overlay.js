import { React, h, useEffect, useRef, useState, useSyncExternalStore } from './runtime.js'
import { CSS } from './styles.js'
import { IconChevronRight, IconBell } from './icons.js'
import { useNow, useViewport, clockOf } from './hooks.js'
import { formatDuration } from './text.js'
import { playChime, showNotification } from './notify.js'
import { store, openPanel, togglePanel, loadAnchor, saveAnchor, clampRange, todoStore, formatWhen, reminderStore } from './session.js'
import { Panel } from './panel.js'

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


export { Overlay, Island }
