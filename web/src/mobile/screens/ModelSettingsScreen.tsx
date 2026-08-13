import { Bot, ChevronRight } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import { ModelPickerDialog } from '@/components/ModelPickerDialog'
import { api, type ModelOptionsResponse } from '@/lib/api'

import { AppHeader } from '../ui/primitives'

export function ModelSettingsScreen({ profile }: { profile: string }) {
  const [current, setCurrent] = useState<{ model: string; provider: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [pickerOpen, setPickerOpen] = useState(false)

  const loadOptions = useCallback((options?: { refresh?: boolean }) => (
    api.getModelOptions({ profile: profile || undefined, refresh: options?.refresh })
  ), [profile])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    void loadOptions().then(
      result => {
        if (cancelled) return
        setCurrent({ model: result.model ?? '', provider: result.provider ?? '' })
      },
      reason => {
        if (cancelled) return
        setError(reason instanceof Error ? reason.message : 'Could not load model options.')
      }
    ).finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => { cancelled = true }
  }, [loadOptions])

  const applyModel = useCallback(async ({ confirmExpensiveModel, model, provider }: {
    confirmExpensiveModel?: boolean
    model: string
    persistGlobal: boolean
    provider: string
  }) => {
    const result = await api.setModelAssignment({
      confirm_expensive_model: confirmExpensiveModel,
      scope: 'main',
      provider,
      model
    }, profile)
    if (!result.confirm_required) {
      setCurrent({ model, provider })
      setError(null)
    }
    return result
  }, [profile])

  return (
    <>
      <AppHeader detail="Default for new conversations" />
      <main className="mobile-screen">
        <div className="mobile-page-heading">
          <div><p className="mobile-eyebrow">AI settings</p><h1>Model</h1></div>
        </div>
        <section aria-labelledby="mobile-current-model-title" className="mobile-model-card">
          <div className="mobile-model-card-icon"><Bot aria-hidden="true" /></div>
          <div>
            <h2 id="mobile-current-model-title">Current model</h2>
            {loading
              ? <p aria-live="polite">Loading model…</p>
              : <><strong>{current?.model || 'Not configured'}</strong><p>{current?.provider || 'Uses the profile default'}</p></>}
          </div>
          <button
            aria-label="Choose model"
            data-mobile-model-picker
            disabled={loading}
            onClick={() => setPickerOpen(true)}
            type="button"
          >
            <span>Change</span><ChevronRight aria-hidden="true" />
          </button>
        </section>
        <p className="mobile-model-help">Changes apply to new conversations in this profile. Existing conversations keep their current model.</p>
        {error && <div aria-live="polite" className="mobile-inline-error">{error}</div>}
      </main>
      {pickerOpen && (
        <ModelPickerDialog
          alwaysGlobal
          loader={loadOptions as (options?: { refresh?: boolean }) => Promise<ModelOptionsResponse>}
          onApply={applyModel}
          onClose={() => setPickerOpen(false)}
          title="Choose model"
        />
      )}
    </>
  )
}
