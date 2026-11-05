import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const owner = 'cinewave0'
const repo = 'cinewave0-dsh-quick-panel'
const commit = process.argv[2]
  ? process.argv[2].trim()
  : execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
if (!/^[0-9a-f]{40}$/.test(commit)) {
  throw new Error(`unexpected git commit: ${commit}`)
}

const index = {
  format: 1,
  title: {
    en: 'Quick Panel',
    zh: '快捷面板',
  },
  description: {
    en: 'Standalone quick panel for DSH: todos, reminders, live session view and quick input.',
    zh: 'DSH 独立快捷面板：待办、提醒、实时消息和快速输入。',
  },
  plugins: [
    {
      name: pkg.name,
      title: {
        en: 'Quick Panel',
        zh: '快捷面板',
      },
      description: {
        en: 'A standalone DSH companion window with todos, reminders, live messages, approvals and quick input.',
        zh: '带待办、提醒、实时消息、审批和快速输入的 DSH 独立伴生窗。',
      },
      author: owner,
      homepage: `https://github.com/${owner}/${repo}`,
      repository: {
        url: `https://github.com/${owner}/${repo}`,
      },
      icon: '../icon.svg',
      versions: [
        {
          version: pkg.version,
          publishTimestamp: Math.floor(Date.now() / 1000),
          source: {
            type: 'git',
            url: `https://github.com/${owner}/${repo}`,
            commit,
          },
          engines: {
            dsh: pkg.engines?.dsh || '>=0.2.2-rc.1 <0.3.0',
          },
        },
      ],
    },
  ],
}

mkdirSync(join(root, 'market'), { recursive: true })
writeFileSync(join(root, 'market', 'index.json'), `${JSON.stringify(index, null, 2)}\n`)
console.log(`market/index.json -> ${pkg.name}@${pkg.version} commit ${commit}`)
