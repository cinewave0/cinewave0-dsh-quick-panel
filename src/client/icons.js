import { React, h, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from './runtime.js'

    function IconPanel({ size = 16 }) {
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.7,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
        },
        h('rect', { x: 3.5, y: 4.5, width: 17, height: 15, rx: 3 }),
        h('path', { d: 'M8 9.5h8M8 13h5.5' }),
        h('circle', { cx: 16.6, cy: 15.4, r: 1.6, fill: 'currentColor', stroke: 'none' }),
      )
    }

    function IconGrip() {
      return h(
        'svg',
        { width: 12, height: 12, viewBox: '0 0 12 12', fill: 'currentColor', 'aria-hidden': true },
        h('circle', { cx: 3, cy: 3, r: 1 }),
        h('circle', { cx: 9, cy: 3, r: 1 }),
        h('circle', { cx: 3, cy: 6, r: 1 }),
        h('circle', { cx: 9, cy: 6, r: 1 }),
        h('circle', { cx: 3, cy: 9, r: 1 }),
        h('circle', { cx: 9, cy: 9, r: 1 }),
      )
    }

    function IconWindow({ size = 15 }) {
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.8,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
        },
        h('rect', { x: 3.5, y: 5, width: 12, height: 12, rx: 2.5 }),
        h('path', { d: 'M13.5 10.5l5-5M14 5h4.5v4.5' }),
      )
    }

    function IconChevronDown({ size = 16 }) {
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.8,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
        },
        h('path', { d: 'M6 9.5l6 6 6-6' }),
      )
    }

    function IconChevronRight({ size = 14 }) {
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.8,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
        },
        h('path', { d: 'M9 5.5l6.5 6.5L9 18.5' }),
      )
    }

    function IconCheck({ size = 12 }) {
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 2.1,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
        },
        h('path', { d: 'M5 12.5l4.2 4.2L19 6.8' }),
      )
    }

    function IconBell({ size = 13 }) {
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.7,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
        },
        h('path', { d: 'M6 9.5a6 6 0 0 1 12 0c0 3.2.8 5 2 6.2H4c1.2-1.2 2-3 2-6.2z' }),
        h('path', { d: 'M10 18a2.2 2.2 0 0 0 4 0' }),
      )
    }

    function IconPlus({ size = 16 }) {
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 2,
          strokeLinecap: 'round',
          'aria-hidden': true,
        },
        h('path', { d: 'M12 5.5v13M5.5 12h13' }),
      )
    }

    function IconCopy({ size = 13 }) {
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.7,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
        },
        h('rect', { x: 9, y: 9, width: 10.5, height: 10.5, rx: 2.2 }),
        h('path', { d: 'M15 9V6.5A2.5 2.5 0 0 0 12.5 4H6.5A2.5 2.5 0 0 0 4 6.5v6A2.5 2.5 0 0 0 6.5 15H9' }),
      )
    }

    function IconTrash({ size = 13 }) {
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.7,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
        },
        h('path', { d: 'M4.5 7h15M9.5 7V5.5A1.5 1.5 0 0 1 11 4h2a1.5 1.5 0 0 1 1.5 1.5V7' }),
        h('path', { d: 'M6.5 7l.8 11.2A2 2 0 0 0 9.3 20h5.4a2 2 0 0 0 2-1.8L17.5 7' }),
        h('path', { d: 'M10 11v5M14 11v5' }),
      )
    }

    function IconSend({ size = 14 }) {
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.8,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
        },
        h('path', { d: 'M4.5 11.6l15-7-6.3 15-2.4-6.2-6.3-1.8z' }),
        h('path', { d: 'M10.8 13.4l4.3-4.2' }),
      )
    }

    function IconStop({ size = 11 }) {
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'currentColor',
          'aria-hidden': true,
        },
        h('rect', { x: 6.5, y: 6.5, width: 11, height: 11, rx: 2 }),
      )
    }

    // ---------------------------------------------------------------- hooks


export { IconPanel, IconGrip, IconWindow, IconChevronDown, IconChevronRight, IconCheck, IconBell, IconPlus, IconCopy, IconTrash, IconSend, IconStop }
