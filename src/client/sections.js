import { h, useEffect, useRef, useState } from './runtime.js'
import { DSH_TASKS_ENABLED } from './constants.js'
import { IconChevronDown, IconCheck, IconPlus, IconCopy, IconTrash } from './icons.js'
import { maybeEnsureNotifyPermission, ensureAudio, playChime } from './notify.js'
import { splitLines, defaultWhenParts, formatWhen, computeAt } from './session.js'

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


export { Section, Capture, TodoRow, Wheel, ReminderSection }
