import { ArrowLeft, ChevronRight, Home, ListTodo, Menu, MessageCircle, MoreHorizontal } from 'lucide-react'
import type { ComponentPropsWithoutRef, ReactNode } from 'react'
import { Link } from 'react-router'

import { HERMES_BASE_PATH, type SessionInfo } from '@/lib/api'
import { desktopDocumentHref } from '../mobile-desktop-link'
import { relativeTime, routeTab, sessionLabel } from '../mobile-utils'

export function IconButton({ children, disabled = false, label, onClick }: { children: ReactNode; disabled?: boolean; label: string; onClick?: () => void }) {
  return (
    <button className="mobile-icon-button" aria-label={label} disabled={disabled} onClick={onClick} type="button">
      {children}
    </button>
  )
}

export function AppHeader({ back, detail, title = 'Hermes' }: { back?: () => void; detail?: string; title?: string }) {
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

export function BottomNavigation({ active }: { active: ReturnType<typeof routeTab> }) {
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

export function DesktopDocumentLink({ to, ...props }: { to: string } & Omit<ComponentPropsWithoutRef<'a'>, 'href'>) {
  return <a {...props} href={desktopDocumentHref(to, HERMES_BASE_PATH)} />
}

export function QuickAction({ icon, label, to }: { icon: ReactNode; label: string; to: string }) {
  return (
    <Link className="mobile-quick-action" to={to}>
      {icon}
      <strong>{label}</strong>
    </Link>
  )
}

export function SessionRow({ onActions, session }: { onActions?: () => void; session: SessionInfo }) {
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
