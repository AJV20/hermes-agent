import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { buildServiceWorkerUrl } from './pwa'

describe('PWA mobile shell', () => {
  it('disables viewport zooming in the installed mobile app', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
    const viewport = html.match(/<meta\s+name="viewport"\s+content="([^"]+)"/s)?.[1]

    expect(viewport).toContain('maximum-scale=1.0')
    expect(viewport).toContain('user-scalable=no')
  })

  it('versions the service-worker URL from the current hashed app bundle', () => {
    expect(buildServiceWorkerUrl('', '/assets/index-CtC5HFVK.js')).toBe(
      '/sw.js?v=index-CtC5HFVK.js',
    )
    expect(buildServiceWorkerUrl('/dashboard', '/dashboard/assets/index-AbC123.js')).toBe(
      '/dashboard/sw.js?v=index-AbC123.js',
    )
  })

  it('reloads controlled windows after a new service worker activates', () => {
    const worker = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8')

    expect(worker).toContain('const HERMES_DEPLOY_REVISION = "__HERMES_DEPLOY_REVISION__"')
    expect(worker).toContain('searchParams.get("v")')
    expect(worker).toContain('HERMES_DEPLOY_REVISION}-${HERMES_PWA_URL_REVISION')
    expect(worker).toContain('client.navigate(client.url)')
  })
})
