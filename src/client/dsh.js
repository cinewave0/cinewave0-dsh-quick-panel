/**
 * Capability-safe adapter for the DSH client services the panel uses.
 *
 * DSH's client API is a moving target: `sessions`, `layout`, the schedule
 * remote and `uiSession` are optional from the panel's point of view. Every
 * access here is guarded, and a missing or throwing service degrades a single
 * action instead of taking the whole panel down.
 */
export function createDsh(ctx) {
  const get = (name) => {
    try {
      return ctx.get(name) ?? null
    } catch (_error) {
      return null
    }
  }

  const sessionOf = (sessionId) => {
    if (!sessionId) return null
    const sessions = get('sessions')
    if (!sessions || typeof sessions.binding !== 'function') return null
    try {
      const binding = sessions.binding(sessionId)
      return binding && binding.session ? binding.session : null
    } catch (_error) {
      return null
    }
  }

  return {
    /** Which optional host services exist right now. Useful for diagnostics. */
    capabilities() {
      return {
        sessions: get('sessions') !== null,
        layout: get('layout') !== null,
        schedule: this.schedule() !== null,
      }
    },

    schedule() {
      const direct = get('remote.schedule')
      if (direct) return direct
      const remote = get('remote')
      return remote && remote.schedule ? remote.schedule : null
    },

    openSchedule() {
      const layout = get('layout')
      if (!layout || typeof layout.selectPanel !== 'function') return
      try {
        layout.selectPanel('schedules')
      } catch (_error) {
        /* the Automation tasks panel may be unavailable */
      }
    },

    loadOlder(sessionId) {
      const session = sessionOf(sessionId)
      if (!session || typeof session.loadOlder !== 'function') return
      try {
        const result = session.loadOlder()
        if (result && typeof result.catch === 'function') result.catch(() => {})
      } catch (_error) {
        /* paging is best effort */
      }
    },

    async sendPrompt(sessionId, text, mode) {
      const session = sessionOf(sessionId)
      if (!session || typeof session.prompt !== 'function') return { ok: false }
      let handle = null
      try {
        handle = session.beginSubmission({ mode, text, attachments: [] })
      } catch (_error) {
        handle = null
      }
      try {
        return await session.prompt([{ type: 'text', text }], mode, undefined, handle ? handle.requestId : undefined)
      } catch (error) {
        if (handle && typeof handle.abandon === 'function') {
          try {
            handle.abandon()
          } catch (_error) {
            /* already abandoned */
          }
        }
        return { ok: false, error }
      }
    },

    async stopTurn(sessionId) {
      const session = sessionOf(sessionId)
      if (!session || typeof session.cancel !== 'function') return { ok: false }
      try {
        return await session.cancel()
      } catch (error) {
        return { ok: false, error }
      }
    },

    /**
     * Binds the optional Question mirror. The callback still runs with `null`
     * when the host has no `uiSession`, so callers can reset their state.
     */
    bindQuestions(onReady) {
      try {
        ctx.inject(['uiSession'], (uiCtx) => {
          onReady(uiCtx && uiCtx.uiSession ? uiCtx.uiSession : null)
        })
      } catch (_error) {
        onReady(null)
      }
    },
  }
}
