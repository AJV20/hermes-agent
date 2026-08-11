import { AlertTriangle, Bell, Clock3, MessageCircle, Plus, Send, WifiOff } from 'lucide-react'
import { Link, useNavigate } from 'react-router'

import type { CronJob, MobileNotification, SessionInfo, StatusResponse } from '@/lib/api'
import type { MobilePreferences } from '../mobile-preferences'
import { buildTodayCards } from '../today-feed'
import type { LoadPhase } from '../types'
import { activeSessionsLabel, formatJobRun, greetingForCurrentTime, relativeTime, sessionLabel } from '../mobile-utils'
import { AppHeader, DesktopDocumentLink, QuickAction } from '../ui/primitives'
import { CodexQuotaCard } from '../ui/CodexQuotaCard'

export function HomeScreen({
  cronJobs, notificationError, notifications, onMarkNotificationRead, preferences, profile, sessions, sessionsPhase, status, statusPhase, tasksPhase
}: {
  cronJobs: CronJob[]
  notificationError: string | null
  notifications: MobileNotification[]
  onMarkNotificationRead: (notification: MobileNotification) => void
  preferences: MobilePreferences
  profile: string
  sessions: SessionInfo[]
  sessionsPhase: LoadPhase
  status: StatusResponse | null
  statusPhase: LoadPhase
  tasksPhase: LoadPhase
}) {
  const navigate = useNavigate()
  const cards = buildTodayCards({ cronJobs, notifications, preferences, sessions, status })
  const connected = Boolean(status?.gateway_running || status?.gateway_state === 'running')
  return <>
    <AppHeader detail={statusPhase === 'loading' ? 'Checking Desktop' : statusPhase === 'error' ? 'Desktop status unavailable' : connected ? 'Connected to Desktop' : 'Desktop unavailable'} />
    <main className={`mobile-screen mobile-home-screen mobile-text-${preferences.textSize} mobile-density-${preferences.density}`}>
      <section className="mobile-hero"><p className="mobile-eyebrow">Today</p><h1>{greetingForCurrentTime()}</h1><p>{statusPhase === 'loading' ? 'Loading Hermes status…' : statusPhase === 'error' ? 'Could not reach Hermes Desktop.' : activeSessionsLabel(status?.active_sessions)}</p></section>
      <Link aria-label="Ask Hermes" className="mobile-ask-bar" to="/mobile/chat/new"><span>Ask Hermes anything…</span><Send /></Link>
      {notificationError && <div className="mobile-inline-error" role="alert">{notificationError}</div>}
      <section className="mobile-today-feed" aria-label="Today attention feed">
        {statusPhase === 'error' && <article className="mobile-today-card is-warning"><WifiOff /><div><strong>Desktop status is unavailable</strong><small>Reconnect to see current Hermes activity.</small></div><Link to="/system">Desktop</Link></article>}
        {cards.map(card => {
          if (card.id === 'notifications') {
            const notice = card.item as MobileNotification
            return <article className={`mobile-today-card is-${card.tone}`} key={card.id}><Bell /><div><strong>{card.count} unread notification{card.count === 1 ? '' : 's'}</strong><small>{notice.title}</small></div><Link onClick={() => onMarkNotificationRead(notice)} to="/mobile/notifications">Review</Link></article>
          }
          if (card.id === 'connection') return <article className="mobile-today-card is-warning" key={card.id}><WifiOff /><div><strong>Hermes Desktop is disconnected</strong><small>Check Desktop before starting work.</small></div><Link to="/system">Check</Link></article>
          if (card.id === 'tasks') {
            const task = card.item as CronJob
            return <article className="mobile-today-card is-warning" key={card.id}><AlertTriangle /><div><strong>{card.count} task{card.count === 1 ? '' : 's'} needs attention</strong><small>{task.name || 'Scheduled Hermes task'} did not finish.</small></div><Link to="/mobile/tasks">Manage</Link></article>
          }
          const session = card.item as SessionInfo
          return <article className="mobile-today-card" key={card.id}><MessageCircle /><div><strong>Continue {sessionLabel(session)}</strong><small>{session.is_active ? 'Active session' : relativeTime(session.last_active)}</small></div><button aria-label={`Resume ${sessionLabel(session)}`} onClick={() => navigate(`/mobile/chat/${encodeURIComponent(session.id)}`)} type="button">Resume</button></article>
        })}
        {!cards.length && statusPhase === 'ready' && <div className="mobile-empty-card">Nothing needs your attention right now.</div>}
      </section>
      <section className="mobile-quick-grid mobile-secondary-actions" aria-label="Quick actions"><QuickAction icon={<Plus />} label="New chat" to="/mobile/chat/new" /><QuickAction icon={<MessageCircle />} label="Chats" to="/mobile/chats" /></section>
      <div className="mobile-home-utilities"><DesktopDocumentLink to="/files">Upload files</DesktopDocumentLink><DesktopDocumentLink to="/system">Desktop controls</DesktopDocumentLink></div>
      {tasksPhase === 'ready' && cronJobs.find(job => job.enabled && !job.last_status) && <section><div className="mobile-section-heading"><h2>Upcoming</h2><Link to="/mobile/tasks">All tasks</Link></div><article className="mobile-task-card"><span className="mobile-task-icon"><Clock3 /></span><span><strong>{cronJobs.find(job => job.enabled && !job.last_status)?.name || 'Scheduled Hermes task'}</strong><small>{formatJobRun(cronJobs.find(job => job.enabled && !job.last_status)!)}</small></span><span className="mobile-status-pill">Enabled</span></article></section>}
      {sessionsPhase === 'loading' && <div className="mobile-empty-card" aria-busy="true">Loading recent conversations…</div>}
      {sessionsPhase === 'error' && <div className="mobile-empty-card" role="alert">Could not load recent conversations.</div>}
      {tasksPhase === 'error' && <div className="mobile-empty-card" role="alert">Could not load scheduled tasks.</div>}
      <CodexQuotaCard profile={profile} />
    </main>
  </>
}
