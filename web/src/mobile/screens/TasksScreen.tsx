import { CheckCircle2, ChevronRight, Clock3, Pause, Play, Settings } from 'lucide-react'
import { useCallback, useState } from 'react'

import { api, type CronJob } from '@/lib/api'
import type { LoadPhase } from '../types'
import { formatJobRun } from '../mobile-utils'
import { AppHeader, DesktopDocumentLink } from '../ui/primitives'
import { MobileSheet } from '../ui/sheets'

function taskFailureDetail(job: CronJob): string {
  return job.last_error || job.last_delivery_error || job.last_status || 'The latest run needs attention.'
}

function taskFailureSummary(job: CronJob): string {
  const firstLine = taskFailureDetail(job).split(/\r?\n/, 1)[0].replace(/\s+/g, ' ').trim()
  return firstLine.length > 112 ? `${firstLine.slice(0, 109)}…` : firstLine
}

export function TasksScreen({ jobs, phase, profile }: { jobs: CronJob[]; phase: LoadPhase; profile: string }) {
  const [updates, setUpdates] = useState<Record<string, Partial<CronJob>>>({})
  const [working, setWorking] = useState<string | null>(null)
  const [filter, setFilter] = useState<'active' | 'all' | 'attention' | 'paused' | null>(null)
  const [selectedError, setSelectedError] = useState<CronJob | null>(null)
  const [runConfirm, setRunConfirm] = useState<CronJob | null>(null)
  const [mutationError, setMutationError] = useState<string | null>(null)
  const visibleJobs = jobs.map(job => ({ ...job, ...(updates[job.id] ?? {}) }))
  const attentionJobs = visibleJobs.filter(job => (
    Boolean(job.last_error || job.last_delivery_error) || ['error', 'failed', 'failure'].includes(job.last_status || '')
  ))
  const effectiveFilter = filter ?? (attentionJobs.length ? 'attention' : 'active')
  const filteredJobs = visibleJobs.filter(job => {
    if (effectiveFilter === 'attention') return attentionJobs.some(attention => attention.id === job.id)
    if (effectiveFilter === 'active') return job.enabled
    if (effectiveFilter === 'paused') return !job.enabled
    return true
  })

  const updateJob = useCallback(async (job: CronJob, action: 'pause' | 'resume' | 'run') => {
    setWorking(`${job.id}:${action}`)
    setMutationError(null)
    try {
      const updated = action === 'run'
        ? await api.triggerCronJob(job.id, profile)
        : action === 'pause'
          ? await api.pauseCronJob(job.id, profile)
          : await api.resumeCronJob(job.id, profile)
      setUpdates(current => ({
        ...current,
        [job.id]: {
          ...(current[job.id] ?? {}),
          ...updated,
          state: action === 'run' ? 'running' : action === 'pause' ? 'paused' : null
        }
      }))
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : 'Could not update this task.')
    } finally {
      setWorking(null)
    }
  }, [profile])

  return (
    <>
      <AppHeader detail="Automations and schedules" />
      <main className="mobile-screen">
        <div className="mobile-page-heading">
          <div>
            <p className="mobile-eyebrow">Live activity</p>
            <h1>Tasks</h1>
          </div>
        </div>
        <div className="mobile-task-filters" aria-label="Task filters">
          {([
            ['attention', `Attention${attentionJobs.length ? ` ${attentionJobs.length}` : ''}`],
            ['active', 'Active'],
            ['paused', 'Paused'],
            ['all', 'All']
          ] as const).map(([value, label]) => (
            <button
              aria-label={`Show ${value} tasks`}
              aria-pressed={effectiveFilter === value}
              className={effectiveFilter === value ? 'is-active' : ''}
              key={value}
              onClick={() => setFilter(value)}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
        {!!attentionJobs.length && (
          <section className="mobile-attention-card" aria-label="Tasks needing attention">
            <strong>{attentionJobs.length} {attentionJobs.length === 1 ? 'task needs' : 'tasks need'} attention</strong>
            {attentionJobs.map(job => (
              <div className="mobile-attention-row" key={job.id}>
                <span>
                  <strong>{job.name || 'Hermes task'}</strong>
                  <small>{taskFailureSummary(job)}</small>
                </span>
                <button aria-label={`View error for ${job.name || 'Hermes task'}`} onClick={() => setSelectedError(job)} type="button">
                  Details
                </button>
              </div>
            ))}
          </section>
        )}
        {mutationError && <div className="mobile-inline-error" role="alert">{mutationError}</div>}
        <div className="mobile-task-list">
          {phase === 'ready' && filteredJobs.map(job => (
            <article className="mobile-task-card" key={job.id}>
              <span className="mobile-task-icon">{job.last_status === 'success' ? <CheckCircle2 /> : <Clock3 />}</span>
              <span>
                <strong>{job.name || 'Hermes task'}</strong>
                <small>{formatJobRun(job)}</small>
              </span>
              <span className={`mobile-status-pill ${job.enabled ? '' : 'is-muted'}`}>
                {job.state === 'running' ? 'Running' : job.enabled ? 'Enabled' : 'Paused'}
              </span>
              <div className="mobile-task-actions">
                <button
                  aria-label={`Run ${job.name || 'Hermes task'} now`}
                  disabled={working !== null}
                  onClick={() => setRunConfirm(job)}
                  type="button"
                >
                  <Play /> Run
                </button>
                <button
                  aria-label={`${job.enabled ? 'Pause' : 'Resume'} ${job.name || 'Hermes task'}`}
                  disabled={working !== null}
                  onClick={() => void updateJob(job, job.enabled ? 'pause' : 'resume')}
                  type="button"
                >
                  {job.enabled ? <Pause /> : <Play />} {job.enabled ? 'Pause' : 'Resume'}
                </button>
              </div>
            </article>
          ))}
          {phase === 'loading' && <div className="mobile-empty-card" aria-busy="true">Loading scheduled tasks…</div>}
          {phase === 'error' && <div className="mobile-empty-card" role="alert">Could not load scheduled tasks.</div>}
          {phase === 'ready' && !jobs.length && <div className="mobile-empty-card">No scheduled tasks.</div>}
          {phase === 'ready' && !!jobs.length && !filteredJobs.length && (
            <div className="mobile-empty-card">No {effectiveFilter} tasks.</div>
          )}
        </div>
        <div className="mobile-more-list mobile-task-advanced-link">
          <DesktopDocumentLink to="/cron">
            <Settings />
            <strong>Advanced schedule settings</strong>
            <ChevronRight />
          </DesktopDocumentLink>
        </div>
      </main>
      {runConfirm && (
        <MobileSheet ariaLabel={`Confirm run ${runConfirm.name || 'Hermes task'}`} onClose={() => setRunConfirm(null)}>
            <div className="mobile-sheet-handle" />
            <h2>Run {runConfirm.name || 'Hermes task'} now?</h2>
            <p className="mobile-sheet-copy">This starts the task immediately and may send messages or change connected systems.</p>
            <button
              aria-label={`Confirm run ${runConfirm.name || 'Hermes task'}`}
              className="mobile-primary-button"
              disabled={working !== null}
              onClick={() => void updateJob(runConfirm, 'run').then(() => setRunConfirm(null))}
              type="button"
            >
              Run task now
            </button>
            <button className="mobile-sheet-cancel" onClick={() => setRunConfirm(null)} type="button">Cancel</button>
        </MobileSheet>
      )}
      {selectedError && (
        <MobileSheet
          ariaLabel={`Task error details for ${selectedError.name || 'Hermes task'}`}
          className="mobile-task-error-sheet"
          onClose={() => setSelectedError(null)}
        >
            <div className="mobile-sheet-handle" />
            <h2>{selectedError.name || 'Hermes task'}</h2>
            <pre>{taskFailureDetail(selectedError)}</pre>
            <button className="mobile-sheet-cancel" onClick={() => setSelectedError(null)} type="button">Done</button>
        </MobileSheet>
      )}
    </>
  )
}
