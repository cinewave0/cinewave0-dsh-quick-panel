import { h, useEffect, useState } from './runtime.js'
import { IconSend, IconStop } from './icons.js'

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


export { draftStorageKey, loadDraftValue, saveDraftValue, QuickInput }
