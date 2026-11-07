
    function ensureNotifyPermission() {
      try {
        if (typeof window.Notification === 'undefined') return
        if (window.Notification.permission !== 'default') return
        const request = window.Notification.requestPermission()
        if (request && typeof request.catch === 'function') request.catch(() => {})
      } catch (_error) {
        /* notifications are optional */
      }
    }

    let notifyAsked = false
    function maybeEnsureNotifyPermission() {
      if (notifyAsked) return
      notifyAsked = true
      ensureNotifyPermission()
    }

    let audioContext = null
    let audioKeepAlive = false

    function ensureAudio() {
      try {
        const Ctor = window.AudioContext || window.webkitAudioContext
        if (!Ctor) return null
        if (!audioContext) audioContext = new Ctor()
        if (!audioKeepAlive) {
          const oscillator = audioContext.createOscillator()
          const gain = audioContext.createGain()
          gain.gain.value = 0.0001
          oscillator.connect(gain)
          gain.connect(audioContext.destination)
          oscillator.start()
          audioKeepAlive = true
        }
        if (audioContext.state === 'suspended') {
          const resumed = audioContext.resume()
          if (resumed && typeof resumed.catch === 'function') resumed.catch(() => {})
        }
        return audioContext
      } catch (_error) {
        return null
      }
    }

    async function playChimeContext(kind) {
      const context = ensureAudio()
      if (!context) return
      try {
        if (context.state === 'suspended') await context.resume()
      } catch (_error) {
        return
      }
      try {
        const start = context.currentTime + 0.02
        const notes = kind === 'reminder' ? [880, 1108.73, 1318.51] : [659.25, 880]
        notes.forEach((frequency, index) => {
          const oscillator = context.createOscillator()
          const gain = context.createGain()
          oscillator.type = 'sine'
          oscillator.frequency.value = frequency
          const at = start + index * 0.14
          gain.gain.setValueAtTime(0.0001, at)
          gain.gain.exponentialRampToValueAtTime(0.22, at + 0.02)
          gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.8)
          oscillator.connect(gain)
          gain.connect(context.destination)
          oscillator.start(at)
          oscillator.stop(at + 0.85)
        })
      } catch (_error) {
        /* audio is optional */
      }
    }

    const chimeUrls = new Map()

    function chimeUrlFor(kind) {
      if (chimeUrls.has(kind)) return chimeUrls.get(kind)
      const sampleRate = 22050
      const duration = 1
      const total = Math.floor(sampleRate * duration)
      const buffer = new ArrayBuffer(44 + total * 2)
      const view = new DataView(buffer)
      const writeText = (offset, text) => {
        for (let index = 0; index < text.length; index += 1) {
          view.setUint8(offset + index, text.charCodeAt(index))
        }
      }
      writeText(0, 'RIFF')
      view.setUint32(4, 36 + total * 2, true)
      writeText(8, 'WAVE')
      writeText(12, 'fmt ')
      view.setUint32(16, 16, true)
      view.setUint16(20, 1, true)
      view.setUint16(22, 1, true)
      view.setUint32(24, sampleRate, true)
      view.setUint32(28, sampleRate * 2, true)
      view.setUint16(32, 2, true)
      view.setUint16(34, 16, true)
      writeText(36, 'data')
      view.setUint32(40, total * 2, true)
      const notes = kind === 'reminder' ? [880, 1108.73, 1318.51] : [659.25, 880]
      for (let index = 0; index < total; index += 1) {
        const time = index / sampleRate
        let sample = 0
        notes.forEach((frequency, noteIndex) => {
          const local = time - noteIndex * 0.14
          if (local < 0 || local > 0.8) return
          const attack = Math.min(1, local / 0.02)
          sample += Math.sin(2 * Math.PI * frequency * local) * attack * Math.exp(-local * 5)
        })
        sample = Math.max(-1, Math.min(1, sample * 0.3))
        view.setInt16(44 + index * 2, Math.round(sample * 0x7fff), true)
      }
      const bytes = new Uint8Array(buffer)
      let binary = ''
      const chunk = 0x8000
      for (let index = 0; index < bytes.length; index += chunk) {
        binary += String.fromCharCode.apply(null, bytes.subarray(index, index + chunk))
      }
      const url = `data:audio/wav;base64,${window.btoa(binary)}`
      chimeUrls.set(kind, url)
      return url
    }

    let activeAudio = null

    function playChime(kind) {
      try {
        const audio = new window.Audio(chimeUrlFor(kind))
        audio.volume = 0.8
        if (activeAudio) {
          try {
            activeAudio.pause()
          } catch (_error) {
            /* ignore */
          }
        }
        activeAudio = audio
        const result = audio.play()
        if (result && typeof result.catch === 'function') {
          result.catch(() => playChimeContext(kind))
        }
      } catch (_error) {
        playChimeContext(kind)
      }
    }

    function showNotification(title, body, tag) {
      try {
        if (typeof window.Notification === 'undefined') return
        if (window.Notification.permission !== 'granted') return
        const notice = new window.Notification(title, { body, tag, silent: true })
        notice.onclick = () => {
          try {
            window.focus()
          } catch (_error) {
            /* focusing is best effort */
          }
          notice.close()
        }
      } catch (_error) {
        /* notifications are optional */
      }
    }


export { ensureNotifyPermission, notifyAsked, maybeEnsureNotifyPermission, audioContext, audioKeepAlive, ensureAudio, playChimeContext, chimeUrls, chimeUrlFor, activeAudio, playChime, showNotification }
