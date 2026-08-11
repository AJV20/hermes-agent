import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, useLocation } from 'react-router'

import { useProfileScope } from '@/contexts/useProfileScope'
import { api, type CronJob, type MobileNotification, type SessionInfo, type StatusResponse } from '@/lib/api'

import { loadMobilePreferences, type MobilePreferences } from './mobile-preferences'
import { useMobileViewportSync, usePwaUpdateReady } from './mobile-hooks'
import { PwaUpdateBanner } from './ui/PwaUpdateBanner'
import { orderCronJobs, routeTab, safeDecodePathSegment } from './mobile-utils'
import { ChatsScreen } from './screens/ChatsScreen'
import { HomeScreen } from './screens/HomeScreen'
import { MoreScreen } from './screens/MoreScreen'
import { NotificationsScreen } from './screens/NotificationsScreen'
import { PushSettingsScreen } from './screens/PushSettingsScreen'
import { TasksScreen } from './screens/TasksScreen'
import type { LoadPhase, ScopedLoadState } from './types'
import { BottomNavigation } from './ui/primitives'
import './mobile-app.css'

const ChatScreen = lazy(() => import('./chat/ChatScreen').then(module => ({ default: module.ChatScreen })))

export function MobileApp() {
  useMobileViewportSync()
  const [updateReady, deferUpdate] = usePwaUpdateReady()
  const { pathname } = useLocation()
  const { currentProfile, profile } = useProfileScope()
  const [sessions, setSessions] = useState<SessionInfo[]>([])
  const [sessionsTotal, setSessionsTotal] = useState(0)
  const [archivedSessions, setArchivedSessions] = useState(false)
  const [loadingMoreSessions, setLoadingMoreSessions] = useState(false)
  const [sessionsPageError, setSessionsPageError] = useState(false)
  const [cronJobs, setCronJobs] = useState<CronJob[]>([])
  const [notificationsLoad, setNotificationsLoad] = useState<{ items: MobileNotification[]; scope: string }>({ items: [], scope: '' })
  const [preferences, setPreferences] = useState<MobilePreferences>(() => loadMobilePreferences('default'))
  const [status, setStatus] = useState<StatusResponse | null>(null)
  const [statusLoad, setStatusLoad] = useState<ScopedLoadState>({ phase: 'loading', scope: null })
  const [sessionsLoad, setSessionsLoad] = useState<ScopedLoadState>({ phase: 'loading', scope: null })
  const [tasksLoad, setTasksLoad] = useState<ScopedLoadState>({ phase: 'loading', scope: null })
  const [sessionsRefreshKey, setSessionsRefreshKey] = useState(0)
  const [chatUpdateBlocked, setChatUpdateBlocked] = useState(false)
  const selectedProfile = profile || currentProfile
  const [notificationError, setNotificationError] = useState<string | null>(null)
  const sessionsScope = `${selectedProfile}\u0000${archivedSessions ? 'archived' : 'active'}`
  const sessionsScopeRef = useRef(sessionsScope)

  useEffect(() => {
    setPreferences(loadMobilePreferences(selectedProfile))
    let cancelled = false
    const requestScope = selectedProfile
    void api.getMobileNotifications(profile).then(
      value => { if (!cancelled) setNotificationsLoad({ items: value.items, scope: requestScope }) },
      () => { if (!cancelled) setNotificationsLoad({ items: [], scope: requestScope }) }
    )
    return () => { cancelled = true }
  }, [profile, selectedProfile])

  const markNotificationRead = useCallback(async (notification: MobileNotification) => {
    if (notification.read_at) return
    setNotificationError(null)
    try {
      const updated = await api.markMobileNotificationRead(notification.id, profile)
      setNotificationsLoad(current => current.scope === selectedProfile ? {
        ...current,
        items: current.items.map(item => item.id === updated.id ? updated : item)
      } : current)
    } catch (error) {
      setNotificationError(error instanceof Error ? error.message : 'Could not mark the notification read.')
    }
  }, [profile, selectedProfile])

  useEffect(() => {
    sessionsScopeRef.current = sessionsScope
  }, [sessionsScope])

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
    const requestScope = sessionsScope

    void api.getSessions(30, 0, {
      ...(archivedSessions ? { archived: 'only' as const } : {}),
      order: 'recent',
      profile
    }).then(
      value => {
        if (cancelled) return
        setSessions(value.sessions)
        setSessionsTotal(value.total)
        setSessionsPageError(false)
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
  }, [archivedSessions, profile, sessionsRefreshKey, sessionsScope])

  const loadMoreSessions = useCallback(async () => {
    if (loadingMoreSessions || sessions.length >= sessionsTotal) return
    const requestScope = sessionsScope
    setSessionsPageError(false)
    setLoadingMoreSessions(true)
    try {
      const value = await api.getSessions(30, sessions.length, {
        ...(archivedSessions ? { archived: 'only' as const } : {}),
        order: 'recent',
        profile
      })
      if (sessionsScopeRef.current !== requestScope) return
      setSessions(current => {
        const existing = new Set(current.map(session => session.id))
        return [...current, ...value.sessions.filter(session => !existing.has(session.id))]
      })
      setSessionsTotal(value.total)
    } catch {
      if (sessionsScopeRef.current === requestScope) setSessionsPageError(true)
    } finally {
      setLoadingMoreSessions(false)
    }
  }, [archivedSessions, loadingMoreSessions, profile, sessions.length, sessionsScope, sessionsTotal])

  const statusPhase: LoadPhase = statusLoad.scope === selectedProfile ? statusLoad.phase : 'loading'
  const sessionsPhase: LoadPhase = sessionsLoad.scope === sessionsScope ? sessionsLoad.phase : 'loading'
  const tasksPhase: LoadPhase = tasksLoad.scope === selectedProfile ? tasksLoad.phase : 'loading'
  const visibleStatus = statusLoad.scope === selectedProfile ? status : null
  const visibleSessions = sessionsLoad.scope === sessionsScope ? sessions : []
  const visibleNotifications = notificationsLoad.scope === selectedProfile ? notificationsLoad.items : []
  const orderedCronJobs = useMemo(
    () => orderCronJobs(tasksLoad.scope === selectedProfile ? cronJobs : []),
    [cronJobs, selectedProfile, tasksLoad.scope]
  )

  const chatMatch = pathname.match(/^\/mobile\/chat\/([^/]+)\/?$/)
  if (chatMatch?.[1]) {
    const storedSessionId = safeDecodePathSegment(chatMatch[1])
    if (!storedSessionId) return <Navigate replace to="/mobile/chats" />
    return (
      <div className="mobile-chat-route">
        <Suspense fallback={<div className="mobile-chat-shell"><div aria-busy="true" className="mobile-empty-card">Opening conversation…</div></div>}>
          <ChatScreen
            key={`${profile}\u0000${storedSessionId}`}
            onSessionCreated={() => setSessionsRefreshKey(current => current + 1)}
            onUpdateBlockedChange={setChatUpdateBlocked}
            profile={profile}
            storedSessionId={storedSessionId}
          />
        </Suspense>
        <PwaUpdateBanner blocked={chatUpdateBlocked} onLater={deferUpdate} visible={updateReady} />
      </div>
    )
  }

  const active = routeTab(pathname)
  return (
    <div className="mobile-app-shell">
      {active === 'home' && (
        <HomeScreen
          cronJobs={orderedCronJobs}
          notificationError={notificationError}
          notifications={visibleNotifications}
          onMarkNotificationRead={notification => void markNotificationRead(notification)}
          preferences={preferences}
          profile={profile}
          sessions={visibleSessions}
          sessionsPhase={sessionsPhase}
          status={visibleStatus}
          statusPhase={statusPhase}
          tasksPhase={tasksPhase}
        />
      )}
      {active === 'chats' && (
        <ChatsScreen
          archived={archivedSessions}
          canLoadMore={visibleSessions.length < sessionsTotal}
          loadMoreError={sessionsPageError}
          loadingMore={loadingMoreSessions}
          onArchiveViewChange={setArchivedSessions}
          onLoadMore={() => void loadMoreSessions()}
          onSessionsChanged={() => setSessionsRefreshKey(current => current + 1)}
          phase={sessionsPhase}
          profile={profile}
          sessions={visibleSessions}
        />
      )}
      {active === 'tasks' && <TasksScreen jobs={orderedCronJobs} phase={tasksPhase} profile={selectedProfile} />}
      {active === 'more' && (pathname.startsWith('/mobile/notifications')
        ? <NotificationsScreen key={profile || 'default'} profile={profile} />
        : pathname.startsWith('/mobile/push')
          ? <PushSettingsScreen key={profile || 'default'} profile={profile} />
          : <MoreScreen onPreferencesChange={setPreferences} preferences={preferences} profile={selectedProfile} />)}
      <BottomNavigation active={active} />
      <PwaUpdateBanner onLater={deferUpdate} visible={updateReady} />
    </div>
  )
}
