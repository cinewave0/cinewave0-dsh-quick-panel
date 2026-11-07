import { h, useEffect, useRef, useState, useSyncExternalStore } from './runtime.js'
import { IconPanel, IconGrip, IconWindow, IconChevronDown, IconBell } from './icons.js'
import { clockOf } from './hooks.js'
import { pad2, buildHandoff } from './text.js'
import { store, collapsePanel, todoStore, reminderStore, hostSync } from './session.js'
import { Capture, TodoRow, ReminderSection } from './sections.js'
import { FeedSection } from './feed.js'
import { QuickInput } from './input.js'

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


export { Panel }
