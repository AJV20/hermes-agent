import { describe, expect, it, vi } from 'vitest'

import { measureMobileViewportHeight, syncMobileViewportHeight } from './mobile-viewport'

describe('mobile viewport synchronization', () => {
  it('clamps an oversized iOS visual viewport to the actual inner height', () => {
    expect(measureMobileViewportHeight(844, 844, 932)).toBe(844)
  })

  it('uses the smaller visual viewport while the keyboard is open', () => {
    expect(measureMobileViewportHeight(844, 844, 512)).toBe(512)
  })

  it('falls back to the document client height when innerHeight is unavailable', () => {
    expect(measureMobileViewportHeight(0, 780, undefined)).toBe(780)
  })

  it('writes the measured height to the document root', () => {
    const setProperty = vi.fn()
    const height = syncMobileViewportHeight(
      { innerHeight: 844, visualViewport: { height: 932 } },
      { documentElement: { clientHeight: 844, style: { setProperty } } },
    )

    expect(height).toBe(844)
    expect(setProperty).toHaveBeenCalledWith('--mobile-app-height', '844px')
  })
})
