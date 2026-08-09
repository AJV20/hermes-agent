import { useEffect, useState } from 'react'

import { HERMES_PWA_UPDATE_READY_EVENT } from '../pwa'
import { syncMobileViewportHeight } from './mobile-viewport'

export function useMobileViewportSync() {
  useEffect(() => {
    const timers: number[] = []
    const frames: number[] = []
    const sync = () => {
      syncMobileViewportHeight()
      void document.documentElement.offsetHeight
    }
    const settle = () => {
      sync()
      frames.push(window.requestAnimationFrame(sync))
      timers.push(window.setTimeout(sync, 100), window.setTimeout(sync, 300))
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') settle()
    }

    settle()
    window.addEventListener('resize', sync)
    window.addEventListener('orientationchange', settle)
    window.addEventListener('pageshow', settle)
    window.visualViewport?.addEventListener('resize', sync)
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      window.removeEventListener('resize', sync)
      window.removeEventListener('orientationchange', settle)
      window.removeEventListener('pageshow', settle)
      window.visualViewport?.removeEventListener('resize', sync)
      document.removeEventListener('visibilitychange', onVisibility)
      frames.forEach((frame) => window.cancelAnimationFrame(frame))
      timers.forEach((timer) => window.clearTimeout(timer))
    }
  }, [])
}

export function usePwaUpdateReady(): [boolean, () => void] {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const onReady = () => setReady(true)
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === 'HERMES_PWA_UPDATE_READY') setReady(true)
    }
    window.addEventListener(HERMES_PWA_UPDATE_READY_EVENT, onReady)
    navigator.serviceWorker?.addEventListener('message', onMessage)
    return () => {
      window.removeEventListener(HERMES_PWA_UPDATE_READY_EVENT, onReady)
      navigator.serviceWorker?.removeEventListener('message', onMessage)
    }
  }, [])
  return [ready, () => setReady(false)]
}
