import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, useLocation } from 'react-router'

import { useProfileScope } from '@/contexts/useProfileScope'
import { api, type CronJob, type MobileNotification, type SessionInfo, type StatusResponse } from '@/lib/api'

import { loadMobilePreferences, type MobilePreferences } from './mobile-preferences'
import { useMobileViewportSync, usePwaUpdateReady } from './mobile-hooks'
import { PwaUpdateBanner } from './ui/PwaUpdateBanner'
import { orderCronJobs, routeTab, safeDecodePathSegment } from './mobile-utils'
import { HomeScreen } from './screens/HomeScreen'
import { MoreScreen } from './screens/MoreScreen'
import { NotificationsScreen } from './screens/NotificationsScreen'
import type { LoadPhase, ScopedLoadState } from './types'
import { BottomNavigation } from './ui/primitives'
import './mobile-app.css'

const ChatScreen = lazy(() => import('./chat/ChatScreen').then(module => ({ default: module.ChatScreen })))
const ChatsScreen = lazy(() => import('./screens/ChatsScreen').then(module => ({ default: module.ChatsScreen })))
const ModelSettingsScreen = lazy(() => import('./screens/ModelSettingsScreen').then(module => ({ default: module.ModelSettingsScreen })))
const PushSettingsScreen = lazy(() => import('./screens/PushSettingsScreen').then(module => ({ default: module.PushSettingsScreen })))
const TasksScreen = lazy(() => import('./screens/TasksScreen').then(module => ({ default: module.TasksScreen })))

export function MobileApp() {
  useMobileViewportSync()
  const [updateReady, deferUpdate] = usePwaUpdateReady()
  const { pathname } = useLocation()
  const { currentProfile, profile } = useProfileScope()
  const [sessions, setSessions] = useState<SessionInfo[]>([])
  const [sessionsTotal, setSessionsTotal] = useState(0)
  const [archivedSessions, setArchivedSessions] = useState(false)
  const [sessionsPageView, setSessionsPageView] = useState<{ error: boolean; loading: boolean; scope: string }>({
    error: false,
    loading: false,
    scope: ''
  })
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
  const selectedProfileRef = useRef(selectedProfile)
  const refreshGenerationRef = useRef(0)
  const sessionsGenerationRef = useRef(0)
  const notificationsDataGenerationRef = useRef(0)
  const statusDataGenerationRef = useRef(0)
  const tasksDataGenerationRef = useRef(0)
  const sessionsDataGenerationRef = useRef(0)
  const refreshPendingRef = useRef<number | null>(null)
  const lastRefreshAttemptRef = useRef(0)
  const [refreshView, setRefreshView] = useState<{ error: string | null; generation: number; refreshing: boolean; scope: string }>({
    error: null,
    generation: 0,
    refreshing: false,
    scope: sessionsScope
  })

  useEffect(() => {
    const profileChanged = selectedProfileRef.current !== selectedProfile
    const sessionsScopeChanged = sessionsScopeRef.current !== sessionsScope
    sessionsScopeRef.current = sessionsScope
    selectedProfileRef.current = selectedProfile
    lastRefreshAttemptRef.current = Date.now()
    if (profileChanged) {
      refreshGenerationRef.current += 1
    }
    if (profileChanged || sessionsScopeChanged) {
      sessionsGenerationRef.current += 1
      refreshPendingRef.current = null
    }
  }, [selectedProfile, sessionsScope])

  useEffect(() => {
    setPreferences(loadMobilePreferences(selectedProfile))
    let cancelled = false
    const requestScope = selectedProfile
    const requestGeneration = refreshGenerationRef.current
    void api.getMobileNotifications(profile).then(
      value => {
        if (!cancelled && notificationsDataGenerationRef.current <= requestGeneration) {
          notificationsDataGenerationRef.current = requestGeneration
          setNotificationsLoad({ items: value.items, scope: requestScope })
        }
      },
      () => {
        if (!cancelled && notificationsDataGenerationRef.current <= requestGeneration) {
          setNotificationsLoad({ items: [], scope: requestScope })
        }
      }
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
    let cancelled = false
    const requestScope = selectedProfile
    const requestGeneration = refreshGenerationRef.current

    void api.getStatus().then(
      value => {
        if (cancelled || statusDataGenerationRef.current > requestGeneration) return
        statusDataGenerationRef.current = requestGeneration
        setStatus(value)
        setStatusLoad({ phase: 'ready', scope: requestScope })
      },
      () => {
        if (cancelled || statusDataGenerationRef.current > requestGeneration) return
        setStatus(null)
        setStatusLoad({ phase: 'error', scope: requestScope })
      }
    )
    void api.getCronJobs(requestScope).then(
      value => {
        if (cancelled || tasksDataGenerationRef.current > requestGeneration) return
        tasksDataGenerationRef.current = requestGeneration
        setCronJobs(value)
        setTasksLoad({ phase: 'ready', scope: requestScope })
      },
      () => {
        if (cancelled || tasksDataGenerationRef.current > requestGeneration) return
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
    const requestGeneration = refreshGenerationRef.current

    void api.getSessions(30, 0, {
      ...(archivedSessions ? { archived: 'only' as const } : {}),
      order: 'recent',
      profile
    }).then(
      value => {
        if (cancelled || sessionsDataGenerationRef.current > requestGeneration) return
        sessionsDataGenerationRef.current = requestGeneration
        setSessions(value.sessions)
        setSessionsTotal(value.total)
        setSessionsPageView({ error: false, loading: false, scope: requestScope })
        setSessionsLoad({ phase: 'ready', scope: requestScope })
      },
      () => {
        if (cancelled || sessionsDataGenerationRef.current > requestGeneration) return
        setSessions([])
        setSessionsTotal(0)
        setSessionsPageView({ error: false, loading: false, scope: requestScope })
        setSessionsLoad({ phase: 'error', scope: requestScope })
      }
    )

    return () => {
      cancelled = true
    }
  }, [archivedSessions, profile, sessionsRefreshKey, sessionsScope])

  const loadingMoreSessions = sessionsPageView.scope === sessionsScope && sessionsPageView.loading

  const loadMoreSessions = useCallback(async () => {
    if (loadingMoreSessions || sessions.length >= sessionsTotal) return
    const requestScope = sessionsScope
    const requestGeneration = sessionsGenerationRef.current
    setSessionsPageView({ error: false, loading: true, scope: requestScope })
    try {
      const value = await api.getSessions(30, sessions.length, {
        ...(archivedSessions ? { archived: 'only' as const } : {}),
        order: 'recent',
        profile
      })
      if (sessionsScopeRef.current !== requestScope || sessionsGenerationRef.current !== requestGeneration) return
      setSessions(current => {
        const existing = new Set(current.map(session => session.id))
        return [...current, ...value.sessions.filter(session => !existing.has(session.id))]
      })
      setSessionsTotal(value.total)
    } catch {
      if (sessionsScopeRef.current === requestScope && sessionsGenerationRef.current === requestGeneration) {
        setSessionsPageView({ error: true, loading: false, scope: requestScope })
      }
    } finally {
      if (sessionsScopeRef.current === requestScope && sessionsGenerationRef.current === requestGeneration) {
        setSessionsPageView(current => current.scope === requestScope ? { ...current, loading: false } : current)
      }
    }
  }, [archivedSessions, loadingMoreSessions, profile, sessions.length, sessionsScope, sessionsTotal])

  const refreshSessions = useCallback(() => {
    sessionsGenerationRef.current += 1
    setSessionsPageView({ error: false, loading: false, scope: sessionsScope })
    setSessionsRefreshKey(current => current + 1)
  }, [sessionsScope])

  const refreshMobileData = useCallback(async () => {
    if (refreshPendingRef.current !== null) return
    lastRefreshAttemptRef.current = Date.now()
    const generation = ++refreshGenerationRef.current
    const sessionsGeneration = ++sessionsGenerationRef.current
    refreshPendingRef.current = generation
    const requestProfile = selectedProfile
    const requestSessionsScope = sessionsScope
    setSessionsPageView({ error: false, loading: false, scope: requestSessionsScope })
    setRefreshView({ error: null, generation, refreshing: true, scope: requestSessionsScope })
    const results = await Promise.allSettled([
      api.getMobileNotifications(profile),
      api.getStatus(),
      api.getCronJobs(requestProfile),
      api.getSessions(30, 0, {
        ...(archivedSessions ? { archived: 'only' as const } : {}),
        order: 'recent',
        profile
      })
    ])
    if (
      refreshGenerationRef.current !== generation ||
      selectedProfileRef.current !== requestProfile
    ) return

    const [notificationResult, statusResult, taskResult, sessionResult] = results
    if (notificationResult.status === 'fulfilled') {
      notificationsDataGenerationRef.current = generation
      setNotificationsLoad({ items: notificationResult.value.items, scope: requestProfile })
    }
    if (statusResult.status === 'fulfilled') {
      statusDataGenerationRef.current = generation
      setStatus(statusResult.value)
      setStatusLoad({ phase: 'ready', scope: requestProfile })
    }
    if (taskResult.status === 'fulfilled') {
      tasksDataGenerationRef.current = generation
      setCronJobs(taskResult.value)
      setTasksLoad({ phase: 'ready', scope: requestProfile })
    }
    if (
      sessionResult.status === 'fulfilled' &&
      sessionsGenerationRef.current === sessionsGeneration &&
      sessionsScopeRef.current === requestSessionsScope
    ) {
      sessionsDataGenerationRef.current = generation
      setSessions(sessionResult.value.sessions)
      setSessionsTotal(sessionResult.value.total)
      setSessionsPageView({ error: false, loading: false, scope: requestSessionsScope })
      setSessionsLoad({ phase: 'ready', scope: requestSessionsScope })
    }
    setRefreshView({
      error: results.some(result => result.status === 'rejected') ? 'Could not refresh all mobile data.' : null,
      generation,
      refreshing: false,
      scope: requestSessionsScope
    })
    if (refreshPendingRef.current === generation) refreshPendingRef.current = null
  }, [archivedSessions, profile, selectedProfile, sessionsScope])

  useEffect(() => {
    const refreshIfStale = () => {
      if (document.visibilityState !== 'visible') return
      if (Date.now() - lastRefreshAttemptRef.current < 120_000) return
      void refreshMobileData()
    }
    const refreshAfterReconnect = () => {
      if (Date.now() - lastRefreshAttemptRef.current < 5_000) return
      void refreshMobileData()
    }
    window.addEventListener('online', refreshAfterReconnect)
    window.addEventListener('pageshow', refreshIfStale)
    document.addEventListener('visibilitychange', refreshIfStale)
    return () => {
      window.removeEventListener('online', refreshAfterReconnect)
      window.removeEventListener('pageshow', refreshIfStale)
      document.removeEventListener('visibilitychange', refreshIfStale)
    }
  }, [refreshMobileData])

  const statusPhase: LoadPhase = statusLoad.scope === selectedProfile ? statusLoad.phase : 'loading'
  const sessionsPhase: LoadPhase = sessionsLoad.scope === sessionsScope ? sessionsLoad.phase : 'loading'
  const sessionsPageError = sessionsPageView.scope === sessionsScope && sessionsPageView.error
  const tasksPhase: LoadPhase = tasksLoad.scope === selectedProfile ? tasksLoad.phase : 'loading'
  const visibleStatus = statusLoad.scope === selectedProfile ? status : null
  const visibleSessions = sessionsLoad.scope === sessionsScope ? sessions : []
  const visibleNotifications = notificationsLoad.scope === selectedProfile ? notificationsLoad.items : []
  const currentRefreshView = refreshView.scope === sessionsScope && refreshView.generation === refreshGenerationRef.current
  const refreshError = currentRefreshView ? refreshView.error : null
  const refreshing = currentRefreshView && refreshView.refreshing
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
            onSessionCreated={refreshSessions}
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
          onRefresh={() => void refreshMobileData()}
          preferences={preferences}
          profile={profile}
          refreshError={refreshError}
          refreshing={refreshing}
          sessions={visibleSessions}
          sessionsPhase={sessionsPhase}
          status={visibleStatus}
          statusPhase={statusPhase}
          tasksPhase={tasksPhase}
        />
      )}
      {active !== 'home' && (
        <Suspense fallback={<main className="mobile-screen"><div aria-busy="true" className="mobile-empty-card">Opening mobile view…</div></main>}>
          {active === 'chats' && (
            <ChatsScreen
              archived={archivedSessions}
              canLoadMore={visibleSessions.length < sessionsTotal}
              loadMoreError={sessionsPageError}
              loadingMore={loadingMoreSessions}
              onArchiveViewChange={setArchivedSessions}
              onLoadMore={() => void loadMoreSessions()}
              onSessionsChanged={refreshSessions}
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
              : pathname.startsWith('/mobile/models')
                ? <ModelSettingsScreen key={selectedProfile} profile={selectedProfile} />
                : <MoreScreen onPreferencesChange={setPreferences} preferences={preferences} profile={selectedProfile} />)}
        </Suspense>
      )}
      <BottomNavigation active={active} />
      <PwaUpdateBanner onLater={deferUpdate} visible={updateReady} />
    </div>
  )
}
