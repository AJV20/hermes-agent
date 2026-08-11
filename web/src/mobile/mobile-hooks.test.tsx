// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import { useMobileViewportSync } from './mobile-hooks'

function ViewportHarness() {
  useMobileViewportSync()
  return null
}

describe('useMobileViewportSync', () => {
  const originalViewport = Object.getOwnPropertyDescriptor(window, 'visualViewport')
  const originalInnerHeight = Object.getOwnPropertyDescriptor(window, 'innerHeight')
  const roots: Array<ReturnType<typeof createRoot>> = []
  const containers: HTMLElement[] = []

  afterEach(() => {
    roots.splice(0).forEach(root => act(() => root.unmount()))
    containers.splice(0).forEach(container => container.remove())
    if (originalViewport) Object.defineProperty(window, 'visualViewport', originalViewport)
    else delete (window as unknown as { visualViewport?: VisualViewport }).visualViewport
    if (originalInnerHeight) Object.defineProperty(window, 'innerHeight', originalInnerHeight)
    document.documentElement.style.removeProperty('--mobile-app-height')
  })

  it('remeasures when iOS pans the visual viewport without resizing it', () => {
    const visualViewport = Object.assign(new EventTarget(), { height: 168, offsetTop: 0 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 844 })
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: visualViewport })
    const container = document.createElement('div')
    document.body.appendChild(container)
    containers.push(container)
    const root = createRoot(container)
    roots.push(root)

    act(() => root.render(<ViewportHarness />))
    expect(document.documentElement.style.getPropertyValue('--mobile-app-height')).toBe('168px')

    visualViewport.offsetTop = 383
    act(() => visualViewport.dispatchEvent(new Event('scroll')))

    expect(document.documentElement.style.getPropertyValue('--mobile-app-height')).toBe('551px')
  })
})
