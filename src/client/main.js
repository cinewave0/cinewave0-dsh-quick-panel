import { h } from './runtime.js'
import { NS } from './constants.js'
import { zh, en } from './locales.js'
import { store, hostSync } from './session.js'
import { createDsh } from './dsh.js'
import { Overlay } from './overlay.js'
import { FooterAction, Bridge, StatusBridge, UsageBridge, FeedBridge } from './bridges.js'

    function apply(ctx) {
      hostSync.ctx = ctx
      const dsh = createDsh(ctx)
      hostSync.setSwitcher((sessionId) => dsh.switchSession(sessionId))
      hostSync.setNewSessioner(() => dsh.newSession())

      // The Question mirror is optional; a host without uiSession still mounts.
      dsh.bindQuestions((uiSession) => {
        hostSync.uiSession = uiSession
        hostSync.bindQuestions()
      })

      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'quick-panel: dictionaries')
      const t = ctx.locale.bind(NS)
      ctx.effect(() => {
        void hostSync.init()
        return () => hostSync.dispose()
      }, 'quick-panel: host sync')

      ctx.slots.inject('shell.overlay', () =>
        ctx.slots.register({ name: 'shell.overlay', id: 'quick-panel', order: 900 }, (props) =>
          h(Overlay, {
            ...props,
            t,
            schedule: () => dsh.schedule(),
            openSchedule: () => dsh.openSchedule(),
            loadOlder: () => dsh.loadOlder(store.state.sessionId),
            sendPrompt: (text, mode) => dsh.sendPrompt(store.state.sessionId, text, mode),
            stopTurn: () => dsh.stopTurn(store.state.sessionId),
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
