import assert from 'node:assert/strict'
import test from 'node:test'
import { createDsh } from '../src/client/dsh.js'

test('missing services degrade every action instead of throwing', async () => {
  const dsh = createDsh({ get: () => undefined, inject: () => {} })
  assert.equal(dsh.schedule(), null)
  assert.doesNotThrow(() => dsh.openSchedule())
  assert.doesNotThrow(() => dsh.loadOlder('session-x'))
  assert.deepEqual(await dsh.sendPrompt('session-x', 'hi', 'normal'), { ok: false })
  assert.deepEqual(await dsh.stopTurn('session-x'), { ok: false })
  assert.equal(dsh.switchSession('session-x'), false)
  assert.equal(dsh.switchSession(''), false)
  assert.equal(dsh.newSession(), false)

  let bound = 'unset'
  dsh.bindQuestions((uiSession) => {
    bound = uiSession
  })
  // A host whose inject never resolves the optional service simply never calls back.
  assert.equal(bound, 'unset')

  assert.deepEqual(dsh.capabilities(), { sessions: false, layout: false, schedule: false })
})

test('throwing host services are treated as missing', async () => {
  const dsh = createDsh({
    get: () => {
      throw new Error('host changed')
    },
    inject: () => {
      throw new Error('no uiSession')
    },
  })
  assert.equal(dsh.schedule(), null)
  assert.doesNotThrow(() => dsh.openSchedule())
  assert.deepEqual(await dsh.sendPrompt('session-x', 'hi', 'normal'), { ok: false })
  assert.equal(dsh.switchSession('session-x'), false)
  assert.equal(dsh.newSession(), false)
  let bound = 'unset'
  dsh.bindQuestions((uiSession) => {
    bound = uiSession
  })
  assert.equal(bound, null)
})

test('working services receive the expected calls', async () => {
  const calls = []
  const session = {
    beginSubmission(args) {
      calls.push(['begin', args])
      return { requestId: 'request-1' }
    },
    prompt(content, mode, _unused, requestId) {
      calls.push(['prompt', content, mode, requestId])
      return Promise.resolve({ ok: true })
    },
    loadOlder() {
      calls.push(['older'])
      return Promise.resolve()
    },
    cancel() {
      calls.push(['cancel'])
      return Promise.resolve({ ok: true })
    },
  }
  const ctx = {
    get(name) {
      if (name === 'sessions') return { binding: () => ({ session }) }
      if (name === 'layout') return { selectPanel: (id) => calls.push(['panel', id]) }
      if (name === 'uiWorkspace') {
        return {
          openSession: (id) => calls.push(['switch', id]),
          startSession: () => calls.push(['new']),
        }
      }
      if (name === 'remote') return { schedule: { id: 'schedule-remote' } }
      return undefined
    },
    inject(services, callback) {
      assert.deepEqual([...services], ['uiSession'])
      callback({ uiSession: { tag: 'ui' } })
    },
  }

  const dsh = createDsh(ctx)
  assert.deepEqual(dsh.capabilities(), { sessions: true, layout: true, schedule: true })
  assert.deepEqual(dsh.schedule(), { id: 'schedule-remote' })
  dsh.openSchedule()
  assert.equal(dsh.switchSession('session-y'), true)
  assert.equal(dsh.newSession(), true)
  dsh.loadOlder('session-x')
  assert.deepEqual(await dsh.sendPrompt('session-x', 'hello', 'normal'), { ok: true })
  assert.deepEqual(await dsh.stopTurn('session-x'), { ok: true })

  let bound = null
  dsh.bindQuestions((uiSession) => {
    bound = uiSession
  })
  assert.deepEqual(bound, { tag: 'ui' })

  assert.deepEqual(calls, [
    ['panel', 'schedules'],
    ['switch', 'session-y'],
    ['new'],
    ['older'],
    ['begin', { mode: 'normal', text: 'hello', attachments: [] }],
    ['prompt', [{ type: 'text', text: 'hello' }], 'normal', 'request-1'],
    ['cancel'],
  ])
})

test('a failing beginSubmission still sends the prompt', async () => {
  const session = {
    beginSubmission() {
      throw new Error('submission unavailable')
    },
    prompt(_content, _mode, _unused, requestId) {
      return Promise.resolve({ ok: true, requestId })
    },
  }
  const dsh = createDsh({
    get(name) {
      return name === 'sessions' ? { binding: () => ({ session }) } : undefined
    },
    inject() {},
  })
  assert.deepEqual(await dsh.sendPrompt('session-x', 'hi', 'steering'), { ok: true, requestId: undefined })
})
