import { h } from './runtime.js'
import { NS } from './constants.js'
import { zh, en } from './locales.js'
import { store, hostSync } from './session.js'
import { Overlay } from './overlay.js'
import { FooterAction, Bridge, StatusBridge, UsageBridge, FeedBridge } from './bridges.js'

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
