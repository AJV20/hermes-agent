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
  Plus,
  Send,
  Settings,
  Sparkles,
  Wifi
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

function IconButton({ children, label, onClick }: { children: ReactNode; label: string; onClick?: () => void }) {
  return (
    <button className="mobile-icon-button" aria-label={label} onClick={onClick} type="button">
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

function SessionRow({ session }: { session: SessionInfo }) {
  return (
    <Link className="mobile-session-row" to={`/mobile/chat/${encodeURIComponent(session.id)}`}>
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

function ChatsScreen({ phase, sessions }: { phase: LoadPhase; sessions: SessionInfo[] }) {
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
        <div className="mobile-session-list">
          {phase === 'ready' && sessions.map(session => (
            <SessionRow key={session.id} session={session} />
          ))}
          {phase === 'loading' && <div className="mobile-empty-card" aria-busy="true">Loading conversations…</div>}
          {phase === 'error' && <div className="mobile-empty-card" role="alert">Could not load conversations.</div>}
          {phase === 'ready' && !sessions.length && <div className="mobile-empty-card">No conversations yet.</div>}
        </div>
      </main>
    </>
  )
}

function TasksScreen({ jobs, phase }: { jobs: CronJob[]; phase: LoadPhase }) {
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
        <div className="mobile-task-list">
          {phase === 'ready' && jobs.map(job => (
            <DesktopDocumentLink className="mobile-task-card" key={job.id} to="/cron">
              <span className="mobile-task-icon">{job.last_status === 'success' ? <CheckCircle2 /> : <Clock3 />}</span>
              <span>
                <strong>{job.name || 'Hermes task'}</strong>
                <small>{formatJobRun(job)}</small>
              </span>
              <span className={`mobile-status-pill ${job.enabled ? '' : 'is-muted'}`}>
                {job.enabled ? 'Enabled' : 'Paused'}
              </span>
            </DesktopDocumentLink>
          ))}
          {phase === 'loading' && <div className="mobile-empty-card" aria-busy="true">Loading scheduled tasks…</div>}
          {phase === 'error' && <div className="mobile-empty-card" role="alert">Could not load scheduled tasks.</div>}
          {phase === 'ready' && !jobs.length && <div className="mobile-empty-card">No scheduled tasks.</div>}
        </div>
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
  const [chat, setChat] = useState<MobileChatState>(EMPTY_CHAT)
  const [draft, setDraft] = useState('')
  const [connected, setConnected] = useState(false)
  const [ready, setReady] = useState(false)
  const [showJumpLatest, setShowJumpLatest] = useState(false)
  const [historyPage, setHistoryPage] = useState({ hasEarlier: false, loading: false, nextOffset: 0 })
  const shouldAutoFollowRef = useRef(true)
  const threadRef = useRef<HTMLDivElement | null>(null)
  const pendingPrependRef = useRef<{ scrollHeight: number; scrollTop: number } | null>(null)

  useEffect(() => {
    let cancelled = false
    let reconnectAttempt = 0
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null

    const resumeAfterReconnect = async () => {
      const resumableId = pendingStoredId.current || (!isNew ? storedSessionId : null)
      if (resumableId) {
        const resumed = await gateway.request<MobileResumeSnapshot>('session.resume', {
          cols: 48,
          omit_messages: true,
          ...(profile ? { profile } : {}),
          session_id: resumableId,
          source: 'web'
        })
        runtimeId.current = resumed.session_id
        setChat(current => hydrateMobileResume({ ...current, error: null }, resumed))
      }
      if (!cancelled) {
        setConnected(true)
        setReady(true)
        setChat(current => ({ ...current, error: null }))
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
        const [storedResult, resumed] = await Promise.all([
          api.getSessionMessages(storedSessionId, profile).then(
            stored => ({ ok: true as const, stored }),
            () => ({ ok: false as const })
          ),
          gateway.request<MobileResumeSnapshot>('session.resume', {
            cols: 48,
            omit_messages: true,
            ...(profile ? { profile } : {}),
            session_id: storedSessionId,
            source: 'web'
          })
        ])
        if (cancelled) return
        runtimeId.current = resumed.session_id
        setReady(true)
        if (storedResult.ok) {
          const returned = storedResult.stored.pagination?.returned ?? storedResult.stored.messages.length
          const limit = storedResult.stored.pagination?.limit ?? 500
          setHistoryPage({ hasEarlier: returned >= limit, loading: false, nextOffset: returned })
        }
        setChat(current => hydrateMobileResume({
          ...current,
          error: storedResult.ok ? current.error : 'Could not load conversation history.',
          messages: storedResult.ok ? projectSessionMessages(storedResult.stored.messages) : current.messages
        }, resumed))
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
  }, [gateway, isNew, navigate, profile, storedSessionId])

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
      if (!ready || !text || chat.busy || submitInFlight.current) return
      const optimisticId = `user-${Date.now()}`
      submitInFlight.current = true
      setDraft('')
      setChat(current => ({
        ...current,
        busy: true,
        error: null,
        messages: [
          ...current.messages,
          {
            content: text,
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
              title: text.slice(0, 72)
            }
          )
          sid = created.session_id
          runtimeId.current = sid
          pendingStoredId.current = created.stored_session_id || sid
        }
        await gateway.request('prompt.submit', { session_id: sid, text }, PROMPT_TIMEOUT_MS)
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
        setChat(current => ({
          ...current,
          busy: false,
          error: error instanceof Error ? error.message : 'Could not send message',
          messages: current.messages.filter(message => message.id !== optimisticId)
        }))
      }
    },
    [chat.busy, draft, gateway, navigate, onSessionCreated, profile, ready]
  )

  return (
    <div className="mobile-chat-shell">
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
          </div>
        )}
      </div>
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
        <DesktopDocumentLink aria-label="Open files" className="mobile-icon-button" to="/files">
          <Plus />
        </DesktopDocumentLink>
        <textarea
          aria-label="Message Hermes"
          disabled={!ready || chat.busy}
          onChange={event => setDraft(event.target.value)}
          placeholder={chat.busy ? 'Hermes is responding…' : ready ? 'Message Hermes…' : isNew ? 'Connecting to Hermes…' : 'Resuming conversation…'}
          rows={1}
          value={draft}
        />
        <button
          aria-label="Send message"
          className="mobile-send"
          disabled={!ready || !draft.trim() || chat.busy}
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
  const { pathname } = useLocation()
  const { currentProfile, profile } = useProfileScope()
  const [sessions, setSessions] = useState<SessionInfo[]>([])
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
        setSessionsLoad({ phase: 'ready', scope: requestScope })
      },
      () => {
        if (cancelled) return
        setSessions([])
        setSessionsLoad({ phase: 'error', scope: requestScope })
      }
    )

    return () => {
      cancelled = true
    }
  }, [profile, selectedProfile, sessionsRefreshKey])

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
      <ChatScreen
        key={`${profile}\u0000${storedSessionId}`}
        onSessionCreated={() => setSessionsRefreshKey(current => current + 1)}
        profile={profile}
        storedSessionId={storedSessionId}
      />
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
      {active === 'chats' && <ChatsScreen phase={sessionsPhase} sessions={visibleSessions} />}
      {active === 'tasks' && <TasksScreen jobs={orderedCronJobs} phase={tasksPhase} />}
      {active === 'more' && <MoreScreen />}
      <BottomNavigation active={active} />
    </div>
  )
}
