import {
  ArrowDown,
  ArrowLeft,
  Bot,
  CheckCircle2,
  ChevronRight,
  Clock3,
  FileUp,
  Home,
  ListTodo,
  Menu,
  MessageCircle,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  Search,
  Send,
  Settings,
  Sparkles,
  Trash2,
  Wifi,
  X
} from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentPropsWithoutRef, type FormEvent, type ReactNode } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router'

import { Markdown } from '@/components/Markdown'
import { useProfileScope } from '@/contexts/useProfileScope'
import { api, HERMES_BASE_PATH, type CronJob, type SessionInfo, type StatusResponse } from '@/lib/api'
import { GatewayClient, type GatewayEvent } from '@/lib/gatewayClient'
import {
  applyMobileGatewayEvent,
  hydrateMobileResume,
  projectSessionMessages,
  type MobileChatMessage,
  type MobileChatState,
  type MobileResumeSnapshot
} from './mobile-chat-state'
import { desktopDocumentHref } from './mobile-desktop-link'
import { syncMobileViewportHeight } from './mobile-viewport'
import './mobile-app.css'

const EMPTY_CHAT: MobileChatState = {
  busy: false,
  error: null,
  messages: [],
  tools: []
}
const PROMPT_TIMEOUT_MS = 1_800_000
const RECONNECT_DELAYS_MS = [500, 1000, 2000, 4000, 8000] as const
const MAX_MOBILE_ATTACHMENT_BYTES = 50 * 1024 * 1024
const MAX_MOBILE_IMAGE_BYTES = 25 * 1024 * 1024

function draftStorageKey(profile: string, storedSessionId: string): string {
  return `hermes.mobile.draft:${profile || 'default'}:${storedSessionId}`
}

function loadDraft(profile: string, storedSessionId: string): string {
  try {
    return window.localStorage.getItem(draftStorageKey(profile, storedSessionId)) || ''
  } catch {
    return ''
  }
}

function saveDraft(profile: string, storedSessionId: string, value: string) {
  try {
    const key = draftStorageKey(profile, storedSessionId)
    if (value) window.localStorage.setItem(key, value)
    else window.localStorage.removeItem(key)
  } catch {
    // Draft persistence is best-effort in restricted browser contexts.
  }
}

function outboxStorageKey(profile: string, storedSessionId: string): string {
  return `hermes.mobile.outbox:${profile || 'default'}:${storedSessionId}`
}

function loadOutbox(profile: string, storedSessionId: string): string {
  try {
    return window.localStorage.getItem(outboxStorageKey(profile, storedSessionId)) || ''
  } catch {
    return ''
  }
}

function saveOutbox(profile: string, storedSessionId: string, value: string) {
  try {
    const key = outboxStorageKey(profile, storedSessionId)
    if (value) window.localStorage.setItem(key, value)
    else window.localStorage.removeItem(key)
  } catch {
    // The in-memory outbox still works when storage is unavailable.
  }
}

interface MobileAttachment {
  file: File
  id: string
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error(`Could not read ${file.name}`))
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result)
      else reject(new Error(`Could not read ${file.name}`))
    }
    reader.readAsDataURL(file)
  })
}

type LoadPhase = 'error' | 'loading' | 'ready'

interface ScopedLoadState {
  phase: LoadPhase
  scope: string | null
}

function routeTab(pathname: string): 'chats' | 'home' | 'more' | 'tasks' {
  if (pathname.startsWith('/mobile/chat')) return 'chats'
  if (pathname.startsWith('/mobile/chats')) return 'chats'
  if (pathname.startsWith('/mobile/tasks')) return 'tasks'
  if (pathname.startsWith('/mobile/more')) return 'more'
  return 'home'
}

function relativeTime(timestamp: number | null | undefined): string {
  if (!timestamp) return 'Recently'
  const milliseconds = timestamp > 10_000_000_000 ? timestamp : timestamp * 1000
  const minutes = Math.max(0, Math.round((Date.now() - milliseconds) / 60_000))
  if (minutes < 1) return 'Now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

function greetingForCurrentTime(now = new Date()): string {
  const hour = now.getHours()
  if (hour < 12) return 'Good morning.'
  if (hour < 18) return 'Good afternoon.'
  return 'Good evening.'
}

function activeSessionsLabel(count: number | null | undefined): string {
  if (!count) return 'Hermes is ready.'
  return `${count} session${count === 1 ? '' : 's'} active.`
}

function jobRunTimestamp(job: CronJob): number {
  if (!job.next_run_at) return Number.POSITIVE_INFINITY
  const timestamp = Date.parse(String(job.next_run_at))
  return Number.isFinite(timestamp) ? timestamp : Number.POSITIVE_INFINITY
}

function orderCronJobs(jobs: CronJob[]): CronJob[] {
  return [...jobs].sort((left, right) => {
    if (left.enabled !== right.enabled) return left.enabled ? -1 : 1
    return jobRunTimestamp(left) - jobRunTimestamp(right)
  })
}

function formatJobRun(job: CronJob): string {
  const timestamp = jobRunTimestamp(job)
  if (Number.isFinite(timestamp)) {
    const run = new Date(timestamp)
    const date = run.toLocaleDateString('en-US', { day: 'numeric', month: 'short' })
    const time = run.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    return `${date} at ${time}`
  }
  return job.schedule_display || job.last_status || 'Scheduled'
}

function sessionLabel(session: SessionInfo): string {
  return session.title?.trim() || session.preview?.trim() || 'Untitled session'
}

function safeDecodePathSegment(value: string): string | null {
  try {
    return decodeURIComponent(value)
  } catch {
    return null
  }
}

function useMobileViewportSync() {
  useEffect(() => {
    const timers: number[] = []
    const frames: number[] = []
    const sync = () => {
      syncMobileViewportHeight()
      void document.documentElement.offsetHeight
    }
    const settle = () => {
      sync()
      frames.push(window.requestAnimationFrame(sync))
      timers.push(window.setTimeout(sync, 100), window.setTimeout(sync, 300))
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') settle()
    }

    settle()
    window.addEventListener('resize', sync)
    window.addEventListener('orientationchange', settle)
    window.addEventListener('pageshow', settle)
    window.visualViewport?.addEventListener('resize', sync)
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      window.removeEventListener('resize', sync)
      window.removeEventListener('orientationchange', settle)
      window.removeEventListener('pageshow', settle)
      window.visualViewport?.removeEventListener('resize', sync)
      document.removeEventListener('visibilitychange', onVisibility)
      frames.forEach((frame) => window.cancelAnimationFrame(frame))
      timers.forEach((timer) => window.clearTimeout(timer))
    }
  }, [])
}

function usePwaUpdateReady(): boolean {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === 'HERMES_PWA_UPDATE_READY') setReady(true)
    }
    navigator.serviceWorker.addEventListener('message', onMessage)
    return () => navigator.serviceWorker.removeEventListener('message', onMessage)
  }, [])
  return ready
}

function PwaUpdateBanner({ visible }: { visible: boolean }) {
  if (!visible) return null
  return (
    <aside className="mobile-update-banner" role="status">
      <span>A new Hermes Mobile update is ready.</span>
      <button aria-label="Reload Hermes Mobile update" onClick={() => window.location.reload()} type="button">
        Update now
      </button>
    </aside>
  )
}

function IconButton({ children, disabled = false, label, onClick }: { children: ReactNode; disabled?: boolean; label: string; onClick?: () => void }) {
  return (
    <button className="mobile-icon-button" aria-label={label} disabled={disabled} onClick={onClick} type="button">
      {children}
    </button>
  )
}

function AppHeader({ back, detail, title = 'Hermes' }: { back?: () => void; detail?: string; title?: string }) {
  return (
    <header className="mobile-app-header">
      <div>
        {back ? (
          <IconButton label="Go back" onClick={back}>
            <ArrowLeft />
          </IconButton>
        ) : (
          <div className="mobile-wordmark">H</div>
        )}
      </div>
      <div className="mobile-app-title">
        <strong>{title}</strong>
        {detail && <span>{detail}</span>}
      </div>
      <Link className="mobile-icon-button" aria-label="Open mobile menu" to="/mobile/more">
        <Menu />
      </Link>
    </header>
  )
}

function BottomNavigation({ active }: { active: ReturnType<typeof routeTab> }) {
  const items = [
    { icon: Home, label: 'Home', path: '/mobile', tab: 'home' },
    { icon: MessageCircle, label: 'Chats', path: '/mobile/chats', tab: 'chats' },
    { icon: ListTodo, label: 'Tasks', path: '/mobile/tasks', tab: 'tasks' },
    { icon: MoreHorizontal, label: 'More', path: '/mobile/more', tab: 'more' }
  ] as const
  return (
    <nav className="mobile-bottom-nav" aria-label="Mobile navigation">
      {items.map(item => {
        const Icon = item.icon
        return (
          <Link
            aria-current={active === item.tab ? 'page' : undefined}
            className={active === item.tab ? 'is-active' : ''}
            key={item.path}
            to={item.path}
          >
            <Icon aria-hidden="true" />
            <span>{item.label}</span>
          </Link>
        )
      })}
    </nav>
  )
}

function DesktopDocumentLink({ to, ...props }: { to: string } & Omit<ComponentPropsWithoutRef<'a'>, 'href'>) {
  return <a {...props} href={desktopDocumentHref(to, HERMES_BASE_PATH)} />
}

function QuickAction({ icon, label, to }: { icon: ReactNode; label: string; to: string }) {
  return (
    <Link className="mobile-quick-action" to={to}>
      {icon}
      <strong>{label}</strong>
    </Link>
  )
}

function SessionRow({ onActions, session }: { onActions?: () => void; session: SessionInfo }) {
  return (
    <div className="mobile-session-row">
      <Link className="mobile-session-main" to={`/mobile/chat/${encodeURIComponent(session.id)}`}>
        <span className="mobile-session-icon">
          <MessageCircle />
        </span>
        <span className="mobile-session-copy">
          <strong>{sessionLabel(session)}</strong>
          <small>{session.preview || `${session.message_count} messages`}</small>
        </span>
        <span className="mobile-session-meta">
          <small>{relativeTime(session.last_active || session.started_at)}</small>
          <ChevronRight />
        </span>
      </Link>
      {onActions && (
        <button aria-label={`Actions for ${sessionLabel(session)}`} className="mobile-row-actions" onClick={onActions} type="button">
          <MoreHorizontal />
        </button>
      )}
    </div>
  )
}

function HomeScreen({
  cronJobs,
  sessions,
  sessionsPhase,
  status,
  statusPhase,
  tasksPhase
}: {
  cronJobs: CronJob[]
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

function ChatsScreen({
  canLoadMore,
  loadingMore,
  onLoadMore,
  phase,
  profile,
  sessions
}: {
  canLoadMore: boolean
  loadingMore: boolean
  onLoadMore: () => void
  phase: LoadPhase
  profile: string
  sessions: SessionInfo[]
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SessionInfo[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [selected, setSelected] = useState<SessionInfo | null>(null)
  const [title, setTitle] = useState('')
  const [renamed, setRenamed] = useState<Record<string, string>>({})
  const [deleted, setDeleted] = useState<Set<string>>(() => new Set())
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const search = useCallback(async (event: FormEvent) => {
    event.preventDefault()
    const value = query.trim()
    if (!value) {
      setResults(null)
      return
    }
    setSearching(true)
    try {
      const response = await api.searchSessions(value, { order: 'recent', profile })
      setResults(response.results)
    } finally {
      setSearching(false)
    }
  }, [profile, query])

  const rename = useCallback(async (event: FormEvent) => {
    event.preventDefault()
    const nextTitle = title.trim()
    if (!selected || !nextTitle) return
    await api.renameSession(selected.id, nextTitle, profile)
    setRenamed(current => ({ ...current, [selected.id]: nextTitle }))
    setSelected(null)
  }, [profile, selected, title])

  const remove = useCallback(async () => {
    if (!selected) return
    await api.deleteSession(selected.id, profile)
    setDeleted(current => new Set(current).add(selected.id))
    setConfirmingDelete(false)
    setSelected(null)
  }, [profile, selected])

  const visibleSessions = (results ?? sessions)
    .filter(session => !deleted.has(session.id))
    .map(session => renamed[session.id] ? { ...session, title: renamed[session.id] } : session)
  return (
    <>
      <AppHeader detail={
        phase === 'loading'
          ? 'Loading conversations'
          : phase === 'error'
            ? 'Conversations unavailable'
            : `${sessions.length} recent conversations`
      } />
      <main className="mobile-screen">
        <div className="mobile-page-heading">
          <div>
            <p className="mobile-eyebrow">Shared with Desktop</p>
            <h1>Chats</h1>
          </div>
          <Link className="mobile-round-action" to="/mobile/chat/new" aria-label="New chat">
            <Plus />
          </Link>
        </div>
        <form className="mobile-search" onSubmit={search} role="search">
          <Search aria-hidden="true" />
          <input
            aria-label="Search conversations"
            onChange={event => {
              setQuery(event.target.value)
              if (!event.target.value) setResults(null)
            }}
            placeholder="Search conversations"
            type="search"
            value={query}
          />
          <button disabled={searching || !query.trim()} type="submit">
            {searching ? 'Searching…' : 'Search'}
          </button>
        </form>
        <div className="mobile-session-list">
          {phase === 'ready' && visibleSessions.map(session => (
            <SessionRow
              key={session.id}
              onActions={() => {
                setSelected(session)
                setTitle(sessionLabel(session))
              }}
              session={session}
            />
          ))}
          {phase === 'loading' && <div className="mobile-empty-card" aria-busy="true">Loading conversations…</div>}
          {phase === 'error' && <div className="mobile-empty-card" role="alert">Could not load conversations.</div>}
          {phase === 'ready' && !visibleSessions.length && (
            <div className="mobile-empty-card">{results ? 'No matching conversations.' : 'No conversations yet.'}</div>
          )}
          {!results && phase === 'ready' && canLoadMore && (
            <button
              aria-label="Load more conversations"
              className="mobile-load-more"
              disabled={loadingMore}
              onClick={onLoadMore}
              type="button"
            >
              {loadingMore ? 'Loading more…' : 'Load more'}
            </button>
          )}
        </div>
      </main>
      {selected && (
        <div className="mobile-sheet-backdrop" onClick={() => setSelected(null)}>
          <section
            aria-label={`Conversation actions for ${sessionLabel(selected)}`}
            aria-modal="true"
            className="mobile-bottom-sheet"
            onClick={event => event.stopPropagation()}
            role="dialog"
          >
            <div className="mobile-sheet-handle" />
            <h2>Conversation</h2>
            <form onSubmit={rename}>
              <label>
                Title
                <input aria-label="Conversation title" onChange={event => setTitle(event.target.value)} value={title} />
              </label>
              <button className="mobile-primary-button" type="submit">Save title</button>
            </form>
            {!confirmingDelete ? (
              <button
                aria-label="Delete conversation"
                className="mobile-danger-button"
                onClick={() => setConfirmingDelete(true)}
                type="button"
              >
                <Trash2 /> Delete conversation
              </button>
            ) : (
              <div className="mobile-confirm-delete" role="alert">
                <p>This permanently removes the conversation from Hermes.</p>
                <button aria-label="Confirm delete conversation" className="mobile-danger-button" onClick={() => void remove()} type="button">
                  Delete permanently
                </button>
                <button onClick={() => setConfirmingDelete(false)} type="button">Keep conversation</button>
              </div>
            )}
            <button className="mobile-sheet-cancel" onClick={() => setSelected(null)} type="button">Cancel</button>
          </section>
        </div>
      )}
    </>
  )
}

function TasksScreen({ jobs, phase, profile }: { jobs: CronJob[]; phase: LoadPhase; profile: string }) {
  const [updates, setUpdates] = useState<Record<string, Partial<CronJob>>>({})
  const [working, setWorking] = useState<string | null>(null)
  const visibleJobs = jobs.map(job => ({ ...job, ...(updates[job.id] ?? {}) }))
  const attentionJobs = visibleJobs.filter(job => (
    Boolean(job.last_error || job.last_delivery_error) || ['error', 'failed', 'failure'].includes(job.last_status || '')
  ))

  const updateJob = useCallback(async (job: CronJob, action: 'pause' | 'resume' | 'run') => {
    setWorking(`${job.id}:${action}`)
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
        {!!attentionJobs.length && (
          <section className="mobile-attention-card" aria-label="Tasks needing attention">
            <strong>{attentionJobs.length} {attentionJobs.length === 1 ? 'task needs' : 'tasks need'} attention</strong>
            {attentionJobs.map(job => (
              <p key={job.id}>{job.name || 'Hermes task'}: {job.last_error || job.last_delivery_error || job.last_status}</p>
            ))}
          </section>
        )}
        <div className="mobile-task-list">
          {phase === 'ready' && visibleJobs.map(job => (
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
                  onClick={() => void updateJob(job, 'run')}
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
        </div>
        <DesktopDocumentLink to="/cron">
          <Settings />
          <strong>Advanced schedule settings</strong>
          <ChevronRight />
        </DesktopDocumentLink>
      </main>
    </>
  )
}

function MoreScreen() {
  const links = [
    { icon: Bot, label: 'Models and capabilities', to: '/models' },
    { icon: FileUp, label: 'Files', to: '/files' },
    { icon: Sparkles, label: 'Skills', to: '/skills' },
    { icon: Settings, label: 'Full dashboard', to: '/system' }
  ]
  return (
    <>
      <AppHeader detail="Desktop-level controls" />
      <main className="mobile-screen">
        <div className="mobile-page-heading">
          <div>
            <p className="mobile-eyebrow">Power tools</p>
            <h1>More</h1>
          </div>
        </div>
        <div className="mobile-more-list">
          {links.map(item => {
            const Icon = item.icon
            return (
              <DesktopDocumentLink key={item.to} to={item.to}>
                <Icon />
                <strong>{item.label}</strong>
                <ChevronRight />
              </DesktopDocumentLink>
            )
          })}
        </div>
      </main>
    </>
  )
}

function ChatBubble({ message }: { message: MobileChatMessage }) {
  return (
    <article className={`mobile-bubble is-${message.role}${message.queued ? ' is-queued' : ''}`}>
      {message.queued && <span className="mobile-queued-label">Queued</span>}
      {message.role === 'assistant' ? (
        <Markdown content={message.content} streaming={message.streaming} />
      ) : (
        <p>{message.content}</p>
      )}
    </article>
  )
}

function ChatScreen({
  onSessionCreated,
  profile,
  storedSessionId
}: {
  onSessionCreated: () => void
  profile: string
  storedSessionId: string
}) {
  const navigate = useNavigate()
  const gateway = useMemo(() => new GatewayClient(), [])
  const isNew = storedSessionId === 'new'
  const runtimeId = useRef<string | null>(null)
  const pendingStoredId = useRef<string | null>(null)
  const submitInFlight = useRef(false)
  const filePickerRef = useRef<HTMLInputElement | null>(null)
  const [chat, setChat] = useState<MobileChatState>(EMPTY_CHAT)
  const [draft, setDraft] = useState(() => loadDraft(profile, storedSessionId))
  const [queuedText, setQueuedText] = useState(() => loadOutbox(profile, storedSessionId))
  const [attachments, setAttachments] = useState<MobileAttachment[]>([])
  const [connected, setConnected] = useState(false)
  const [ready, setReady] = useState(false)
  const [connectionEpoch, setConnectionEpoch] = useState(0)
  const [showJumpLatest, setShowJumpLatest] = useState(false)
  const [historyPage, setHistoryPage] = useState({ hasEarlier: false, loading: false, nextOffset: 0 })
  const shouldAutoFollowRef = useRef(true)
  const threadRef = useRef<HTMLDivElement | null>(null)
  const pendingPrependRef = useRef<{ scrollHeight: number; scrollTop: number } | null>(null)
  const historyHydratedRef = useRef(false)

  useEffect(() => {
    saveDraft(profile, storedSessionId, draft)
  }, [draft, profile, storedSessionId])

  useEffect(() => {
    saveOutbox(profile, storedSessionId, queuedText)
  }, [profile, queuedText, storedSessionId])

  useEffect(() => {
    let cancelled = false
    historyHydratedRef.current = false
    let reconnectAttempt = 0
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null

    const hydrateResumableSession = async (resumableId: string) => {
      const [storedResult, resumed] = await Promise.all([
        historyHydratedRef.current
          ? Promise.resolve({ ok: null as null })
          : api.getSessionMessages(resumableId, profile).then(
              stored => ({ ok: true as const, stored }),
              () => ({ ok: false as const })
            ),
        gateway.request<MobileResumeSnapshot>('session.resume', {
          cols: 48,
          omit_messages: true,
          ...(profile ? { profile } : {}),
          session_id: resumableId,
          source: 'web'
        })
      ])
      if (cancelled) return
      runtimeId.current = resumed.session_id
      if (storedResult.ok === true) {
        const returned = storedResult.stored.pagination?.returned ?? storedResult.stored.messages.length
        const limit = storedResult.stored.pagination?.limit ?? 500
        historyHydratedRef.current = true
        setHistoryPage({ hasEarlier: returned >= limit, loading: false, nextOffset: returned })
      }
      setChat(current => hydrateMobileResume({
        ...current,
        error: storedResult.ok === false ? 'Could not load conversation history.' : null,
        messages: storedResult.ok === true ? projectSessionMessages(storedResult.stored.messages) : current.messages
      }, resumed))
    }

    const resumeAfterReconnect = async () => {
      const resumableId = pendingStoredId.current || (!isNew ? storedSessionId : null)
      if (resumableId) await hydrateResumableSession(resumableId)
      else if (!cancelled) setChat(current => ({ ...current, error: null }))
      if (!cancelled) {
        setConnected(true)
        setReady(true)
      }
    }

    const scheduleReconnect = () => {
      if (cancelled || reconnectTimer) return
      const delay = RECONNECT_DELAYS_MS[reconnectAttempt]
      if (delay === undefined) {
        setChat(current => ({ ...current, error: 'Could not reconnect to Hermes. Reopen this chat to retry.' }))
        return
      }
      reconnectAttempt += 1
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null
        void gateway.connect()
          .then(async () => {
            await resumeAfterReconnect()
            reconnectAttempt = 0
          })
          .catch(() => scheduleReconnect())
      }, delay)
    }

    const disposers = [
      gateway.onAny((event: GatewayEvent) => {
        if (event.session_id && event.session_id !== runtimeId.current) return
        if (event.type === 'message.complete' || event.type === 'error') submitInFlight.current = false
        setChat(current => applyMobileGatewayEvent(current, event))
      }),
      gateway.onState(state => {
        const isOpen = state === 'open'
        setConnected(isOpen)
        if (!isOpen) setReady(false)
        if (state === 'closed' || state === 'error') scheduleReconnect()
      })
    ]

    void gateway
      .connect()
      .then(async () => {
        if (cancelled) return
        if (isNew) {
          setReady(true)
          return
        }
        await hydrateResumableSession(storedSessionId)
        if (cancelled) return
        setReady(true)
      })
      .catch((error: Error) => {
        if (!cancelled) {
          setReady(false)
          setChat(current => ({ ...current, error: error.message }))
          scheduleReconnect()
        }
      })

    return () => {
      cancelled = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      disposers.forEach(dispose => dispose())
      gateway.close()
    }
  }, [connectionEpoch, gateway, isNew, navigate, profile, storedSessionId])

  useLayoutEffect(() => {
    const node = threadRef.current
    const pending = pendingPrependRef.current
    if (!node || !pending) return
    node.scrollTop = pending.scrollTop + (node.scrollHeight - pending.scrollHeight)
    pendingPrependRef.current = null
    shouldAutoFollowRef.current = false
  }, [chat.messages])

  useEffect(() => {
    const node = threadRef.current
    if (!node) return
    if (shouldAutoFollowRef.current) {
      node.scrollTop = node.scrollHeight
      setShowJumpLatest(false)
    } else {
      setShowJumpLatest(true)
    }
  }, [chat.messages, chat.tools])

  const trackThreadScroll = useCallback(() => {
    const node = threadRef.current
    if (!node) return
    const nearBottom = node.scrollHeight - node.scrollTop - node.clientHeight <= 80
    shouldAutoFollowRef.current = nearBottom
    if (nearBottom) setShowJumpLatest(false)
  }, [])

  const jumpToLatest = useCallback(() => {
    const node = threadRef.current
    if (!node) return
    shouldAutoFollowRef.current = true
    node.scrollTop = node.scrollHeight
    setShowJumpLatest(false)
  }, [])

  const loadEarlier = useCallback(async () => {
    if (isNew || historyPage.loading || !historyPage.hasEarlier) return
    const node = threadRef.current
    if (node) {
      pendingPrependRef.current = {
        scrollHeight: node.scrollHeight,
        scrollTop: node.scrollTop
      }
    }
    setHistoryPage(current => ({ ...current, loading: true }))
    try {
      const page = await api.getSessionMessages(storedSessionId, profile, {
        limit: 500,
        offset: historyPage.nextOffset,
        order: 'latest'
      })
      const earlier = projectSessionMessages(page.messages)
      setChat(current => {
        const existingIds = new Set(current.messages.map(message => message.id))
        return {
          ...current,
          messages: [...earlier.filter(message => !existingIds.has(message.id)), ...current.messages]
        }
      })
      const returned = page.pagination?.returned ?? page.messages.length
      const limit = page.pagination?.limit ?? 500
      setHistoryPage(current => ({
        hasEarlier: returned >= limit,
        loading: false,
        nextOffset: current.nextOffset + returned
      }))
    } catch (error) {
      pendingPrependRef.current = null
      setHistoryPage(current => ({ ...current, loading: false }))
      setChat(current => ({
        ...current,
        error: error instanceof Error ? error.message : 'Could not load earlier messages.'
      }))
    }
  }, [historyPage.hasEarlier, historyPage.loading, historyPage.nextOffset, isNew, profile, storedSessionId])

  const submit = useCallback(
    async (event: FormEvent) => {
      event.preventDefault()
      const text = draft.trim()
      const pendingAttachments = attachments
      if ((!text && !pendingAttachments.length) || chat.busy || submitInFlight.current) return
      if (!ready) {
        if (pendingAttachments.length) {
          setChat(current => ({ ...current, error: 'Reconnect before sending attachments. Your selection is preserved.' }))
          return
        }
        setQueuedText(text)
        setDraft('')
        setChat(current => ({ ...current, error: null }))
        return
      }
      const optimisticId = `user-${Date.now()}`
      const attachmentNames = pendingAttachments.map(attachment => attachment.file.name).join(', ')
      const optimisticContent = [text, attachmentNames ? `📎 ${attachmentNames}` : ''].filter(Boolean).join('\n')
      submitInFlight.current = true
      setDraft('')
      setAttachments([])
      setChat(current => ({
        ...current,
        busy: true,
        error: null,
        messages: [
          ...current.messages,
          {
            content: optimisticContent,
            id: optimisticId,
            role: 'user'
          }
        ]
      }))
      try {
        let sid = runtimeId.current
        if (!sid) {
          const created = await gateway.request<{ session_id: string; stored_session_id?: string | null }>(
            'session.create',
            {
              cols: 48,
              ...(profile ? { profile } : {}),
              source: 'web',
              title: (text || attachmentNames || 'Attachment').slice(0, 72)
            }
          )
          sid = created.session_id
          runtimeId.current = sid
          pendingStoredId.current = created.stored_session_id || sid
        }
        const fileRefs: string[] = []
        for (const attachment of pendingAttachments) {
          const dataUrl = await readFileAsDataUrl(attachment.file)
          if (attachment.file.type.startsWith('image/')) {
            const attached = await gateway.request<{ attached?: boolean; message?: string }>('image.attach_bytes', {
              content_base64: dataUrl.slice(dataUrl.indexOf(',') + 1),
              filename: attachment.file.name,
              session_id: sid
            })
            if (!attached.attached) throw new Error(attached.message || `Could not attach ${attachment.file.name}`)
          } else {
            const attached = await gateway.request<{ attached?: boolean; message?: string; ref_text?: string }>(
              'file.attach',
              {
                data_url: dataUrl,
                name: attachment.file.name,
                session_id: sid
              }
            )
            if (!attached.attached || !attached.ref_text) {
              throw new Error(attached.message || `Could not attach ${attachment.file.name}`)
            }
            fileRefs.push(attached.ref_text)
          }
        }
        const promptText = [...fileRefs, text].filter(Boolean).join('\n\n')
        await gateway.request('prompt.submit', { session_id: sid, text: promptText }, PROMPT_TIMEOUT_MS)
        submitInFlight.current = false
        if (pendingStoredId.current) {
          const durable = pendingStoredId.current
          pendingStoredId.current = null
          onSessionCreated()
          navigate(`/mobile/chat/${encodeURIComponent(durable)}`, { replace: true })
        }
      } catch (error) {
        submitInFlight.current = false
        setDraft(current => current.trim() ? current : text)
        setAttachments(current => {
          const currentIds = new Set(current.map(attachment => attachment.id))
          return [...pendingAttachments.filter(attachment => !currentIds.has(attachment.id)), ...current]
        })
        setChat(current => ({
          ...current,
          busy: false,
          error: error instanceof Error ? error.message : 'Could not send message',
          messages: current.messages.filter(message => message.id !== optimisticId)
        }))
      }
    },
    [attachments, chat.busy, draft, gateway, navigate, onSessionCreated, profile, ready]
  )

  const selectAttachments = useCallback((files: FileList | File[]) => {
    const selected = Array.from(files)
    const accepted: MobileAttachment[] = []
    for (const file of selected) {
      const limit = file.type.startsWith('image/') ? MAX_MOBILE_IMAGE_BYTES : MAX_MOBILE_ATTACHMENT_BYTES
      if (!file.size || file.size > limit) {
        const maxMb = Math.round(limit / (1024 * 1024))
        setChat(current => ({ ...current, error: `${file.name} must be smaller than ${maxMb} MB.` }))
        continue
      }
      accepted.push({
        file,
        id: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 8)}`
      })
    }
    if (accepted.length) {
      setAttachments(current => [...current, ...accepted])
      setChat(current => ({ ...current, error: null }))
    }
  }, [])

  return (
    <div className={`mobile-chat-shell${attachments.length ? ' has-attachments' : ''}`}>
      <AppHeader
        back={() => navigate('/mobile/chats')}
        detail={connected ? 'Connected to Desktop' : 'Connecting…'}
        title={isNew ? 'New chat' : 'Hermes'}
      />
      <div className="mobile-chat-thread" onScroll={trackThreadScroll} ref={threadRef}>
        {historyPage.hasEarlier && (
          <button
            aria-label="Load earlier messages"
            className="mobile-load-earlier"
            disabled={historyPage.loading}
            onClick={() => void loadEarlier()}
            type="button"
          >
            {historyPage.loading ? 'Loading earlier messages…' : 'Load earlier messages'}
          </button>
        )}
        {!chat.messages.length && (
          <div className="mobile-chat-empty">
            <span className="mobile-wordmark is-large">H</span>
            <h1>What can I help with?</h1>
            <p>This conversation will also appear in Hermes Desktop.</p>
          </div>
        )}
        {chat.messages.map(message => (
          <ChatBubble key={message.id} message={message} />
        ))}
        {!!chat.tools.length && (
          <div className="mobile-tool-strip">
            {chat.tools.slice(-3).map(tool => (
              <span key={tool.id}>
                {tool.status === 'complete' ? <CheckCircle2 /> : <Clock3 />} {tool.name}
              </span>
            ))}
          </div>
        )}
        {chat.error && (
          <div className="mobile-error" role="alert">
            {chat.error}
            {!ready && (
              <button
                aria-label="Retry Hermes connection"
                onClick={() => {
                  setChat(current => ({ ...current, error: null }))
                  setConnectionEpoch(current => current + 1)
                }}
                type="button"
              >
                Retry now
              </button>
            )}
          </div>
        )}
      </div>
      {queuedText && (
        <aside className="mobile-outbox" role="status">
          <span>Queued until Hermes reconnects</span>
          <button
            aria-label="Review queued message"
            onClick={() => {
              if (draft.trim()) {
                setChat(current => ({ ...current, error: 'Clear or send the current draft before reviewing the queued message.' }))
                return
              }
              setDraft(queuedText)
              setQueuedText('')
            }}
            type="button"
          >
            Review
          </button>
        </aside>
      )}
      {showJumpLatest && (
        <button
          aria-label="Jump to latest message"
          className="mobile-jump-latest"
          onClick={jumpToLatest}
          type="button"
        >
          <ArrowDown />
          Latest
        </button>
      )}
      <form className="mobile-composer" onSubmit={submit}>
        {!!attachments.length && (
          <div className="mobile-attachment-list" aria-label="Selected attachments">
            {attachments.map(attachment => (
              <span className="mobile-attachment-chip" key={attachment.id}>
                <FileUp />
                <span>{attachment.file.name}</span>
                <button
                  aria-label={`Remove ${attachment.file.name}`}
                  onClick={() => setAttachments(current => current.filter(item => item.id !== attachment.id))}
                  type="button"
                >
                  <X />
                </button>
              </span>
            ))}
          </div>
        )}
        <input
          accept="image/*,.pdf,.txt,.md,.csv,.json,.yaml,.yml,.doc,.docx,.xls,.xlsx,.ppt,.pptx"
          className="mobile-file-picker"
          disabled={chat.busy || submitInFlight.current}
          multiple
          onChange={event => {
            if (event.currentTarget.files) selectAttachments(event.currentTarget.files)
            event.currentTarget.value = ''
          }}
          ref={filePickerRef}
          type="file"
        />
        <IconButton disabled={chat.busy || submitInFlight.current} label="Add attachment" onClick={() => filePickerRef.current?.click()}>
          <Plus />
        </IconButton>
        <textarea
          aria-label="Message Hermes"
          disabled={chat.busy}
          onChange={event => setDraft(event.target.value)}
          placeholder={chat.busy ? 'Hermes is responding…' : ready ? 'Message Hermes…' : 'Write now — Hermes will send when connected…'}
          rows={1}
          value={draft}
        />
        <button
          aria-label={ready ? 'Send message' : 'Queue message'}
          className="mobile-send"
          disabled={(!draft.trim() && !attachments.length) || chat.busy}
          type="submit"
        >
          <Send />
        </button>
      </form>
    </div>
  )
}

export function MobileApp() {
  useMobileViewportSync()
  const updateReady = usePwaUpdateReady()
  const { pathname } = useLocation()
  const { currentProfile, profile } = useProfileScope()
  const [sessions, setSessions] = useState<SessionInfo[]>([])
  const [sessionsTotal, setSessionsTotal] = useState(0)
  const [loadingMoreSessions, setLoadingMoreSessions] = useState(false)
  const [cronJobs, setCronJobs] = useState<CronJob[]>([])
  const [status, setStatus] = useState<StatusResponse | null>(null)
  const [statusLoad, setStatusLoad] = useState<ScopedLoadState>({ phase: 'loading', scope: null })
  const [sessionsLoad, setSessionsLoad] = useState<ScopedLoadState>({ phase: 'loading', scope: null })
  const [tasksLoad, setTasksLoad] = useState<ScopedLoadState>({ phase: 'loading', scope: null })
  const [sessionsRefreshKey, setSessionsRefreshKey] = useState(0)
  const selectedProfile = profile || currentProfile

  useEffect(() => {
    let cancelled = false
    const requestScope = selectedProfile

    void api.getStatus().then(
      value => {
        if (cancelled) return
        setStatus(value)
        setStatusLoad({ phase: 'ready', scope: requestScope })
      },
      () => {
        if (cancelled) return
        setStatus(null)
        setStatusLoad({ phase: 'error', scope: requestScope })
      }
    )
    void api.getCronJobs(requestScope).then(
      value => {
        if (cancelled) return
        setCronJobs(value)
        setTasksLoad({ phase: 'ready', scope: requestScope })
      },
      () => {
        if (cancelled) return
        setCronJobs([])
        setTasksLoad({ phase: 'error', scope: requestScope })
      }
    )

    return () => {
      cancelled = true
    }
  }, [selectedProfile])

  useEffect(() => {
    let cancelled = false
    const requestScope = selectedProfile

    void api.getSessions(30, 0, { order: 'recent', profile }).then(
      value => {
        if (cancelled) return
        setSessions(value.sessions)
        setSessionsTotal(value.total)
        setSessionsLoad({ phase: 'ready', scope: requestScope })
      },
      () => {
        if (cancelled) return
        setSessions([])
        setSessionsTotal(0)
        setSessionsLoad({ phase: 'error', scope: requestScope })
      }
    )

    return () => {
      cancelled = true
    }
  }, [profile, selectedProfile, sessionsRefreshKey])

  const loadMoreSessions = useCallback(async () => {
    if (loadingMoreSessions || sessions.length >= sessionsTotal) return
    setLoadingMoreSessions(true)
    try {
      const value = await api.getSessions(30, sessions.length, { order: 'recent', profile })
      setSessions(current => {
        const existing = new Set(current.map(session => session.id))
        return [...current, ...value.sessions.filter(session => !existing.has(session.id))]
      })
      setSessionsTotal(value.total)
    } finally {
      setLoadingMoreSessions(false)
    }
  }, [loadingMoreSessions, profile, sessions.length, sessionsTotal])

  const statusPhase: LoadPhase = statusLoad.scope === selectedProfile ? statusLoad.phase : 'loading'
  const sessionsPhase: LoadPhase = sessionsLoad.scope === selectedProfile ? sessionsLoad.phase : 'loading'
  const tasksPhase: LoadPhase = tasksLoad.scope === selectedProfile ? tasksLoad.phase : 'loading'
  const visibleStatus = statusLoad.scope === selectedProfile ? status : null
  const visibleSessions = sessionsLoad.scope === selectedProfile ? sessions : []
  const orderedCronJobs = useMemo(
    () => orderCronJobs(tasksLoad.scope === selectedProfile ? cronJobs : []),
    [cronJobs, selectedProfile, tasksLoad.scope]
  )

  const chatMatch = pathname.match(/^\/mobile\/chat\/([^/]+)\/?$/)
  if (chatMatch?.[1]) {
    const storedSessionId = safeDecodePathSegment(chatMatch[1])
    if (!storedSessionId) return <Navigate replace to="/mobile/chats" />
    return (
      <>
        <ChatScreen
          key={`${profile}\u0000${storedSessionId}`}
          onSessionCreated={() => setSessionsRefreshKey(current => current + 1)}
          profile={profile}
          storedSessionId={storedSessionId}
        />
        <PwaUpdateBanner visible={updateReady} />
      </>
    )
  }

  const active = routeTab(pathname)
  return (
    <div className="mobile-app-shell">
      {active === 'home' && (
        <HomeScreen
          cronJobs={orderedCronJobs}
          sessions={visibleSessions}
          sessionsPhase={sessionsPhase}
          status={visibleStatus}
          statusPhase={statusPhase}
          tasksPhase={tasksPhase}
        />
      )}
      {active === 'chats' && (
        <ChatsScreen
          canLoadMore={visibleSessions.length < sessionsTotal}
          loadingMore={loadingMoreSessions}
          onLoadMore={() => void loadMoreSessions()}
          phase={sessionsPhase}
          profile={profile}
          sessions={visibleSessions}
        />
      )}
      {active === 'tasks' && <TasksScreen jobs={orderedCronJobs} phase={tasksPhase} profile={selectedProfile} />}
      {active === 'more' && <MoreScreen />}
      <BottomNavigation active={active} />
      <PwaUpdateBanner visible={updateReady} />
    </div>
  )
}
