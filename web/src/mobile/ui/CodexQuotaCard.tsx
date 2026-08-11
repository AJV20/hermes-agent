import { RefreshCw, Sparkles } from 'lucide-react'
import { useEffect, useState } from 'react'

import { api, type CodexQuotaResponse } from '@/lib/api'

type QuotaLoad =
  | { phase: 'loading'; scope: string }
  | { phase: 'error'; scope: string }
  | { phase: 'ready'; quota: CodexQuotaResponse; scope: string }

function clampPercent(value: number | null): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, value))
}

function formatReset(value: string | null): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(date)
}

export function CodexQuotaCard({ profile }: { profile: string }) {
  const scope = profile || 'current'
  const [refreshKey, setRefreshKey] = useState(0)
  const [load, setLoad] = useState<QuotaLoad>({ phase: 'loading', scope })
  const visible = load.scope === scope ? load : { phase: 'loading' as const, scope }

  useEffect(() => {
    let cancelled = false
    const requestScope = scope
    void api.getCodexQuota(profile).then(
      quota => {
        if (!cancelled) setLoad({ phase: 'ready', quota, scope: requestScope })
      },
      () => {
        if (!cancelled) setLoad({ phase: 'error', scope: requestScope })
      }
    )
    return () => {
      cancelled = true
    }
  }, [profile, refreshKey, scope])

  const retry = () => {
    setLoad({ phase: 'loading', scope })
    setRefreshKey(current => current + 1)
  }

  return (
    <section className="mobile-codex-quota" aria-label="Codex quota">
      <div className="mobile-codex-quota-heading">
        <span className="mobile-codex-quota-icon"><Sparkles /></span>
        <span>
          <h2>Codex quota</h2>
          <small>{visible.phase === 'ready' && visible.quota.plan ? `${visible.quota.plan} plan` : 'OpenAI Codex'}</small>
        </span>
        <button aria-label="Refresh Codex quota" disabled={visible.phase === 'loading'} onClick={retry} type="button">
          <RefreshCw />
        </button>
      </div>

      {visible.phase === 'loading' ? (
        <p aria-busy="true" className="mobile-codex-quota-message">Loading Codex quota…</p>
      ) : visible.phase === 'error' || !visible.quota.available ? (
        <div className="mobile-codex-quota-message" role="status">
          <strong>Codex quota unavailable</strong>
          <span>Check your Codex sign-in, then try again.</span>
        </div>
      ) : (
        <div className="mobile-codex-quota-windows">
          {visible.quota.windows.map(window => {
            const used = clampPercent(window.used_percent)
            const remaining = Math.max(0, Math.round(100 - used))
            const reset = formatReset(window.reset_at)
            return (
              <div className="mobile-codex-quota-window" key={window.label}>
                <div>
                  <strong>{window.label}</strong>
                  <span>{remaining}% remaining</span>
                </div>
                <div
                  aria-label={`${window.label} quota remaining`}
                  aria-valuemax={100}
                  aria-valuemin={0}
                  aria-valuenow={remaining}
                  className="mobile-codex-quota-track"
                  role="progressbar"
                >
                  <span style={{ width: `${remaining}%` }} />
                </div>
                {reset && <small>Resets {reset}</small>}
              </div>
            )
          })}
          {(visible.quota.details ?? []).length > 0 && (
            <p className="mobile-codex-quota-detail">{visible.quota.details?.[0]}</p>
          )}
        </div>
      )}
    </section>
  )
}
