import { React, h, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from './runtime.js'

    function formatDuration(ms) {
      const total = Math.max(0, Math.floor(ms / 1000))
      return `${pad2(Math.floor(total / 60))}:${pad2(total % 60)}`
    }

    function contentText(content) {
      if (!Array.isArray(content)) return ''
      return content
        .map((block) => {
          if (!block) return ''
          if (typeof block === 'string') return block
          if (block.type === 'text' && typeof block.text === 'string') return block.text
          if (typeof block.text === 'string' && block.text) return block.text
          return ''
        })
        .filter(Boolean)
        .join('\n')
    }

    function latestText(nodes, partial) {
      if (partial && Array.isArray(partial.blocks)) {
        for (let index = partial.blocks.length - 1; index >= 0; index -= 1) {
          const block = partial.blocks[index]
          if (block && block.kind === 'text' && block.text && block.text.trim()) return block.text.trim()
        }
        for (let index = partial.blocks.length - 1; index >= 0; index -= 1) {
          const block = partial.blocks[index]
          if (block && block.kind === 'reasoning' && block.text && block.text.trim()) {
            return block.text.trim()
          }
        }
      }
      if (!Array.isArray(nodes)) return ''
      for (let index = nodes.length - 1; index >= 0; index -= 1) {
        const node = nodes[index]
        if (!node) continue
        if (node.kind === 'assistant' && Array.isArray(node.blocks)) {
          for (let blockIndex = node.blocks.length - 1; blockIndex >= 0; blockIndex -= 1) {
            const block = node.blocks[blockIndex]
            if (block && block.kind === 'text' && block.text && block.text.trim()) return block.text.trim()
          }
        }
        if (node.kind === 'user' || node.kind === 'steering') {
          const value = contentText(node.content)
          if (value.trim()) return value.trim()
        }
      }
      return ''
    }

    function hostLiveBlocks(blocks) {
      return (Array.isArray(blocks) ? blocks : []).slice(0, 16).map((block) => {
        const kind =
          block && block.kind === 'reasoning'
            ? 'reasoning'
            : block && block.kind === 'tool-call'
              ? 'tool-call'
              : block && block.kind === 'image'
                ? 'image'
                : 'text'
        return {
          kind,
          text: String((block && block.text) || '').slice(0, 4000),
          name: String((block && block.name) || '').slice(0, 200),
        }
      })
    }

    function userImageRefs(node) {
      if (!node || (node.kind !== 'user' && node.kind !== 'steering')) return []
      if (!Array.isArray(node.content)) return []
      return node.content
        .filter(
          (block) =>
            block &&
            (block.type === 'image' || block.kind === 'image') &&
            block.attachment &&
            typeof block.attachment === 'object',
        )
        .slice(0, 4)
        .map((block) => ({ ref: block.attachment }))
    }

    function hostLiveRow(node) {
      if (!node || typeof node !== 'object') return null
      if (node.kind === 'user' || node.kind === 'steering') {
        const images = userImageRefs(node)
        const hasImage =
          images.length > 0 ||
          (Array.isArray(node.content) &&
            node.content.some((block) => block && (block.type === 'image' || block.kind === 'image')))
        const row = {
          kind: node.kind,
          time: node.time,
          text: contentText(node.content).slice(0, 4000),
          hasImage,
        }
        if (images.length) row.images = images
        return row
      }
      if (node.kind === 'assistant') {
        return {
          kind: 'assistant',
          time: node.time,
          interrupted: Boolean(node.interrupted),
          blocks: hostLiveBlocks(node.blocks),
        }
      }
      if (node.kind === 'tool-result') {
        return {
          kind: 'tool-result',
          time: node.time,
          name: String(node.name || ''),
          isError: Boolean(node.isError),
        }
      }
      if (node.kind === 'turn-error') {
        return {
          kind: 'turn-error',
          time: node.time,
          message: String(node.message || node.code || '').slice(0, 2000),
        }
      }
      return null
    }

    function hostLivePartial(partial) {
      if (!partial) return null
      return { blocks: hostLiveBlocks(partial.blocks) }
    }

    function codeSegments(text) {
      const source = String(text || '')
      const segments = []
      const pattern = /```([^\n`]*)\n([\s\S]*?)```/g
      let last = 0
      let match
      while ((match = pattern.exec(source))) {
        if (match.index > last) segments.push({ type: 'text', text: source.slice(last, match.index) })
        segments.push({ type: 'code', lang: match[1].trim(), text: match[2] })
        last = match.index + match[0].length
      }
      if (last < source.length) segments.push({ type: 'text', text: source.slice(last) })
      return segments
    }

    function timeLabel(time) {
      const date = new Date(time || Date.now())
      return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`
    }

    function buildHandoff(t, todo) {
      const now = new Date()
      const pad = (value) => String(value).padStart(2, '0')
      const time = `${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`
      return String(t('handoffTemplate')).replace('{text}', todo.text).replace('{time}', time)
    }

    // ---------------------------------------------------------------- icons


export { formatDuration, contentText, latestText, hostLiveBlocks, userImageRefs, hostLiveRow, hostLivePartial, codeSegments, timeLabel, buildHandoff }
