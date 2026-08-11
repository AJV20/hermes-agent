type ZoomEvent = {
  preventDefault: () => void
  touches?: { length: number }
}

type ZoomGuardTarget = {
  addEventListener: (type: string, listener: (event: ZoomEvent) => void, options: { passive: false }) => void
  removeEventListener: (type: string, listener: (event: ZoomEvent) => void) => void
  documentElement?: { style: { touchAction: string } }
}

/** Blocks browser zoom gestures in the mobile-only entry without blocking one-finger scrolling. */
export function installMobileZoomGuard(target: ZoomGuardTarget = document): () => void {
  if (target.documentElement) {
    target.documentElement.style.touchAction = 'pan-x pan-y'
  }

  const preventGesture = (event: ZoomEvent) => event.preventDefault()
  const preventPinch = (event: ZoomEvent) => {
    if ((event.touches?.length ?? 0) > 1) event.preventDefault()
  }
  const options = { passive: false } as const

  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
    target.addEventListener(type, preventGesture, options)
  }
  for (const type of ['touchstart', 'touchmove']) {
    target.addEventListener(type, preventPinch, options)
  }

  return () => {
    for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
      target.removeEventListener(type, preventGesture)
    }
    for (const type of ['touchstart', 'touchmove']) {
      target.removeEventListener(type, preventPinch)
    }
  }
}
