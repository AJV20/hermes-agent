import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { buildServiceWorkerUrl } from './pwa'

describe('PWA mobile shell', () => {
  it('disables browser viewport zooming while retaining the mobile safe-area viewport', () => {
    for (const documentUrl of [new URL('../index.html', import.meta.url), new URL('../public/offline.html', import.meta.url)]) {
      const html = readFileSync(documentUrl, 'utf8')
      const viewport = html.match(/<meta\s+name="viewport"\s+content="([^"]+)"/s)?.[1]

      expect(viewport).toContain('viewport-fit=cover')
      expect(viewport).toContain('maximum-scale=1')
      expect(viewport).toContain('user-scalable=no')
    }
  })

  it('allows iPad installations to rotate between portrait and landscape', () => {
    const manifest = JSON.parse(readFileSync(new URL('../public/manifest.webmanifest', import.meta.url), 'utf8')) as {
      orientation?: string
    }

    expect(manifest.orientation).toBe('any')
  })

  it('versions the service-worker URL from the current hashed app bundle', () => {
    expect(buildServiceWorkerUrl('', '/assets/index-CtC5HFVK.js')).toBe(
      '/sw.js?v=index-CtC5HFVK.js',
    )
    expect(buildServiceWorkerUrl('/dashboard', '/dashboard/assets/index-AbC123.js')).toBe(
      '/dashboard/sw.js?v=index-AbC123.js',
    )
  })

  it('waits for an explicit client handshake before activating a new worker', () => {
    const worker = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8')

    expect(worker).toContain('event.data?.type === "SKIP_WAITING"')
    expect(worker).toContain('self.skipWaiting()')
    expect(worker).not.toContain('self.skipWaiting();\n  event.waitUntil')
    expect(worker).not.toContain('client.navigate(client.url)')
  })

  it('does not cache HTML or authenticated and realtime traffic', () => {
    const worker = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8')

    expect(worker).toContain('if (request.destination === "document") return false;')
    expect(worker).toContain('if (request.headers.get("accept")?.includes("text/html")) return false;')
    expect(worker).toContain('pathname === "/index.html"')
    expect(worker).toContain('pathname === "/auth" || pathname.startsWith("/auth/")')
    expect(worker).toContain('request.headers.get("upgrade")?.toLowerCase() === "websocket"')
    expect(worker).toContain('!response.headers.get("content-type")?.toLowerCase().includes("text/html")')
  })

  it('falls back to a credential-free offline document only when a navigation fetch fails', () => {
    const worker = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8')
    const offlineUrl = new URL('../public/offline.html', import.meta.url)

    expect(existsSync(offlineUrl)).toBe(true)
    const offlineDocument = readFileSync(offlineUrl, 'utf8')
    expect(offlineDocument).toContain('<title>Hermes is offline</title>')
    expect(offlineDocument).not.toMatch(/token|cookie|authorization|session/i)

    expect(worker).toContain('const HERMES_OFFLINE_URL = new URL("offline.html", self.registration.scope).toString();')
    expect(worker).toContain('await cache.add(HERMES_OFFLINE_URL);')
    expect(worker).toContain('if (request.mode === "navigate") {')
    expect(worker).toContain('event.respondWith(fetch(request).catch(async () => {')
    expect(worker).toContain('cache.match(HERMES_OFFLINE_URL)')
    expect(worker).toContain('if (pathname === "/api" || pathname.startsWith("/api/")) return false;')
  })
})
