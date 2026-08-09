type MobileViewportWindow = {
  innerHeight: number
  navigator?: { standalone?: boolean; userAgent?: string }
  screen?: { height: number }
  visualViewport?: { height: number } | null
}

type MobileViewportDocument = {
  documentElement: {
    clientHeight: number
    style: { setProperty: (name: string, value: string) => void }
  }
}

const STANDALONE_FULL_HEIGHT_RATIO = 0.8

export function measureMobileViewportHeight(
  innerHeight: number,
  clientHeight: number,
  visualHeight: number | undefined,
  standaloneScreenHeight?: number,
): number {
  const layoutHeight = innerHeight || clientHeight || visualHeight || standaloneScreenHeight || 0
  const visibleHeight = visualHeight && visualHeight > 0 ? visualHeight : layoutHeight
  const measuredHeight = Math.min(layoutHeight, visibleHeight)

  // Installed iOS PWAs can cold-launch with innerHeight/visualViewport.height
  // temporarily shortened by the native home-indicator region. A real keyboard
  // reduces the viewport much more substantially, so retain that smaller value.
  if (
    standaloneScreenHeight
    && standaloneScreenHeight > measuredHeight
    && measuredHeight >= standaloneScreenHeight * STANDALONE_FULL_HEIGHT_RATIO
  ) {
    return Math.floor(standaloneScreenHeight)
  }

  return Math.floor(measuredHeight)
}

export function syncMobileViewportHeight(
  viewportWindow: MobileViewportWindow = window,
  viewportDocument: MobileViewportDocument = document,
): number {
  const standaloneScreenHeight = viewportWindow.navigator?.standalone
    ? viewportWindow.screen?.height
    : undefined
  const height = measureMobileViewportHeight(
    viewportWindow.innerHeight,
    viewportDocument.documentElement.clientHeight,
    viewportWindow.visualViewport?.height,
    standaloneScreenHeight,
  )
  if (height > 0) {
    viewportDocument.documentElement.style.setProperty('--mobile-app-height', `${height}px`)
  }
  return height
}
