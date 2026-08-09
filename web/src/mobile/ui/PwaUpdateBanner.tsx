import { requestHermesPwaUpdate } from '../../pwa'

export interface PwaUpdateBannerProps {
  blocked?: boolean
  onLater: () => void
  visible: boolean
}

export function PwaUpdateBanner({ blocked = false, onLater, visible }: PwaUpdateBannerProps) {
  if (!visible) return null
  return (
    <aside className="mobile-update-banner" role="status">
      <span>
        A new Hermes Mobile update is ready.
        {blocked && <small>Finish or clear your draft, remove attachments, and stop any response before updating.</small>}
      </span>
      <div>
        <button aria-label="Install Hermes Mobile update" disabled={blocked} onClick={() => void requestHermesPwaUpdate()} type="button">Update now</button>
        <button aria-label="Defer Hermes Mobile update" className="is-secondary" onClick={onLater} type="button">Later</button>
      </div>
    </aside>
  )
}
