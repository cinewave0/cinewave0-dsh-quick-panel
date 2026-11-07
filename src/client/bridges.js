import { h, useEffect, useRef, useSyncExternalStore } from './runtime.js'
import { IconPanel } from './icons.js'
import { latestText } from './text.js'
import { store, openPanel, togglePanel, hostSync } from './session.js'

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


export { FooterAction, Bridge, StatusBridge, useNoProjection, UsageBridge, FeedBridge }
