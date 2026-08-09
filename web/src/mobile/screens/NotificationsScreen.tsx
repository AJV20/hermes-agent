import { Bell, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router'

import { api, type MobileNotification } from '@/lib/api'
import type { LoadPhase } from '../types'
import { relativeTime } from '../mobile-utils'
import { AppHeader } from '../ui/primitives'

export function NotificationsScreen({ profile }: { profile: string }) {
  const navigate = useNavigate()
  const [items, setItems] = useState<MobileNotification[]>([])
  const [phase, setPhase] = useState<LoadPhase>('loading')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    api.getMobileNotifications(profile).then(
      response => {
        if (cancelled) return
        setItems(response.items)
        setPhase('ready')
      },
      () => {
        if (!cancelled) setPhase('error')
      }
    )
    return () => { cancelled = true }
  }, [profile])

  const markRead = useCallback(async (notification: MobileNotification) => {
    if (notification.read_at) return
    try {
      const updated = await api.markMobileNotificationRead(notification.id, profile)
      setItems(current => current.map(item => item.id === updated.id ? updated : item))
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not mark the notification read.')
    }
  }, [profile])

  const dismiss = useCallback(async (notification: MobileNotification) => {
    try {
      await api.dismissMobileNotification(notification.id, profile)
      setItems(current => current.filter(item => item.id !== notification.id))
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not dismiss the notification.')
    }
  }, [profile])

  const unread = items.filter(item => !item.read_at).length
  return (
    <>
      <AppHeader back={() => navigate('/mobile/more')} detail={unread ? `${unread} unread` : 'All caught up'} title="Notifications" />
      <main className="mobile-screen mobile-notification-screen">
        <div className="mobile-page-heading">
          <div>
            <p className="mobile-eyebrow">Hermes activity</p>
            <h1>Notifications</h1>
          </div>
        </div>
        <section className="mobile-notification-privacy">
          <Bell />
          <span><strong>Private by design</strong><small>Notification details stay behind your authenticated Hermes dashboard.</small></span>
        </section>
        {error && <div className="mobile-inline-error" role="alert">{error}</div>}
        {phase === 'loading' && <div className="mobile-empty-card" aria-busy="true">Loading notifications…</div>}
        {phase === 'error' && <div className="mobile-empty-card" role="alert">Could not load notifications.</div>}
        {phase === 'ready' && !items.length && <div className="mobile-empty-card">No notifications need your attention.</div>}
        {phase === 'ready' && !!items.length && (
          <div className="mobile-notification-list">
            {items.map(notification => {
              const content = (
                <>
                  <span className={`mobile-notification-dot is-${notification.level}${notification.read_at ? ' is-read' : ''}`} />
                  <span className="mobile-notification-copy">
                    <strong>{notification.title}</strong>
                    <small>{notification.body}</small>
                    <time>{relativeTime(notification.created_at)}</time>
                  </span>
                </>
              )
              return (
                <article className={notification.read_at ? 'is-read' : ''} key={notification.id}>
                  {notification.target ? (
                    <Link onClick={() => void markRead(notification)} to={notification.target}>{content}</Link>
                  ) : (
                    <button className="mobile-notification-open" onClick={() => void markRead(notification)} type="button">{content}</button>
                  )}
                  <button aria-label={`Dismiss ${notification.title}`} className="mobile-notification-dismiss" onClick={() => void dismiss(notification)} type="button"><X /></button>
                </article>
              )
            })}
          </div>
        )}
      </main>
    </>
  )
}
