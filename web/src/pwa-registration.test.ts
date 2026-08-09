// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

import { registerHermesPwa, requestHermesPwaUpdate } from './pwa'

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

  it('asks a waiting worker to activate and reloads only after one controller change', async () => {
    const postMessage = vi.fn()
    const controllerChange = new Set<() => void>()
    const getRegistration = vi.fn(async () => ({ waiting: { postMessage } }))
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        addEventListener: (type: string, handler: () => void) => {
          if (type === 'controllerchange') controllerChange.add(handler)
        },
        getRegistration,
        removeEventListener: (type: string, handler: () => void) => controllerChange.delete(handler)
      }
    })
    const reload = vi.fn()
    Object.defineProperty(window, 'location', { configurable: true, value: { reload } })

    expect(await requestHermesPwaUpdate()).toBe(true)
    expect(postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' })
    expect(reload).not.toHaveBeenCalled()
    controllerChange.forEach(handler => handler())
    controllerChange.forEach(handler => handler())
    expect(reload).toHaveBeenCalledTimes(1)
  })
})
