// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

import { registerHermesPwa } from './pwa'

describe('registerHermesPwa', () => {
  afterEach(() => {
    document.head.replaceChildren()
    vi.restoreAllMocks()
  })

  it('registers immediately when a dynamically imported entry loads after window.load', () => {
    const register = vi.fn(() => Promise.resolve({}))
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { register }
    })
    Object.defineProperty(document, 'readyState', {
      configurable: true,
      value: 'complete'
    })
    const script = document.createElement('script')
    script.type = 'module'
    script.src = 'https://example.test/assets/index-mobile.js'
    document.head.append(script)

    registerHermesPwa()

    expect(register).toHaveBeenCalledWith('/sw.js?v=index-mobile.js', { scope: '/' })
  })
})
