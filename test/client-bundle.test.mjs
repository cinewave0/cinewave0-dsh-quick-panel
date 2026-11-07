/**
 * Loads the built client.js in a VM and checks the DSH module envelope.
 * Run with: node test/client-bundle.test.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const code = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
let captured = null

const context = {
  console,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  queueMicrotask,
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  navigator: { userAgent: 'node' },
  fetch: async () => ({ ok: true, json: async () => ({}), text: async () => '' }),
  CustomEvent: class {},
  MutationObserver: class {
    observe() {}
    disconnect() {}
  },
  matchMedia: () => ({ matches: false, addEventListener() {} }),
  requestAnimationFrame: (fn) => setTimeout(fn, 0),
  document: {
    head: { appendChild() {} },
    body: { appendChild() {} },
    createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, remove() {} }),
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
    removeEventListener() {},
  },
  __ModuleLoader__: {
    load(config) {
      captured = config
    },
  },
}
context.window = context
context.globalThis = context
context.addEventListener = () => {}
context.removeEventListener = () => {}
vm.createContext(context)
vm.runInContext(code, context, { filename: 'client.js' })

assert.ok(captured, 'ModuleLoader.load was not called')
assert.equal(captured.id, 'dsh-quick-panel')
assert.equal(typeof captured.factory, 'function')

const react = new Proxy(
  {
    createElement: () => ({}),
    Fragment: 'fragment',
    useState: () => [undefined, () => {}],
    useEffect: () => {},
    useLayoutEffect: () => {},
    useRef: () => ({ current: null }),
    useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
  },
  { get: (target, key) => (key in target ? target[key] : () => undefined) },
)

const module = captured.factory((name) => {
  if (name === 'react') return react
  throw new Error(`unexpected require: ${name}`)
})

assert.deepEqual([...module.inject], ['slots', 'locale'])
assert.equal(typeof module.apply, 'function')
assert.ok(!('__qpReact' in context), 'runtime React binding leaked')
console.log('client bundle ok: inject', module.inject.join(','))
