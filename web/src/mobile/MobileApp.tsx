import {
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
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router'

import { Markdown } from '@/components/Markdown'
import { useProfileScope } from '@/contexts/useProfileScope'
import { api, type CronJob, type SessionInfo, type StatusResponse } from '@/lib/api'
import { GatewayClient, type GatewayEvent } from '@/lib/gatewayClient'
import {
  applyMobileGatewayEvent,
  projectSessionMessages,
  type MobileChatMessage,
  type MobileChatState
} from './mobile-chat-state'
import './mobile-app.css'

const EMPTY_CHAT: MobileChatState = {
  busy: false,
  error: null,
  messages: [],
  tools: []
}
const PROMPT_TIMEOUT_MS = 1_800_000

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
          <Link className={active === item.tab ? 'is-active' : ''} key={item.path} to={item.path}>
            <Icon aria-hidden="true" />
            <span>{item.label}</span>
          </Link>
        )
      })}
    </nav>
  )
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
  status
}: {
  cronJobs: CronJob[]
  sessions: SessionInfo[]
  status: StatusResponse | null
}) {
  const navigate = useNavigate()
  const nextJob = cronJobs.find(job => job.enabled)
  const recent = sessions[0]
  const connected = Boolean(status?.gateway_running || status?.gateway_state === 'running')
  return (
    <>
      <AppHeader detail={connected ? 'Connected to Desktop' : 'Desktop unavailable'} />
      <main className="mobile-screen mobile-home-screen">
        <section className="mobile-hero">
          <p className="mobile-eyebrow">Your agent, wherever you are</p>
          <h1>Good evening.</h1>
          <p>{status?.active_sessions ? `${status.active_sessions} session active.` : 'Hermes is ready.'}</p>
        </section>

        <section className="mobile-quick-grid" aria-label="Quick actions">
          <QuickAction icon={<Plus />} label="New chat" to="/mobile/chat/new" />
          <QuickAction icon={<MessageCircle />} label="Chats" to="/mobile/chats" />
          <QuickAction icon={<FileUp />} label="Upload" to="/files" />
          <QuickAction icon={<Wifi />} label="Desktop" to="/system" />
        </section>

        {recent && (
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
          {nextJob ? (
            <article className="mobile-task-card">
              <span className="mobile-task-icon">
                <Clock3 />
              </span>
              <span>
                <strong>{nextJob.name || 'Scheduled Hermes task'}</strong>
                <small>{nextJob.schedule_display || nextJob.next_run_at || 'Scheduled'}</small>
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

function ChatsScreen({ sessions }: { sessions: SessionInfo[] }) {
  return (
    <>
      <AppHeader detail={`${sessions.length} recent conversations`} />
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
          {sessions.map(session => (
            <SessionRow key={session.id} session={session} />
          ))}
          {!sessions.length && <div className="mobile-empty-card">No conversations yet.</div>}
        </div>
      </main>
    </>
  )
}

function TasksScreen({ jobs }: { jobs: CronJob[] }) {
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
          {jobs.map(job => (
            <Link className="mobile-task-card" key={job.id} to="/cron">
              <span className="mobile-task-icon">{job.last_status === 'success' ? <CheckCircle2 /> : <Clock3 />}</span>
              <span>
                <strong>{job.name || 'Hermes task'}</strong>
                <small>{job.next_run_at || job.schedule_display || job.last_status || 'Scheduled'}</small>
              </span>
              <span className={`mobile-status-pill ${job.enabled ? '' : 'is-muted'}`}>
                {job.enabled ? 'Enabled' : 'Paused'}
              </span>
            </Link>
          ))}
          {!jobs.length && <div className="mobile-empty-card">No scheduled tasks.</div>}
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
              <Link key={item.to} to={item.to}>
                <Icon />
                <strong>{item.label}</strong>
                <ChevronRight />
              </Link>
            )
          })}
        </div>
      </main>
    </>
  )
}

function ChatBubble({ message }: { message: MobileChatMessage }) {
  return (
    <article className={`mobile-bubble is-${message.role}`}>
      {message.role === 'assistant' ? (
        <Markdown content={message.content} streaming={message.streaming} />
      ) : (
        <p>{message.content}</p>
      )}
    </article>
  )
}

function ChatScreen({ profile, storedSessionId }: { profile: string; storedSessionId: string }) {
  const navigate = useNavigate()
  const gateway = useMemo(() => new GatewayClient(), [])
  const isNew = storedSessionId === 'new'
  const runtimeId = useRef<string | null>(null)
  const pendingStoredId = useRef<string | null>(null)
  const submitInFlight = useRef(false)
  const [chat, setChat] = useState<MobileChatState>(EMPTY_CHAT)
  const [draft, setDraft] = useState('')
  const [connected, setConnected] = useState(false)
  const [ready, setReady] = useState(isNew)
  const threadRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    let cancelled = false
    const disposers = [
      gateway.onAny((event: GatewayEvent) => {
        if (event.session_id && event.session_id !== runtimeId.current) return
        if (event.type === 'message.complete' || event.type === 'error') submitInFlight.current = false
        setChat(current => applyMobileGatewayEvent(current, event))
      }),
      gateway.onState(state => setConnected(state === 'open'))
    ]

    void gateway
      .connect()
      .then(async () => {
        if (cancelled || isNew) return
        const [stored, resumed] = await Promise.all([
          api.getSessionMessages(storedSessionId, profile).catch(() => ({ messages: [], session_id: storedSessionId })),
          gateway.request<{ session_id: string }>('session.resume', {
            cols: 48,
            ...(profile ? { profile } : {}),
            session_id: storedSessionId,
            source: 'web'
          })
        ])
        if (cancelled) return
        runtimeId.current = resumed.session_id
        setReady(true)
        setChat(current => ({ ...current, messages: projectSessionMessages(stored.messages) }))
      })
      .catch((error: Error) => {
        if (!cancelled) {
          setReady(false)
          setChat(current => ({ ...current, error: error.message }))
        }
      })

    return () => {
      cancelled = true
      disposers.forEach(dispose => dispose())
      gateway.close()
    }
  }, [gateway, isNew, navigate, profile, storedSessionId])

  useEffect(() => {
    const node = threadRef.current
    if (node) node.scrollTop = node.scrollHeight
  }, [chat.messages, chat.tools])

  const submit = useCallback(
    async (event: FormEvent) => {
      event.preventDefault()
      const text = draft.trim()
      if (!ready || !text || chat.busy || submitInFlight.current) return
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
            id: `user-${Date.now()}`,
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
          navigate(`/mobile/chat/${encodeURIComponent(durable)}`, { replace: true })
        }
      } catch (error) {
        submitInFlight.current = false
        setChat(current => ({
          ...current,
          busy: false,
          error: error instanceof Error ? error.message : 'Could not send message'
        }))
      }
    },
    [chat.busy, draft, gateway, navigate, profile, ready]
  )

  return (
    <div className="mobile-chat-shell">
      <AppHeader
        back={() => navigate('/mobile/chats')}
        detail={connected ? 'Connected to Desktop' : 'Connecting…'}
        title={isNew ? 'New chat' : 'Hermes'}
      />
      <div className="mobile-chat-thread" ref={threadRef}>
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
      <form className="mobile-composer" onSubmit={submit}>
        <IconButton label="Open files" onClick={() => navigate('/files')}>
          <Plus />
        </IconButton>
        <textarea
          aria-label="Message Hermes"
          disabled={!ready}
          onChange={event => setDraft(event.target.value)}
          placeholder={ready ? 'Message Hermes…' : 'Resuming conversation…'}
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
  const { pathname } = useLocation()
  const { profile } = useProfileScope()
  const [sessions, setSessions] = useState<SessionInfo[]>([])
  const [cronJobs, setCronJobs] = useState<CronJob[]>([])
  const [status, setStatus] = useState<StatusResponse | null>(null)

  useEffect(() => {
    let cancelled = false
    void Promise.allSettled([
      api.getStatus(),
      api.getSessions(30, 0, { order: 'recent', profile }),
      api.getCronJobs('all')
    ]).then(results => {
      if (cancelled) return
      const [statusResult, sessionsResult, cronResult] = results
      if (statusResult?.status === 'fulfilled') setStatus(statusResult.value)
      if (sessionsResult?.status === 'fulfilled') setSessions(sessionsResult.value.sessions)
      if (cronResult?.status === 'fulfilled') setCronJobs(cronResult.value)
    })
    return () => {
      cancelled = true
    }
  }, [profile])

  const chatMatch = pathname.match(/^\/mobile\/chat\/([^/]+)\/?$/)
  if (chatMatch?.[1]) {
    const storedSessionId = safeDecodePathSegment(chatMatch[1])
    if (!storedSessionId) return <Navigate replace to="/mobile/chats" />
    return <ChatScreen key={`${profile}\u0000${storedSessionId}`} profile={profile} storedSessionId={storedSessionId} />
  }

  const active = routeTab(pathname)
  return (
    <div className="mobile-app-shell">
      {active === 'home' && <HomeScreen cronJobs={cronJobs} sessions={sessions} status={status} />}
      {active === 'chats' && <ChatsScreen sessions={sessions} />}
      {active === 'tasks' && <TasksScreen jobs={cronJobs} />}
      {active === 'more' && <MoreScreen />}
      <BottomNavigation active={active} />
    </div>
  )
}
