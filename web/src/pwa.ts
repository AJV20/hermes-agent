// Lightweight PWA bootstrap for the Hermes Dashboard.
//
// Important: the dashboard injects auth/session bootstrap data into
// index.html. The service worker intentionally does NOT cache navigation
// documents or /api responses so a Home Screen launch always receives a fresh
// token/cookie-gate state from the Python backend.

declare global {
  interface Window {
    __HERMES_BASE_PATH__?: string;
  }
}

const HERMES_PWA_UPDATE_READY_EVENT = 'hermes-pwa-update-ready'
const HERMES_PWA_UPDATE_ACCEPTED_EVENT = 'hermes-pwa-update-accepted'

function normalizeBasePath(raw: string | undefined): string {
  if (!raw) return ''
  const withLead = raw.startsWith('/') ? raw : `/${raw}`
  return withLead.replace(/\/+$/, '')
}

export function buildServiceWorkerUrl(basePath: string, scriptSrc: string): string {
  const revision = scriptSrc.split('/').pop() || 'app'
  return `${basePath}/sw.js?v=${encodeURIComponent(revision)}`
}

function announceWaitingWorker(registration: ServiceWorkerRegistration) {
  if (registration.waiting) {
    window.dispatchEvent(new Event(HERMES_PWA_UPDATE_READY_EVENT))
  }
}

export function registerHermesPwa(): void {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return

  const basePath = normalizeBasePath(window.__HERMES_BASE_PATH__)
  const moduleScript = Array.from(document.scripts).find(
    script => script.type === 'module' && script.src
  )
  const swUrl = buildServiceWorkerUrl(basePath, moduleScript?.src ?? 'app')
  const scope = basePath ? `${basePath}/` : '/'

  const register = () => {
    navigator.serviceWorker.register(swUrl, { scope }).then(registration => {
      announceWaitingWorker(registration)
      if (typeof registration.addEventListener === 'function') {
        registration.addEventListener('updatefound', () => {
          const installing = registration.installing
          if (!installing) return
          installing.addEventListener('statechange', () => {
            if (installing.state === 'installed') announceWaitingWorker(registration)
          })
        })
      }
    }).catch((error: unknown) => {
      // PWA support is a convenience layer. Never block the dashboard if a
      // browser, reverse proxy, or development server refuses registration.
      console.warn('[Hermes PWA] Service worker registration failed', error)
    })
  }

  if (document.readyState === 'complete') register()
  else window.addEventListener('load', register, { once: true })
}

/**
 * Accept a waiting release after the mobile shell has persisted its draft.
 * Reloading happens only once, and only after this client observes the new
 * controller. A missing waiting worker is a no-op, never a surprise reload.
 */
export async function requestHermesPwaUpdate(): Promise<boolean> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return false
  const registration = await navigator.serviceWorker.getRegistration()
  const waiting = registration?.waiting
  if (!waiting) return false

  let reloaded = false
  const onControllerChange = () => {
    if (reloaded) return
    reloaded = true
    navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange)
    window.location.reload()
  }
  navigator.serviceWorker.addEventListener('controllerchange', onControllerChange)
  window.dispatchEvent(new Event(HERMES_PWA_UPDATE_ACCEPTED_EVENT))
  waiting.postMessage({ type: 'SKIP_WAITING' })
  return true
}

export { HERMES_PWA_UPDATE_ACCEPTED_EVENT, HERMES_PWA_UPDATE_READY_EVENT }
