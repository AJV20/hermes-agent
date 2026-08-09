import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { buildServiceWorkerUrl } from './pwa'

describe('PWA cache busting', () => {
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

    expect(worker).toContain('searchParams.get("v")')
    expect(worker).toContain('?? "v2"')
    expect(worker).toContain('client.navigate(client.url)')
  })
})
