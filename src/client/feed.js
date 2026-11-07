import { React, h, useEffect, useLayoutEffect, useRef, useState } from './runtime.js'
import { HOST_ROUTE } from './constants.js'
import { contentText, codeSegments, timeLabel } from './text.js'
import { hostSync } from './session.js'

    function AssistantBlockView({ block, t, streaming }) {
      if (!block) return null
      if (block.kind === 'reasoning') {
        return h(
          'div',
          { className: 'qp-reasoning' },
          h('div', { className: 'qp-reasoning-label' }, t('reasoning')),
          h('div', { className: 'qp-reasoning-text' }, block.text || ''),
        )
      }
      if (block.kind === 'tool-call') {
        return h(
          'div',
          { className: 'qp-tool-chip' },
          h('span', { className: 'qp-tool-dot' }),
          h('span', { className: 'qp-tool-name' }, block.name || t('tool')),
        )
      }
      if (block.kind === 'image') {
        return h('div', { className: 'qp-feed-note' }, t('imageOnly'))
      }
      if (block.kind === 'text') {
        const segments = codeSegments(block.text || '')
        return h(
          'div',
          { className: 'qp-feed-text' },
          segments.map((segment, index) =>
            segment.type === 'code'
              ? h(
                  'div',
                  { key: `c${index}`, className: 'qp-code' },
                  h('div', { className: 'qp-code-head' }, segment.lang || 'code'),
                  h('pre', null, segment.text),
                )
              : h('span', { key: `t${index}` }, segment.text),
          ),
          streaming ? h('span', { className: 'qp-caret' }) : null,
        )
      }
      return null
    }

    function hostAttachmentSrc(attachment) {
      const id =
        attachment && typeof attachment.attachmentId === 'string' ? attachment.attachmentId : ''
      if (!id) return ''
      const injected = window.__QUICK_PANEL_CONFIG__
      const token =
        (injected && typeof injected.token === 'string' && injected.token) || hostSync.token || ''
      if (!token) return ''
      return `${HOST_ROUTE}/attachment?id=${encodeURIComponent(id)}&token=${encodeURIComponent(token)}`
    }

    const FeedImage = React.memo(function FeedImage({ attachment, t }) {
      const source = hostAttachmentSrc(attachment)
      const [attempt, setAttempt] = useState(0)
      const [failed, setFailed] = useState(false)
      if (!source || failed) {
        return h('span', { className: 'qp-feed-image-tag' }, t('imageOnly'))
      }
      return h('img', {
        className: 'qp-feed-image',
        src: attempt ? `${source}&retry=${attempt}` : source,
        alt: t('imageOnly'),
        loading: 'lazy',
        decoding: 'async',
        onError: () => {
          if (attempt < 2) {
            window.setTimeout(() => setAttempt(attempt + 1), 500)
          } else {
            setFailed(true)
          }
        },
      })
    })

    const FeedRow = React.memo(function FeedRow({ node, t }) {
      if (!node) return null
      const metaTime = timeLabel(node.time)
      if (node.kind === 'user' || node.kind === 'steering') {
        const text = contentText(node.content)
        const images = Array.isArray(node.content)
          ? node.content
              .filter(
                (block) =>
                  block &&
                  (block.type === 'image' || block.kind === 'image') &&
                  block.attachment &&
                  typeof block.attachment === 'object',
              )
              .slice(0, 4)
          : []
        const hasImage =
          images.length > 0 ||
          (Array.isArray(node.content) &&
            node.content.some((block) => block && (block.type === 'image' || block.kind === 'image')))
        return h(
          'div',
          { className: `qp-feed-row${node.kind === 'steering' ? ' is-steering' : ' is-user'}` },
          h(
            'div',
            { className: 'qp-feed-meta' },
            `${node.kind === 'steering' ? t('steering') : t('you')} · ${metaTime}`,
          ),
          images.length
            ? h(
                'div',
                { className: 'qp-feed-images' },
                images.map((block, index) =>
                  h(FeedImage, { key: index, attachment: block.attachment, t }),
                ),
              )
            : hasImage
              ? h('span', { className: 'qp-feed-image-tag' }, t('imageOnly'))
              : null,
          h('div', { className: 'qp-feed-body' }, text || (hasImage ? '' : t('nonText'))),
        )
      }
      if (node.kind === 'assistant') {
        const blocks = Array.isArray(node.blocks) ? node.blocks : []
        return h(
          'div',
          { className: 'qp-feed-row is-assistant' },
          h(
            'div',
            { className: 'qp-feed-meta' },
            `DSH · ${metaTime}${node.interrupted ? ` · ${t('interrupted')}` : ''}`,
          ),
          blocks.map((block, index) =>
            h(AssistantBlockView, { key: index, block, t, streaming: false }),
          ),
        )
      }
      if (node.kind === 'tool-result') {
        return h(
          'div',
          { className: `qp-tool-chip is-result${node.isError ? ' is-error' : ''}` },
          h('span', { className: 'qp-tool-dot' }),
          h(
            'span',
            null,
            `${node.name || t('tool')} · ${node.isError ? t('toolFailed') : t('toolDone')}`,
          ),
        )
      }
      if (node.kind === 'turn-error') {
        return h(
          'div',
          { className: 'qp-feed-row is-error' },
          h('div', { className: 'qp-feed-meta' }, `DSH · ${metaTime}`),
          h('div', { className: 'qp-feed-error' }, node.message || node.code || t('toolFailed')),
        )
      }
      return null
    })

    function FeedSection({ t, state, onLoadOlder, followTick }) {
      const feed = Array.isArray(state.feed) ? state.feed : []
      const partial = state.partial || null
      const connected = Boolean(state.sessionId)
      const feedRef = useRef(null)
      const contentRef = useRef(null)
      const pinnedRef = useRef(true)
      const anchorRef = useRef(null)
      const userScrollRef = useRef(false)
      const userTimer = useRef(0)
      const followTimer = useRef(0)
      const lastTopRef = useRef(0)
      const [following, setFollowing] = useState(true)

      const scrollToBottom = () => {
        const element = feedRef.current
        if (!element) return
        element.scrollTop = element.scrollHeight
        window.requestAnimationFrame(() => {
          const current = feedRef.current
          if (current) current.scrollTop = current.scrollHeight
        })
        if (followTimer.current) window.clearTimeout(followTimer.current)
        followTimer.current = window.setTimeout(() => {
          followTimer.current = 0
          if (!pinnedRef.current) return
          const current = feedRef.current
          if (current) current.scrollTop = current.scrollHeight
        }, 180)
        if (!pinnedRef.current) {
          pinnedRef.current = true
          setFollowing(true)
        }
      }

      useEffect(() => {
        if (pinnedRef.current) scrollToBottom()
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [feed, partial])

      useEffect(() => {
        scrollToBottom()
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [followTick])

      useEffect(
        () => () => {
          if (userTimer.current) window.clearTimeout(userTimer.current)
          if (followTimer.current) window.clearTimeout(followTimer.current)
        },
        [],
      )

      useLayoutEffect(() => {
        const element = feedRef.current
        if (!element) return
        if (anchorRef.current) {
          element.scrollTop += element.scrollHeight - anchorRef.current.height
          anchorRef.current = null
        }
      }, [feed.length])

      useEffect(() => {
        if (!state.loadingOlder && anchorRef.current) anchorRef.current = null
      }, [state.loadingOlder])

      useEffect(() => {
        const element = feedRef.current
        const content = contentRef.current
        if (!element || !content || typeof window.ResizeObserver === 'undefined') return
        const observer = new window.ResizeObserver(() => {
          if (pinnedRef.current) element.scrollTop = element.scrollHeight
        })
        observer.observe(content)
        return () => observer.disconnect()
      }, [])

      const markUserScroll = () => {
        userScrollRef.current = true
        if (userTimer.current) window.clearTimeout(userTimer.current)
        userTimer.current = window.setTimeout(() => {
          userScrollRef.current = false
        }, 220)
      }

      const onScroll = () => {
        const element = feedRef.current
        if (!element) return
        const top = element.scrollTop
        const delta = top - lastTopRef.current
        lastTopRef.current = top
        if (!userScrollRef.current && delta < -2) markUserScroll()
        const distance = element.scrollHeight - top - element.clientHeight
        if (userScrollRef.current) {
          const next = distance < 28
          pinnedRef.current = next
          setFollowing(next)
        } else if (distance < 28 && !pinnedRef.current) {
          pinnedRef.current = true
          setFollowing(true)
        }
        if (element.scrollTop < 40 && state.hasMore && !state.loadingOlder && !anchorRef.current) {
          anchorRef.current = { height: element.scrollHeight }
          onLoadOlder()
        }
      }

      return h(
        'section',
        { className: 'qp-section qp-feed-section' },
        h(
          'div',
          { className: 'qp-section-title' },
          h('span', null, t('live')),
          h(
            'span',
            { className: 'qp-count' },
            state.running ? t('running') : connected ? t('idle') : '',
          ),
        ),
        connected
          ? h(
              React.Fragment,
              null,
              h(
                'div',
                {
                  className: 'qp-feed',
                  ref: feedRef,
                  onScroll,
                  onWheel: markUserScroll,
                  onTouchMove: markUserScroll,
                  onPointerDown: markUserScroll,
                },
                state.hasMore
                  ? h(
                      'div',
                      { className: 'qp-feed-more' },
                      state.loadingOlder ? t('loadingOlder') : t('scrollOlder'),
                    )
                  : feed.length
                    ? h('div', { className: 'qp-feed-more' }, t('oldest'))
                    : null,
                h(
                  'div',
                  { className: 'qp-feed-content', ref: contentRef },
                  feed.length === 0 && !partial
                    ? h('div', { className: 'qp-feed-note' }, t('feedEmpty'))
                    : feed.map((node) => h(FeedRow, { key: `${node.kind}:${node.seq}`, node, t })),
                  partial
                    ? h(
                        'div',
                        { className: 'qp-feed-row is-assistant is-streaming' },
                        h('div', { className: 'qp-feed-meta' }, `DSH · ${t('streaming')}`),
                        (partial.blocks || []).map((block, index) =>
                          h(AssistantBlockView, {
                            key: index,
                            block,
                            t,
                            streaming: index === (partial.blocks || []).length - 1,
                          }),
                        ),
                      )
                    : state.running
                      ? h(
                          'div',
                          { className: 'qp-feed-status' },
                          h('span', { className: 'qp-feed-dot' }),
                          t('thinking'),
                        )
                      : null,
                ),
              ),
              !following
                ? h(
                    'button',
                    {
                      type: 'button',
                      className: 'qp-feed-jump',
                      onClick: scrollToBottom,
                      title: t('jumpLatest'),
                    },
                    t('jumpLatest'),
                  )
                : null,
            )
          : h('div', { className: 'qp-placeholder' }, t('feedNoSession')),
      )
    }


export { AssistantBlockView, hostAttachmentSrc, FeedImage, FeedRow, FeedSection }
