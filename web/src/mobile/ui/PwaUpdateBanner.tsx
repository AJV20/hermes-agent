import { requestHermesPwaUpdate } from '../../pwa'

export interface PwaUpdateBannerProps {
  onLater: () => void
  visible: boolean
}

export function PwaUpdateBanner({ onLater, visible }: PwaUpdateBannerProps) {
  if (!visible) return null
  return (
    <aside className="mobile-update-banner" role="status">
      <span>A new Hermes Mobile update is ready.</span>
      <div>
        <button aria-label="Install Hermes Mobile update" onClick={() => void requestHermesPwaUpdate()} type="button">Update now</button>
        <button aria-label="Defer Hermes Mobile update" className="is-secondary" onClick={onLater} type="button">Later</button>
      </div>
    </aside>
  )
}
