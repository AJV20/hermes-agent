import type { CronJob, SessionInfo } from '@/lib/api'

export function routeTab(pathname: string): 'chats' | 'home' | 'more' | 'tasks' {
  if (pathname.startsWith('/mobile/chat')) return 'chats'
  if (pathname.startsWith('/mobile/chats')) return 'chats'
  if (pathname.startsWith('/mobile/tasks')) return 'tasks'
  if (pathname.startsWith('/mobile/notifications')) return 'more'
  if (pathname.startsWith('/mobile/more')) return 'more'
  return 'home'
}

export function relativeTime(timestamp: number | null | undefined): string {
  if (!timestamp) return 'Recently'
  const milliseconds = timestamp > 10_000_000_000 ? timestamp : timestamp * 1000
  const minutes = Math.max(0, Math.round((Date.now() - milliseconds) / 60_000))
  if (minutes < 1) return 'Now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

export function greetingForCurrentTime(now = new Date()): string {
  const hour = now.getHours()
  if (hour < 12) return 'Good morning.'
  if (hour < 18) return 'Good afternoon.'
  return 'Good evening.'
}

export function activeSessionsLabel(count: number | null | undefined): string {
  if (!count) return 'Hermes is ready.'
  return `${count} session${count === 1 ? '' : 's'} active.`
}

export function jobRunTimestamp(job: CronJob): number {
  if (!job.next_run_at) return Number.POSITIVE_INFINITY
  const timestamp = Date.parse(String(job.next_run_at))
  return Number.isFinite(timestamp) ? timestamp : Number.POSITIVE_INFINITY
}

export function orderCronJobs(jobs: CronJob[]): CronJob[] {
  return [...jobs].sort((left, right) => {
    if (left.enabled !== right.enabled) return left.enabled ? -1 : 1
    return jobRunTimestamp(left) - jobRunTimestamp(right)
  })
}

export function formatJobRun(job: CronJob): string {
  const timestamp = jobRunTimestamp(job)
  if (Number.isFinite(timestamp)) {
    const run = new Date(timestamp)
    const date = run.toLocaleDateString('en-US', { day: 'numeric', month: 'short' })
    const time = run.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    return `${date} at ${time}`
  }
  return job.schedule_display || job.last_status || 'Scheduled'
}

export function sessionLabel(session: SessionInfo): string {
  return session.title?.trim() || session.preview?.trim() || 'Untitled session'
}

export function safeDecodePathSegment(value: string): string | null {
  try {
    return decodeURIComponent(value)
  } catch {
    return null
  }
}
