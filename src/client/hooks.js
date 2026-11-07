import { React, h, useEffect, useState } from './runtime.js'

    function useNow(interval) {
      const [now, setNow] = React.useState(() => Date.now())
      useEffect(() => {
        const timer = window.setInterval(() => setNow(Date.now()), interval)
        return () => window.clearInterval(timer)
      }, [interval])
      return now
    }

    function useViewport() {
      const [viewport, setViewport] = useState(() => ({
        w: window.innerWidth,
        h: window.innerHeight,
      }))
      useEffect(() => {
        const onResize = () => setViewport({ w: window.innerWidth, h: window.innerHeight })
        window.addEventListener('resize', onResize)
        return () => window.removeEventListener('resize', onResize)
      }, [])
      return viewport
    }

    function clockOf(now) {
      const date = new Date(now)
      const pad = (value) => String(value).padStart(2, '0')
      let label
      try {
        label = new Intl.DateTimeFormat(undefined, {
          month: 'long',
          day: 'numeric',
          weekday: 'long',
        }).format(date)
      } catch (_error) {
        label = date.toDateString()
      }
      return {
        hh: pad(date.getHours()),
        mm: pad(date.getMinutes()),
        ss: pad(date.getSeconds()),
        date: label,
      }
    }

    // -------------------------------------------------------------- overlay


export { useNow, useViewport, clockOf }
