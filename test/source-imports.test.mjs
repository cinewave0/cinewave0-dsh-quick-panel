/**
 * Guards the module split: every identifier a source file uses from another
 * source module must be imported explicitly. Catches a moved function that
 * still references a name left behind in another module.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const root = new URL('../src/client/', import.meta.url)
const modules = [
  'constants', 'locales', 'styles', 'icons', 'hooks', 'text', 'notify', 'session',
  'overlay', 'sections', 'feed', 'input', 'panel', 'bridges',
]

const exportsOf = {}
for (const name of modules) {
  const source = readFileSync(new URL(`${name}.js`, root), 'utf8')
  const match = source.match(/export \{ ([^}]+) \}/u)
  exportsOf[name] = match ? match[1].split(',').map((item) => item.trim()) : []
}

function unresolved(file, self) {
  const source = readFileSync(new URL(file, root), 'utf8')
  const importLines = (source.match(/^import .*$/gmu) || []).join('\n')
  const body = source
    .split('\n')
    .filter((line) => !line.startsWith('import '))
    .join('\n')
  const problems = []
  for (const [module, names] of Object.entries(exportsOf)) {
    if (module === self) continue
    for (const name of names) {
      const used = new RegExp(`\\b${name}\\b`, 'u').test(body)
      const imported = new RegExp(`\\b${name}\\b`, 'u').test(importLines)
      if (used && !imported) problems.push(`${name} (from ${module})`)
    }
  }
  return problems
}

test('source modules only use explicitly imported names', () => {
  const reports = []
  const runtimeNames = ['React', 'h', 'useEffect', 'useLayoutEffect', 'useRef', 'useState', 'useSyncExternalStore']
  const runtimeProblems = []
  const checkRuntime = (file, source) => {
    const importLines = (source.match(/^import .*$/gmu) || []).join('\n')
    const body = source
      .split('\n')
      .filter((line) => !line.startsWith('import '))
      .join('\n')
    for (const name of runtimeNames) {
      const used = new RegExp(`\\b${name}\\b`, 'u').test(body)
      const imported = new RegExp(`\\b${name}\\b`, 'u').test(importLines)
      if (used && !imported) runtimeProblems.push(`${file}: ${name}`)
    }
  }
  for (const module of modules) {
    const source = readFileSync(new URL(`${module}.js`, root), 'utf8')
    checkRuntime(`${module}.js`, source)
  }
  checkRuntime('main.js', readFileSync(new URL('main.js', root), 'utf8'))
  if (runtimeProblems.length > 0) reports.push(`runtime imports: ${runtimeProblems.join(', ')}`)

  const mainProblems = unresolved('main.js', 'main')
  if (mainProblems.length > 0) reports.push(`main.js: ${mainProblems.join(', ')}`)
  for (const module of modules) {
    const problems = unresolved(`${module}.js`, module)
    if (problems.length > 0) reports.push(`${module}.js: ${problems.join(', ')}`)
  }
  assert.deepEqual(reports, [])
})
