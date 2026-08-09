type MobileViewportWindow = {
  innerHeight: number
  visualViewport?: { height: number } | null
}

type MobileViewportDocument = {
  documentElement: {
    clientHeight: number
    style: { setProperty: (name: string, value: string) => void }
  }
}

export function measureMobileViewportHeight(
  innerHeight: number,
  clientHeight: number,
  visualHeight: number | undefined,
): number {
  const layoutHeight = innerHeight || clientHeight || visualHeight || 0
  const visibleHeight = visualHeight && visualHeight > 0 ? visualHeight : layoutHeight
  return Math.floor(Math.min(layoutHeight, visibleHeight))
}

export function syncMobileViewportHeight(
  viewportWindow: MobileViewportWindow = window,
  viewportDocument: MobileViewportDocument = document,
): number {
  const height = measureMobileViewportHeight(
    viewportWindow.innerHeight,
    viewportDocument.documentElement.clientHeight,
    viewportWindow.visualViewport?.height,
  )
  if (height > 0) {
    viewportDocument.documentElement.style.setProperty('--mobile-app-height', `${height}px`)
  }
  return height
}
