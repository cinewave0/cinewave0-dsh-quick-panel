import { readFileSync, writeFileSync } from 'node:fs'

const file = 'src/client/main.js'
const lines = readFileSync(file, 'utf8').split('\n')

const header = "import { React, h, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from './runtime.js'\n\n"

const blocks = [
  {
    name: 'icons',
    start: 1075,
    end: 1290,
    exports: ['IconPanel', 'IconGrip', 'IconWindow', 'IconChevronDown', 'IconChevronRight', 'IconCheck', 'IconBell', 'IconPlus', 'IconCopy', 'IconTrash', 'IconSend', 'IconStop'],
  },
  {
    name: 'hooks',
    start: 1291,
    end: 1335,
    exports: ['useNow', 'useViewport', 'clockOf'],
  },
  {
    name: 'text',
    start: 915,
    end: 1074,
    exports: ['formatDuration', 'contentText', 'latestText', 'hostLiveBlocks', 'userImageRefs', 'hostLiveRow', 'hostLivePartial', 'codeSegments', 'timeLabel', 'buildHandoff'],
  },
  {
    name: 'notify',
    start: 748,
    end: 914,
    exports: ['ensureNotifyPermission', 'notifyAsked', 'maybeEnsureNotifyPermission', 'audioContext', 'audioKeepAlive', 'ensureAudio', 'playChimeContext', 'chimeUrls', 'chimeUrlFor', 'activeAudio', 'playChime', 'showNotification'],
  },
]

for (const block of blocks) {
  const body = lines.slice(block.start - 1, block.end).join('\n')
  writeFileSync(`src/client/${block.name}.js`, `${header}${body}\n\nexport { ${block.exports.join(', ')} }\n`)
}

const ranges = blocks.map((block) => [block.start, block.end]).sort((a, b) => b[0] - a[0])
for (const [start, end] of ranges) lines.splice(start - 1, end - start + 1)

const imports = [
  "import { IconPanel, IconGrip, IconWindow, IconChevronDown, IconChevronRight, IconCheck, IconBell, IconPlus, IconCopy, IconTrash, IconSend, IconStop } from './icons.js'",
  "import { useNow, useViewport, clockOf } from './hooks.js'",
  "import { formatDuration, contentText, latestText, hostLiveBlocks, userImageRefs, hostLiveRow, hostLivePartial, codeSegments, timeLabel, buildHandoff } from './text.js'",
  "import { ensureNotifyPermission, maybeEnsureNotifyPermission, ensureAudio, playChime, showNotification } from './notify.js'",
].join('\n')

const text = lines.join('\n').replace(/(import \{ CSS \} from '\.\/styles\.js'\n)/u, `$1${imports}\n`)
writeFileSync(file, text)
console.log('split done')
