import type { MobilePreferences } from './mobile-preferences'

export type TodayCardId = 'connection' | 'continue' | 'notifications' | 'tasks'
export type TodayCardTone = 'danger' | 'neutral' | 'warning'

interface TodayNotification {
  id: string
  level?: string | null
  read_at?: number | null
  title?: string | null
}

interface TodayTask {
  enabled?: boolean
  id: string
  last_status?: string | null
  name?: string | null
}

interface TodaySession {
  id: string
  is_active?: boolean
  title?: string | null
}

interface TodayStatus {
  gateway_running?: boolean
  gateway_state?: string | null
}

export interface TodayCard {
  count?: number
  id: TodayCardId
  item?: TodayNotification | TodayTask | TodaySession
  tone: TodayCardTone
}

export function buildTodayCards({
  cronJobs,
  notifications,
  preferences,
  sessions,
  status
}: {
  cronJobs: TodayTask[]
  notifications: TodayNotification[]
  preferences?: MobilePreferences
  sessions: TodaySession[]
  status: TodayStatus | null | undefined
}): TodayCard[] {
  const unread = notifications.filter(item => !item.read_at)
  const failedNotices = unread.filter(item => item.level === 'error')
  const actionableTasks = cronJobs.filter(job => job.enabled && job.last_status === 'failed')
  const connected = Boolean(status?.gateway_running || status?.gateway_state === 'running')
  const cards: Partial<Record<TodayCardId, TodayCard>> = {
    notifications: unread.length ? {
      count: unread.length,
      id: 'notifications',
      item: failedNotices[0] ?? unread[0],
      tone: failedNotices.length ? 'danger' : 'neutral'
    } : undefined,
    connection: status && !connected ? { id: 'connection', tone: 'warning' } : undefined,
    tasks: actionableTasks.length ? { count: actionableTasks.length, id: 'tasks', item: actionableTasks[0], tone: 'warning' } : undefined,
    continue: sessions[0] ? { id: 'continue', item: sessions[0], tone: 'neutral' } : undefined
  }
  const order = preferences?.cardOrder ?? ['notifications', 'connection', 'tasks', 'continue']
  const hidden = new Set(preferences?.hiddenCards ?? [])
  return order.flatMap(id => hidden.has(id) || !cards[id] ? [] : [cards[id]])
}
