import { describe, expect, it, vi } from 'vitest'

import { installMobileZoomGuard } from './mobile-zoom'

type Listener = (event: { preventDefault: () => void; touches?: { length: number } }) => void

function createTarget() {
  const listeners = new Map<string, Listener>()
  const removed: string[] = []
  return {
    documentElement: { style: { touchAction: '' } },
    addEventListener(type: string, listener: Listener, options?: AddEventListenerOptions) {
      expect(options).toEqual({ passive: false })
      listeners.set(type, listener)
    },
    removeEventListener(type: string, listener: Listener) {
      expect(listeners.get(type)).toBe(listener)
      removed.push(type)
    },
    listeners,
    removed,
  }
}

describe('mobile zoom guard', () => {
  it('blocks Safari gesture zoom and multi-touch pinch gestures without blocking one-finger scrolling', () => {
    const target = createTarget()
    const cleanup = installMobileZoomGuard(target)
    const gesture = { preventDefault: () => undefined }
    const pinch = { touches: { length: 2 }, preventDefault: () => undefined }
    const scroll = { touches: { length: 1 }, preventDefault: () => undefined }
    const preventGesture = vi.spyOn(gesture, 'preventDefault')
    const preventPinch = vi.spyOn(pinch, 'preventDefault')
    const preventScroll = vi.spyOn(scroll, 'preventDefault')

    target.listeners.get('gesturestart')!(gesture)
    target.listeners.get('touchstart')!(pinch)
    target.listeners.get('touchmove')!(pinch)
    target.listeners.get('touchmove')!(scroll)

    expect(preventGesture).toHaveBeenCalledOnce()
    expect(preventPinch).toHaveBeenCalledTimes(2)
    expect(preventScroll).not.toHaveBeenCalled()
    expect(target.documentElement.style.touchAction).toBe('pan-x pan-y')

    cleanup()
    expect(target.removed).toEqual(['gesturestart', 'gesturechange', 'gestureend', 'touchstart', 'touchmove'])
  })
})
