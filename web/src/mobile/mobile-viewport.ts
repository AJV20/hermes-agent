type MobileViewportWindow = {
  innerHeight: number
  navigator?: { standalone?: boolean; userAgent?: string }
  screen?: { height: number }
  visualViewport?: { height: number; offsetTop?: number; pageTop?: number } | null
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
  visualOffsetTop = 0,
  visualPageTop?: number,
): number {
  const layoutHeight = innerHeight || clientHeight || visualHeight || standaloneScreenHeight || 0
  const pageTop = typeof visualPageTop === 'number' && Number.isFinite(visualPageTop)
    ? visualPageTop
    : visualOffsetTop
  const visualTop = Math.max(0, pageTop)
  const visibleBottom = visualHeight && visualHeight > 0
    ? visualHeight + visualTop
    : layoutHeight
  const measuredHeight = Math.min(layoutHeight, visibleBottom)

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
    viewportWindow.visualViewport?.offsetTop,
    viewportWindow.visualViewport?.pageTop,
  )
  if (height > 0) {
    viewportDocument.documentElement.style.setProperty('--mobile-app-height', `${height}px`)
  }
  return height
}
