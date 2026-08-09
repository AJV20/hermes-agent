import { Clock3, FileUp, MessageCircle, Plus, Send, Wifi } from 'lucide-react'
import { Link, useNavigate } from 'react-router'

import type { CronJob, SessionInfo, StatusResponse } from '@/lib/api'
import type { LoadPhase } from '../types'
import { activeSessionsLabel, formatJobRun, greetingForCurrentTime, relativeTime, sessionLabel } from '../mobile-utils'
import { AppHeader, DesktopDocumentLink, QuickAction } from '../ui/primitives'
import { CodexQuotaCard } from '../ui/CodexQuotaCard'

export function HomeScreen({
  cronJobs,
  profile,
  sessions,
  sessionsPhase,
  status,
  statusPhase,
  tasksPhase
}: {
  cronJobs: CronJob[]
  profile: string
  sessions: SessionInfo[]
  sessionsPhase: LoadPhase
  status: StatusResponse | null
  statusPhase: LoadPhase
  tasksPhase: LoadPhase
}) {
  const navigate = useNavigate()
  const nextJob = cronJobs.find(job => job.enabled)
  const recent = sessions[0]
  const connected = Boolean(status?.gateway_running || status?.gateway_state === 'running')
  return (
    <>
      <AppHeader detail={
        statusPhase === 'loading'
          ? 'Connecting to Desktop'
          : statusPhase === 'error'
            ? 'Desktop status unavailable'
            : connected ? 'Connected to Desktop' : 'Desktop unavailable'
      } />
      <main className="mobile-screen mobile-home-screen">
        <section className="mobile-hero">
          <p className="mobile-eyebrow">Your agent, wherever you are</p>
          <h1>{greetingForCurrentTime()}</h1>
          <p>
            {statusPhase === 'loading'
              ? 'Loading Hermes status…'
              : statusPhase === 'error'
                ? 'Could not reach Hermes Desktop.'
                : activeSessionsLabel(status?.active_sessions)}
          </p>
        </section>

        <section className="mobile-quick-grid" aria-label="Quick actions">
          <QuickAction icon={<Plus />} label="New chat" to="/mobile/chat/new" />
          <QuickAction icon={<MessageCircle />} label="Chats" to="/mobile/chats" />
          <DesktopDocumentLink className="mobile-quick-action" to="/files">
            <FileUp />
            <strong>Upload</strong>
          </DesktopDocumentLink>
          <DesktopDocumentLink className="mobile-quick-action" to="/system">
            <Wifi />
            <strong>Desktop</strong>
          </DesktopDocumentLink>
        </section>

        <CodexQuotaCard profile={profile} />

        {sessionsPhase === 'loading' && (
          <div className="mobile-empty-card" aria-busy="true">Loading recent conversations…</div>
        )}
        {sessionsPhase === 'error' && (
          <div className="mobile-empty-card" role="alert">Could not load recent conversations.</div>
        )}
        {sessionsPhase === 'ready' && recent && (
          <section>
            <div className="mobile-section-heading">
              <h2>Continue</h2>
              <Link to="/mobile/chats">See all</Link>
            </div>
            <article className="mobile-resume-card">
              <span className="mobile-live-label">
                {recent.is_active ? 'Active session' : relativeTime(recent.last_active)}
              </span>
              <h3>{sessionLabel(recent)}</h3>
              <p>{recent.preview || `${recent.message_count} messages in this conversation.`}</p>
              <div>
                <small>{recent.model || recent.source || 'Hermes'}</small>
                <button onClick={() => navigate(`/mobile/chat/${encodeURIComponent(recent.id)}`)} type="button">
                  Resume
                </button>
              </div>
            </article>
          </section>
        )}

        <section>
          <div className="mobile-section-heading">
            <h2>Next task</h2>
            <Link to="/mobile/tasks">Manage</Link>
          </div>
          {tasksPhase === 'loading' ? (
            <div className="mobile-empty-card" aria-busy="true">Loading scheduled tasks…</div>
          ) : tasksPhase === 'error' ? (
            <div className="mobile-empty-card" role="alert">Could not load scheduled tasks.</div>
          ) : nextJob ? (
            <article className="mobile-task-card">
              <span className="mobile-task-icon">
                <Clock3 />
              </span>
              <span>
                <strong>{nextJob.name || 'Scheduled Hermes task'}</strong>
                <small>{formatJobRun(nextJob)}</small>
              </span>
              <span className="mobile-status-pill">Enabled</span>
            </article>
          ) : (
            <div className="mobile-empty-card">No scheduled tasks.</div>
          )}
        </section>

        <Link className="mobile-ask-bar" to="/mobile/chat/new">
          <span>Ask Hermes anything…</span>
          <Send />
        </Link>
      </main>
    </>
  )
}
