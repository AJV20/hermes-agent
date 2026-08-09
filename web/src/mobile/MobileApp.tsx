import { useCallback, useEffect, useMemo, useState } from 'react'
import { Navigate, useLocation } from 'react-router'

import { useProfileScope } from '@/contexts/useProfileScope'
import { api, type CronJob, type SessionInfo, type StatusResponse } from '@/lib/api'
import { ChatScreen } from './chat/ChatScreen'
import { useMobileViewportSync, usePwaUpdateReady } from './mobile-hooks'
import { PwaUpdateBanner } from './ui/PwaUpdateBanner'
import { orderCronJobs, routeTab, safeDecodePathSegment } from './mobile-utils'
import { ChatsScreen } from './screens/ChatsScreen'
import { HomeScreen } from './screens/HomeScreen'
import { MoreScreen } from './screens/MoreScreen'
import { NotificationsScreen } from './screens/NotificationsScreen'
import { TasksScreen } from './screens/TasksScreen'
import type { LoadPhase, ScopedLoadState } from './types'
import { BottomNavigation } from './ui/primitives'
import './mobile-app.css'

export function MobileApp() {
  useMobileViewportSync()
  const [updateReady, deferUpdate] = usePwaUpdateReady()
  const { pathname } = useLocation()
  const { currentProfile, profile } = useProfileScope()
  const [sessions, setSessions] = useState<SessionInfo[]>([])
  const [sessionsTotal, setSessionsTotal] = useState(0)
  const [archivedSessions, setArchivedSessions] = useState(false)
  const [loadingMoreSessions, setLoadingMoreSessions] = useState(false)
  const [cronJobs, setCronJobs] = useState<CronJob[]>([])
  const [status, setStatus] = useState<StatusResponse | null>(null)
  const [statusLoad, setStatusLoad] = useState<ScopedLoadState>({ phase: 'loading', scope: null })
  const [sessionsLoad, setSessionsLoad] = useState<ScopedLoadState>({ phase: 'loading', scope: null })
  const [tasksLoad, setTasksLoad] = useState<ScopedLoadState>({ phase: 'loading', scope: null })
  const [sessionsRefreshKey, setSessionsRefreshKey] = useState(0)
  const selectedProfile = profile || currentProfile
  const sessionsScope = `${selectedProfile}\u0000${archivedSessions ? 'archived' : 'active'}`

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
      ...(archivedSessions ? { archived: true } : {}),
      order: 'recent',
      profile
    }).then(
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
  }, [archivedSessions, profile, sessionsRefreshKey, sessionsScope])

  const loadMoreSessions = useCallback(async () => {
    if (loadingMoreSessions || sessions.length >= sessionsTotal) return
    setLoadingMoreSessions(true)
    try {
      const value = await api.getSessions(30, sessions.length, {
        ...(archivedSessions ? { archived: true } : {}),
        order: 'recent',
        profile
      })
      setSessions(current => {
        const existing = new Set(current.map(session => session.id))
        return [...current, ...value.sessions.filter(session => !existing.has(session.id))]
      })
      setSessionsTotal(value.total)
    } finally {
      setLoadingMoreSessions(false)
    }
  }, [archivedSessions, loadingMoreSessions, profile, sessions.length, sessionsTotal])

  const statusPhase: LoadPhase = statusLoad.scope === selectedProfile ? statusLoad.phase : 'loading'
  const sessionsPhase: LoadPhase = sessionsLoad.scope === sessionsScope ? sessionsLoad.phase : 'loading'
  const tasksPhase: LoadPhase = tasksLoad.scope === selectedProfile ? tasksLoad.phase : 'loading'
  const visibleStatus = statusLoad.scope === selectedProfile ? status : null
  const visibleSessions = sessionsLoad.scope === sessionsScope ? sessions : []
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
        <PwaUpdateBanner onLater={deferUpdate} visible={updateReady} />
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
          archived={archivedSessions}
          canLoadMore={visibleSessions.length < sessionsTotal}
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
      {active === 'more' && (pathname.startsWith('/mobile/notifications') ? <NotificationsScreen key={profile || 'default'} profile={profile} /> : <MoreScreen />)}
      <BottomNavigation active={active} />
      <PwaUpdateBanner onLater={deferUpdate} visible={updateReady} />
    </div>
  )
}
