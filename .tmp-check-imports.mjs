import { readFileSync, readdirSync } from 'node:fs'

const modules = ['icons', 'hooks', 'text', 'notify', 'constants', 'locales', 'styles']
const exportsOf = {}
for (const name of modules) {
  const source = readFileSync(`src/client/${name}.js`, 'utf8')
  const match = source.match(/export \{ ([^}]+) \}/)
  exportsOf[name] = match ? match[1].split(',').map((item) => item.trim()) : []
}

function check(file, target) {
  const source = readFileSync(file, 'utf8')
  const importLines = (source.match(/^import .*$/gmu) || []).join('\n')
  const body = source
    .split('\n')
    .filter((line) => !line.startsWith('import '))
    .join('\n')
  const problems = []
  for (const [module, names] of Object.entries(exportsOf)) {
    for (const name of names) {
      if (target === module) continue
      const used = new RegExp(`\\b${name}\\b`, 'u').test(body)
      const imported = new RegExp(`\\b${name}\\b`, 'u').test(importLines)
      if (used && !imported) problems.push(`${name} (from ${module})`)
    }
  }
  if (problems.length > 0) console.log(`${file}: ${problems.join(', ')}`)
  else console.log(`${file}: ok`)
}

check('src/client/main.js', 'main')
for (const module of modules) check(`src/client/${module}.js`, module)
