// @vitest-environment jsdom
import { Blob as NodeBlob, File as NodeFile } from 'node:buffer'
import 'fake-indexeddb/auto'

class NodeFileReader {
  error: DOMException | null = null
  onerror: ((event: ProgressEvent<FileReader>) => void) | null = null
  onload: ((event: ProgressEvent<FileReader>) => void) | null = null
  result: string | ArrayBuffer | null = null

  async readAsDataURL(blob: NodeBlob) {
    try {
      const base64 = Buffer.from(await blob.arrayBuffer()).toString('base64')
      this.result = `data:${blob.type || 'application/octet-stream'};base64,${base64}`
      this.onload?.(new ProgressEvent('load') as ProgressEvent<FileReader>)
    } catch (error) {
      this.error = error instanceof DOMException ? error : new DOMException(String(error))
      this.onerror?.(new ProgressEvent('error') as ProgressEvent<FileReader>)
    }
  }
}

Object.assign(globalThis, { Blob: NodeBlob, File: NodeFile, FileReader: NodeFileReader })
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Link, MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const apiMocks = vi.hoisted(() => ({
  deleteSession: vi.fn(async () => ({ ok: true })),
  dismissMobileNotification: vi.fn(async (id: string) => ({ id })),
  getCronJobs: vi.fn(async () => [
    { id: 'daily', enabled: true, name: 'Morning briefing', next_run_at: '2026-08-09T11:00:00Z' }
  ]),
  getCodexQuota: vi.fn(async () => ({
    available: true,
    fetched_at: '2026-08-09T12:00:00Z',
    plan: 'Pro',
    provider: 'openai-codex',
    windows: [
      { label: 'Session', reset_at: '2026-08-09T17:00:00Z', used_percent: 20 },
      { label: 'Weekly', reset_at: '2026-08-15T12:00:00Z', used_percent: 55 }
    ]
  })),
  getMobileNotifications: vi.fn(async () => ({ items: [], total: 0 })),
  pauseCronJob: vi.fn(async (id: string) => ({ id, enabled: false, name: 'Morning briefing' })),
  resumeCronJob: vi.fn(async (id: string) => ({ id, enabled: true, name: 'Morning briefing' })),
  triggerCronJob: vi.fn(async (id: string) => ({ id, enabled: true, name: 'Morning briefing', state: 'running' })),
  getSessionMessages: vi.fn(async (_sessionId?: string): Promise<{
    messages: never[]
    pagination?: { limit: number; offset: number; order: 'latest' | 'oldest'; returned: number }
    session_id: string
  }> => {
    void _sessionId
    return { messages: [], session_id: 'session-1' }
  }),
  getSessions: vi.fn(async () => ({
    limit: 20,
    offset: 0,
    total: 1,
    sessions: [
      {
        id: 'session-1',
        source: 'desktop',
        model: 'gpt-5.6-sol',
        title: 'Hermes mobile PWA',
        started_at: 1,
        ended_at: null,
        last_active: 2,
        is_active: true,
        message_count: 4,
        tool_call_count: 1,
        input_tokens: 10,
        output_tokens: 20,
        preview: 'Building the mobile companion'
      }
    ]
  })),
  getStatus: vi.fn(async () => ({
    active_sessions: 1,
    gateway_running: true,
    gateway_state: 'running',
    version: '1.0.0'
  })),
  markMobileNotificationRead: vi.fn(async (id: string) => ({ id, read_at: 1 })),
  renameSession: vi.fn(async (_id: string, title: string) => ({ ok: true, title })),
  searchSessions: vi.fn(async (): Promise<{ results: unknown[] }> => ({ results: [] })),
  updateSession: vi.fn(async () => ({ ok: true }))
}))

const gatewayMocks = vi.hoisted(() => ({
  connect: vi.fn(),
  eventHandler: null as ((event: { payload?: unknown; session_id?: string; type: string }) => void) | null,
  request: vi.fn(),
  stateHandler: null as ((state: string) => void) | null
}))
const profileMocks = vi.hoisted(() => ({ currentProfile: 'default', profile: '' }))
const pwaMocks = vi.hoisted(() => ({
  messageHandler: null as ((event: MessageEvent) => void) | null
}))

vi.mock('@/lib/api', () => ({ api: apiMocks, HERMES_BASE_PATH: '' }))
vi.mock('@/contexts/useProfileScope', () => ({
  useProfileScope: () => ({ currentProfile: profileMocks.currentProfile, profile: profileMocks.profile })
}))
vi.mock('@/lib/gatewayClient', () => ({
  GatewayClient: class {
    close() {}
    connect() {
      return gatewayMocks.connect()
    }
    onAny(handler: (event: { payload?: unknown; session_id?: string; type: string }) => void) {
      gatewayMocks.eventHandler = handler
      return () => {}
    }
    onState(handler: (state: string) => void) {
      gatewayMocks.stateHandler = handler
      return () => {}
    }
    request(method: string, params?: unknown) {
      return gatewayMocks.request(method, params)
    }
  }
}))

import { MobileApp } from './MobileApp'
import { createMobileOutbox } from './composer/mobile-outbox'

let container: HTMLDivElement
let root: Root

function MobileAppHarness() {
  return (
    <>
      <Link data-testid="switch-to-session-b" style={{ display: 'none' }} to="/mobile/chat/session-b" />
      <MobileApp />
    </>
  )
}

beforeEach(async () => {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase('hermes-mobile-outbox-v1')
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error('mobile outbox database remained open between tests'))
  })
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  apiMocks.deleteSession.mockReset().mockResolvedValue({ ok: true })
  apiMocks.dismissMobileNotification.mockReset().mockImplementation(async (id: string) => ({ id }))
  apiMocks.getCronJobs.mockReset().mockResolvedValue([
    { id: 'daily', enabled: true, name: 'Morning briefing', next_run_at: '2026-08-09T11:00:00Z' }
  ])
  apiMocks.getCodexQuota.mockReset().mockResolvedValue({
    available: true,
    fetched_at: '2026-08-09T12:00:00Z',
    plan: 'Pro',
    provider: 'openai-codex',
    windows: [
      { label: 'Session', reset_at: '2026-08-09T17:00:00Z', used_percent: 20 },
      { label: 'Weekly', reset_at: '2026-08-15T12:00:00Z', used_percent: 55 }
    ]
  })
  apiMocks.getMobileNotifications.mockReset().mockResolvedValue({ items: [], total: 0 })
  apiMocks.pauseCronJob.mockReset().mockImplementation(async (id: string) => ({ id, enabled: false, name: 'Morning briefing' }))
  apiMocks.resumeCronJob.mockReset().mockImplementation(async (id: string) => ({ id, enabled: true, name: 'Morning briefing' }))
  apiMocks.triggerCronJob.mockReset().mockImplementation(async (id: string) => ({
    id,
    enabled: true,
    name: 'Morning briefing',
    state: 'running'
  }))
  apiMocks.getSessionMessages.mockReset().mockImplementation(async (_sessionId?: string) => {
    void _sessionId
    return { messages: [], session_id: 'session-1' }
  })
  apiMocks.getSessions.mockReset().mockResolvedValue({
    limit: 20,
    offset: 0,
    total: 1,
    sessions: [
      {
        id: 'session-1',
        source: 'desktop',
        model: 'gpt-5.6-sol',
        title: 'Hermes mobile PWA',
        started_at: 1,
        ended_at: null,
        last_active: 2,
        is_active: true,
        message_count: 4,
        tool_call_count: 1,
        input_tokens: 10,
        output_tokens: 20,
        preview: 'Building the mobile companion'
      }
    ]
  })
  apiMocks.getStatus.mockReset().mockResolvedValue({
    active_sessions: 1,
    gateway_running: true,
    gateway_state: 'running',
    version: '1.0.0'
  })
  apiMocks.markMobileNotificationRead.mockReset().mockImplementation(async (id: string) => ({ id, read_at: 1 }))
  apiMocks.renameSession.mockReset().mockImplementation(async (_id: string, title: string) => ({ ok: true, title }))
  apiMocks.searchSessions.mockReset().mockResolvedValue({ results: [] })
  apiMocks.updateSession.mockReset().mockResolvedValue({ ok: true })
  gatewayMocks.request.mockReset().mockImplementation(async (method: string) => {
    if (method === 'session.create') {
      return { session_id: 'runtime-1', stored_session_id: 'stored-1' }
    }
    if (method === 'session.resume') return { session_id: 'runtime-resumed' }
    return {}
  })
  gatewayMocks.connect.mockReset().mockResolvedValue(undefined)
  gatewayMocks.eventHandler = null
  gatewayMocks.stateHandler = null
  profileMocks.profile = ''
  profileMocks.currentProfile = 'default'
  pwaMocks.messageHandler = null
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {
      addEventListener: (_type: string, handler: (event: MessageEvent) => void) => {
        pwaMocks.messageHandler = handler
      },
      removeEventListener: vi.fn()
    }
  })
  window.localStorage.clear()
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.clearAllMocks()
})

async function renderAt(path: string) {
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[path]} key={path}>
        <MobileAppHarness />
      </MemoryRouter>
    )
  })
  await act(async () => Promise.resolve())
  if (path.startsWith('/mobile/chat/')) {
    await act(async () => {
      await import('./chat/ChatScreen')
      await Promise.resolve()
    })
  }
}

async function waitForReact(assertion: () => unknown) {
  let lastError: unknown
  for (let attempt = 0; attempt < 100; attempt += 1) {
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 10))
    })
    try {
      assertion()
      return
    } catch (error) {
      lastError = error
    }
  }
  throw lastError
}

describe('MobileApp', () => {
  it('renders the command-center home with live status, quick chat, and recent work', async () => {
    await renderAt('/mobile')

    expect(container.textContent).toContain('Hermes')
    expect(container.textContent).toMatch(/Good (morning|afternoon|evening)\./)
    expect(container.textContent).not.toContain('Abdiel')
    expect(container.textContent).toContain('Connected')
    expect(container.textContent).toContain('New chat')
    expect(container.textContent).toContain('Hermes mobile PWA')
    expect(container.textContent).toContain('Morning briefing')
  })

  it('shows profile-scoped Codex quota with session and weekly remaining limits', async () => {
    profileMocks.profile = 'mabel'
    await renderAt('/mobile')

    expect(apiMocks.getCodexQuota).toHaveBeenCalledWith('mabel')
    expect(container.textContent).toContain('Codex quota')
    expect(container.textContent).toContain('Pro plan')
    expect(container.textContent).toContain('80% remaining')
    expect(container.textContent).toContain('45% remaining')
    const quotaBars = Array.from(container.querySelectorAll<HTMLElement>('.mobile-codex-quota-track'))
    expect(quotaBars.map(bar => bar.getAttribute('aria-label'))).toEqual([
      'Session quota remaining',
      'Weekly quota remaining'
    ])
    expect(quotaBars.map(bar => bar.getAttribute('aria-valuenow'))).toEqual(['80', '45'])
    expect(quotaBars.map(bar => bar.querySelector<HTMLElement>('span')?.style.width)).toEqual(['80%', '45%'])
  })

  it('keeps the Home screen usable when Codex quota is unavailable', async () => {
    apiMocks.getCodexQuota.mockRejectedValueOnce(new Error('offline'))
    await renderAt('/mobile')

    expect(container.textContent).toContain('Codex quota unavailable')
    expect(container.textContent).toContain('Morning briefing')
  })

  it('exposes the approved four-tab mobile navigation', async () => {
    await renderAt('/mobile')

    const links = Array.from(container.querySelectorAll('.mobile-bottom-nav a'))
    const labels = links.map(node => node.textContent)
    expect(labels).toEqual(['Home', 'Chats', 'Tasks', 'More'])
    expect(links.map(node => node.getAttribute('aria-current'))).toEqual(['page', null, null, null])
  })

  it('shows a native update banner when a new service worker activates', async () => {
    await renderAt('/mobile')
    expect(pwaMocks.messageHandler).not.toBeNull()

    await act(async () => {
      pwaMocks.messageHandler?.(new MessageEvent('message', { data: { type: 'HERMES_PWA_UPDATE_READY' } }))
    })

    expect(container.textContent).toContain('A new Hermes Mobile update is ready.')
    expect(container.querySelector('button[aria-label="Install Hermes Mobile update"]')).not.toBeNull()
    const later = container.querySelector('button[aria-label="Defer Hermes Mobile update"]') as HTMLButtonElement
    expect(later).not.toBeNull()
    await act(async () => later.click())
    expect(container.textContent).not.toContain('A new Hermes Mobile update is ready.')
  })

  it('keeps chat updates visible and blocks reload while an attachment would be lost', async () => {
    await renderAt('/mobile/chat/new')
    const picker = container.querySelector('input[type="file"]') as HTMLInputElement
    const attachment = new File(['keep me'], 'work.txt', { type: 'text/plain' })
    Object.defineProperty(picker, 'files', { configurable: true, value: [attachment] })
    await act(async () => {
      picker.dispatchEvent(new Event('change', { bubbles: true }))
    })

    await act(async () => {
      pwaMocks.messageHandler?.(new MessageEvent('message', { data: { type: 'HERMES_PWA_UPDATE_READY' } }))
    })

    const banner = container.querySelector('.mobile-chat-route .mobile-update-banner')
    const install = container.querySelector('button[aria-label="Install Hermes Mobile update"]') as HTMLButtonElement
    expect(banner).not.toBeNull()
    expect(install.disabled).toBe(true)
    expect(banner?.textContent).toContain('Finish or clear your draft, remove attachments, and stop any response before updating.')

    await act(async () => {
      ;(container.querySelector('button[aria-label="Remove work.txt"]') as HTMLButtonElement).click()
    })
    await waitForReact(() => expect(install.disabled).toBe(false))
  })

  it('loads, marks, and dismisses durable notifications within the selected profile', async () => {
    profileMocks.profile = 'mabel'
    const notification = {
      body: 'The scheduled backup completed.',
      created_at: 1,
      dedupe_key: 'backup:complete',
      dismissed_at: null,
      id: 'notice-1',
      level: 'success',
      profile: 'mabel',
      read_at: null,
      session_id: null,
      target: null,
      title: 'Backup complete',
      type: 'backup'
    }
    apiMocks.getMobileNotifications.mockResolvedValueOnce({ items: [notification as never], total: 1 })
    apiMocks.markMobileNotificationRead.mockResolvedValueOnce({ ...notification, read_at: 2 })
    apiMocks.dismissMobileNotification.mockResolvedValueOnce({ ...notification, dismissed_at: 3 } as never)

    await renderAt('/mobile/notifications')
    expect(apiMocks.getMobileNotifications).toHaveBeenCalledWith('mabel')
    expect(container.textContent).toContain('Backup complete')
    expect(container.textContent).toContain('The scheduled backup completed.')

    await act(async () => {
      ;(container.querySelector('.mobile-notification-open') as HTMLButtonElement).click()
      await Promise.resolve()
    })
    expect(apiMocks.markMobileNotificationRead).toHaveBeenCalledWith('notice-1', 'mabel')

    await act(async () => {
      ;(container.querySelector('button[aria-label="Dismiss Backup complete"]') as HTMLButtonElement).click()
      await Promise.resolve()
    })
    expect(apiMocks.dismissMobileNotification).toHaveBeenCalledWith('notice-1', 'mabel')
    expect(container.textContent).not.toContain('Backup complete')
  })

  it('uses normal document anchors for cross-shell desktop destinations', async () => {
    const expectDocumentAnchor = (href: string) => {
      const link = container.querySelector(`a[href="${href}"]`) as HTMLAnchorElement
      expect(link).not.toBeNull()
      link.target = '_blank'
      const event = new MouseEvent('click', { bubbles: true, cancelable: true })
      link.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(false)
    }

    await renderAt('/mobile')
    expectDocumentAnchor('/files')
    expectDocumentAnchor('/system')

    await renderAt('/mobile/tasks')
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expectDocumentAnchor('/cron')

    await renderAt('/mobile/more')
    expectDocumentAnchor('/models')
    expectDocumentAnchor('/files')
    expectDocumentAnchor('/skills')
    expectDocumentAnchor('/system')
  })

  it('uses a time-appropriate greeting and correct active-session grammar', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-09T08:00:00-04:00'))
    try {
      apiMocks.getStatus.mockResolvedValueOnce({
        active_sessions: 2,
        gateway_running: true,
        gateway_state: 'running',
        version: '1.0.0'
      })
      await renderAt('/mobile')

      expect(container.textContent).toContain('Good morning.')
      expect(container.textContent).toContain('2 sessions active.')
    } finally {
      vi.useRealTimers()
    }
  })

  it('shows the soonest scheduled task first with a readable run time', async () => {
    apiMocks.getCronJobs.mockResolvedValueOnce([
      { id: 'later', enabled: true, name: 'Later task', next_run_at: '2026-08-10T18:00:00-04:00' },
      { id: 'soon', enabled: true, name: 'Soon task', next_run_at: '2026-08-10T09:00:00-04:00' },
      { id: 'paused', enabled: false, name: 'Paused task', next_run_at: '2026-08-09T08:00:00-04:00' }
    ])
    await renderAt('/mobile/tasks')
    await act(async () => {
      ;(container.querySelector('button[aria-label="Show all tasks"]') as HTMLButtonElement).click()
    })

    const names = Array.from(container.querySelectorAll('.mobile-task-card strong')).map(node => node.textContent)
    const schedule = container.querySelector('.mobile-task-card small')?.textContent ?? ''
    expect(names).toEqual(['Soon task', 'Later task', 'Paused task'])
    expect(schedule).not.toContain('2026-08-10T09:00:00-04:00')
    expect(schedule).toMatch(/Aug|Today|Tomorrow/)
  })

  it('runs and pauses scheduled tasks directly from mobile', async () => {
    await renderAt('/mobile/tasks')

    const run = container.querySelector('button[aria-label="Run Morning briefing now"]') as HTMLButtonElement
    const pause = container.querySelector('button[aria-label="Pause Morning briefing"]') as HTMLButtonElement
    expect(run).not.toBeNull()
    expect(pause).not.toBeNull()
    await act(async () => {
      run.click()
      await Promise.resolve()
    })
    expect(apiMocks.triggerCronJob).not.toHaveBeenCalled()
    const confirmRun = container.querySelector('button[aria-label="Confirm run Morning briefing"]') as HTMLButtonElement
    expect(confirmRun).not.toBeNull()
    await act(async () => {
      confirmRun.click()
      await Promise.resolve()
    })
    expect(apiMocks.triggerCronJob).toHaveBeenCalledWith('daily', 'default')
    expect(container.textContent).toContain('Running')

    await act(async () => {
      pause.click()
      await Promise.resolve()
    })
    expect(apiMocks.pauseCronJob).toHaveBeenCalledWith('daily', 'default')
    expect(container.textContent).toContain('Paused')
  })

  it('summarizes task failures and reveals technical detail only on request', async () => {
    const detail = 'Script exited with code 1\nTraceback: private implementation detail '.repeat(8)
    apiMocks.getCronJobs.mockResolvedValueOnce([
      {
        id: 'broken',
        enabled: true,
        name: 'Restore verification',
        last_status: 'failed',
        last_error: detail
      } as never
    ])
    await renderAt('/mobile/tasks')

    expect(container.textContent).toContain('1 task needs attention')
    expect(container.textContent).toContain('Script exited with code 1')
    expect(container.textContent).not.toContain('private implementation detail private implementation detail')
    const view = container.querySelector('button[aria-label="View error for Restore verification"]') as HTMLButtonElement
    expect(view).not.toBeNull()
    await act(async () => view.click())
    expect(container.querySelector('[aria-label="Task error details for Restore verification"]')?.textContent).toContain(detail)
  })

  it('filters the task list for paused schedules', async () => {
    apiMocks.getCronJobs.mockResolvedValueOnce([
      { id: 'active', enabled: true, name: 'Active task' } as never,
      { id: 'paused', enabled: false, name: 'Paused task' } as never
    ])
    await renderAt('/mobile/tasks')
    const pausedFilter = container.querySelector('button[aria-label="Show paused tasks"]') as HTMLButtonElement
    await act(async () => pausedFilter.click())
    expect(container.textContent).toContain('Paused task')
    expect(container.textContent).not.toContain('Active task')
  })

  it('searches conversations from the mobile chats screen', async () => {
    apiMocks.searchSessions.mockResolvedValueOnce({
      results: [{
        id: 'session-search',
        session_id: 'session-search',
        source: 'desktop',
        model: 'gpt-5.6-sol',
        title: 'Recovered deployment notes',
        started_at: 1,
        ended_at: null,
        last_active: 2,
        is_active: false,
        message_count: 2,
        tool_call_count: 0,
        input_tokens: 4,
        output_tokens: 8,
        preview: 'Rollback and verification details',
        snippet: 'deployment notes',
        role: 'assistant',
        session_started: 1
      }]
    })
    await renderAt('/mobile/chats')

    const search = container.querySelector('input[aria-label="Search conversations"]') as HTMLInputElement
    expect(search).not.toBeNull()
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      valueSetter?.call(search, 'deployment')
      search.dispatchEvent(new Event('input', { bubbles: true }))
      ;(search.closest('form') as HTMLFormElement).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      await Promise.resolve()
    })

    expect(apiMocks.searchSessions).toHaveBeenCalledWith('deployment', { order: 'recent', profile: '' })
    expect(container.textContent).toContain('Recovered deployment notes')
    expect(container.textContent).not.toContain('Hermes mobile PWA')
  })

  it('renames a conversation from a mobile action sheet', async () => {
    await renderAt('/mobile/chats')

    const actions = container.querySelector('button[aria-label="Actions for Hermes mobile PWA"]') as HTMLButtonElement
    expect(actions).not.toBeNull()
    await act(async () => actions.click())

    const title = container.querySelector('input[aria-label="Conversation title"]') as HTMLInputElement
    expect(title.value).toBe('Hermes mobile PWA')
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      valueSetter?.call(title, 'Native mobile roadmap')
      title.dispatchEvent(new Event('input', { bubbles: true }))
      ;(title.closest('form') as HTMLFormElement).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      await Promise.resolve()
    })

    expect(apiMocks.renameSession).toHaveBeenCalledWith('session-1', 'Native mobile roadmap', '')
    expect(container.textContent).toContain('Native mobile roadmap')
  })

  it('pins, unpins, archives, and restores conversations in the selected profile', async () => {
    await renderAt('/mobile/chats')

    const openActions = async () => {
      await act(async () => {
        ;(container.querySelector('button[aria-label="Actions for Hermes mobile PWA"]') as HTMLButtonElement).click()
      })
    }

    await openActions()
    const pin = container.querySelector('button[aria-label="Pin conversation"]') as HTMLButtonElement
    expect(pin).not.toBeNull()
    await act(async () => {
      pin.click()
      await Promise.resolve()
    })
    expect(apiMocks.updateSession).toHaveBeenCalledWith('session-1', { pinned: true }, '')

    await openActions()
    const unpin = container.querySelector('button[aria-label="Unpin conversation"]') as HTMLButtonElement
    expect(unpin).not.toBeNull()
    await act(async () => {
      unpin.click()
      await Promise.resolve()
    })
    expect(apiMocks.updateSession).toHaveBeenCalledWith('session-1', { pinned: false }, '')

    await openActions()
    const archive = container.querySelector('button[aria-label="Archive conversation"]') as HTMLButtonElement
    expect(archive).not.toBeNull()
    await act(async () => {
      archive.click()
      await Promise.resolve()
    })
    expect(apiMocks.updateSession).toHaveBeenCalledWith('session-1', { archived: true }, '')

    await act(async () => {
      ;(container.querySelector('button[aria-label="View archived conversations"]') as HTMLButtonElement).click()
      await Promise.resolve()
    })
    await openActions()
    const restore = container.querySelector('button[aria-label="Restore conversation"]') as HTMLButtonElement
    expect(restore).not.toBeNull()
    await act(async () => {
      restore.click()
      await Promise.resolve()
    })
    expect(apiMocks.updateSession).toHaveBeenCalledWith('session-1', { archived: false }, '')
  })

  it('loads archived conversations separately and disables incomplete search', async () => {
    apiMocks.getSessions
      .mockResolvedValueOnce({
        limit: 30,
        offset: 0,
        total: 1,
        sessions: [{
          id: 'session-1', source: 'desktop', model: 'gpt-5.6-sol', title: 'Active conversation',
          started_at: 1, ended_at: null, last_active: 2, is_active: true, message_count: 4,
          tool_call_count: 1, input_tokens: 10, output_tokens: 20, preview: 'Active', archived: false, pinned: false
        }]
      } as never)
      .mockResolvedValueOnce({
        limit: 30,
        offset: 0,
        total: 1,
        sessions: [{
          id: 'archived-1', source: 'desktop', model: 'gpt-5.6-sol', title: 'Archived conversation',
          started_at: 1, ended_at: null, last_active: 2, is_active: false, message_count: 4,
          tool_call_count: 1, input_tokens: 10, output_tokens: 20, preview: 'Archived', archived: true, pinned: false
        }]
      } as never)
    await renderAt('/mobile/chats')

    await act(async () => {
      ;(container.querySelector('button[aria-label="View archived conversations"]') as HTMLButtonElement).click()
      await Promise.resolve()
    })

    await waitForReact(() => {
      expect(apiMocks.getSessions).toHaveBeenLastCalledWith(30, 0, { archived: 'only', order: 'recent', profile: '' })
    })
    expect(container.textContent).toContain('Archived conversation')
    expect((container.querySelector('input[aria-label="Search conversations"]') as HTMLInputElement).disabled).toBe(true)
    expect(container.textContent).toContain('Search is available in active conversations.')
  })

  it('keeps a conversation visible and shows an error when a session flag update fails', async () => {
    apiMocks.updateSession.mockRejectedValueOnce(new Error('offline'))
    await renderAt('/mobile/chats')
    await act(async () => {
      ;(container.querySelector('button[aria-label="Actions for Hermes mobile PWA"]') as HTMLButtonElement).click()
    })

    await act(async () => {
      ;(container.querySelector('button[aria-label="Archive conversation"]') as HTMLButtonElement).click()
      await Promise.resolve()
    })

    expect(container.textContent).toContain('offline')
    expect(container.textContent).toContain('Hermes mobile PWA')
  })

  it('requires confirmation before deleting a conversation', async () => {
    await renderAt('/mobile/chats')
    await act(async () => {
      ;(container.querySelector('button[aria-label="Actions for Hermes mobile PWA"]') as HTMLButtonElement).click()
    })
    await act(async () => {
      ;(container.querySelector('button[aria-label="Delete conversation"]') as HTMLButtonElement).click()
    })

    expect(apiMocks.deleteSession).not.toHaveBeenCalled()
    const confirm = container.querySelector('button[aria-label="Confirm delete conversation"]') as HTMLButtonElement
    expect(confirm).not.toBeNull()
    await act(async () => {
      confirm.click()
      await Promise.resolve()
    })

    expect(apiMocks.deleteSession).toHaveBeenCalledWith('session-1', '')
    expect(container.textContent).not.toContain('Hermes mobile PWA')
  })

  it('loads more conversations without replacing the current list', async () => {
    apiMocks.getSessions
      .mockResolvedValueOnce({
        limit: 30,
        offset: 0,
        total: 31,
        sessions: [{
          id: 'session-1', source: 'desktop', model: 'gpt-5.6-sol', title: 'First conversation',
          started_at: 1, ended_at: null, last_active: 2, is_active: true, message_count: 4,
          tool_call_count: 1, input_tokens: 10, output_tokens: 20, preview: 'First page'
        }]
      })
      .mockResolvedValueOnce({
        limit: 30,
        offset: 30,
        total: 31,
        sessions: [{
          id: 'session-31', source: 'telegram', model: 'gpt-5.6-sol', title: 'Older conversation',
          started_at: 1, ended_at: null, last_active: 1, is_active: false, message_count: 2,
          tool_call_count: 0, input_tokens: 2, output_tokens: 4, preview: 'Second page'
        }]
      })
    await renderAt('/mobile/chats')

    const loadMore = container.querySelector('button[aria-label="Load more conversations"]') as HTMLButtonElement
    expect(loadMore).not.toBeNull()
    await act(async () => {
      loadMore.click()
      await Promise.resolve()
    })

    expect(apiMocks.getSessions).toHaveBeenLastCalledWith(30, 1, { order: 'recent', profile: '' })
    expect(container.textContent).toContain('First conversation')
    expect(container.textContent).toContain('Older conversation')
  })

  it('keeps the current conversations visible and offers a retry when loading more fails', async () => {
    apiMocks.getSessions
      .mockResolvedValueOnce({
        limit: 30,
        offset: 0,
        sessions: [{ id: 'session-1', title: 'First' } as never],
        total: 2
      })
      .mockRejectedValueOnce(new Error('network down'))
    await renderAt('/mobile/chats')

    const loadMore = Array.from(container.querySelectorAll('button')).find(candidate => candidate.textContent === 'Load more') as HTMLButtonElement
    await act(async () => {
      loadMore.click()
      await Promise.resolve()
    })

    expect(container.textContent).toContain('First')
    expect(container.textContent).toContain('Could not load more conversations.')
    const retry = Array.from(container.querySelectorAll('button')).find(candidate => candidate.textContent === 'Try loading more') as HTMLButtonElement
    expect(retry.disabled).toBe(false)
  })

  it('discards a stale load-more page after the selected profile changes', async () => {
    let resolveOldPage!: (value: never) => void
    apiMocks.getSessions.mockImplementation(((_limit: number, offset: number, options: { profile?: string }) => {
      if (options.profile === 'mabel') {
        return Promise.resolve({
          limit: 30,
          offset: 0,
          total: 1,
          sessions: [{
            id: 'mabel-1', source: 'desktop', model: 'gpt-5.6-sol', title: 'Mabel conversation',
            started_at: 1, ended_at: null, last_active: 2, is_active: true, message_count: 1,
            tool_call_count: 0, input_tokens: 1, output_tokens: 1, preview: 'Mabel profile'
          }]
        } as never)
      }
      if (offset === 0) {
        return Promise.resolve({
          limit: 30,
          offset: 0,
          total: 2,
          sessions: [{
            id: 'default-1', source: 'desktop', model: 'gpt-5.6-sol', title: 'Default conversation',
            started_at: 1, ended_at: null, last_active: 2, is_active: true, message_count: 1,
            tool_call_count: 0, input_tokens: 1, output_tokens: 1, preview: 'Default profile'
          }]
        } as never)
      }
      return new Promise(resolve => {
        resolveOldPage = resolve
      })
    }) as never)
    await renderAt('/mobile/chats')
    await act(async () => {
      ;(container.querySelector('button[aria-label="Load more conversations"]') as HTMLButtonElement).click()
      await Promise.resolve()
    })

    profileMocks.profile = 'mabel'
    await renderAt('/mobile/chats')
    await waitForReact(() => expect(container.textContent).toContain('Mabel conversation'))
    await act(async () => {
      resolveOldPage({
        limit: 30,
        offset: 1,
        total: 2,
        sessions: [{
          id: 'default-2', source: 'desktop', model: 'gpt-5.6-sol', title: 'Leaked default conversation',
          started_at: 1, ended_at: null, last_active: 1, is_active: false, message_count: 1,
          tool_call_count: 0, input_tokens: 1, output_tokens: 1, preview: 'Wrong profile'
        }]
      } as never)
      await Promise.resolve()
    })

    expect(container.textContent).toContain('Mabel conversation')
    expect(container.textContent).not.toContain('Leaked default conversation')
  })

  it('opens an attachment picker from the chat composer', async () => {
    await renderAt('/mobile/chat/new')

    const picker = container.querySelector('input[type="file"]') as HTMLInputElement | null
    const addButton = container.querySelector('button[aria-label="Add attachment"]') as HTMLButtonElement | null

    expect(picker).not.toBeNull()
    expect(picker?.multiple).toBe(true)
    expect(picker?.accept).toContain('image/*')
    expect(picker?.accept).toContain('.pdf')
    expect(addButton).not.toBeNull()

    const openPicker = vi.spyOn(picker as HTMLInputElement, 'click').mockImplementation(() => {})
    addButton?.click()
    expect(openPicker).toHaveBeenCalledOnce()
  })

  it('sends a selected image through the live Hermes session', async () => {
    gatewayMocks.request.mockImplementation(async (method: string) => {
      if (method === 'session.create') return { session_id: 'runtime-1', stored_session_id: 'stored-1' }
      if (method === 'image.attach_bytes') return { attached: true, path: '/gateway/images/photo.png' }
      return {}
    })
    await renderAt('/mobile/chat/new')

    const picker = container.querySelector('input[type="file"]') as HTMLInputElement
    const image = new File([new Uint8Array([1, 2, 3])], 'photo.png', { type: 'image/png' })
    Object.defineProperty(picker, 'files', { configurable: true, value: [image] })
    await act(async () => {
      picker.dispatchEvent(new Event('change', { bubbles: true }))
    })

    expect(container.textContent).toContain('photo.png')
    expect(container.querySelector('button[aria-label="Remove photo.png"]')).not.toBeNull()

    const textarea = container.querySelector('textarea') as HTMLTextAreaElement
    const form = container.querySelector('form') as HTMLFormElement
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
      valueSetter?.call(textarea, 'Describe this image')
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      await waitForReact(() => {
        if (!gatewayMocks.request.mock.calls.some(([method]) => method === 'prompt.submit')) throw new Error(container.textContent || 'empty')
      })
    })

    const attachCall = gatewayMocks.request.mock.calls.find(([method]) => method === 'image.attach_bytes')
    const submitCall = gatewayMocks.request.mock.calls.find(([method]) => method === 'prompt.submit')
    expect(attachCall).toEqual([
      'image.attach_bytes',
      expect.objectContaining({
        content_base64: 'AQID',
        filename: 'photo.png',
        session_id: 'runtime-1'
      })
    ])
    expect(submitCall).toEqual([
      'prompt.submit',
      { session_id: 'runtime-1', text: 'Describe this image' }
    ])
  })

  it('stages a selected PDF as a gateway-readable file without requiring local PDF tools', async () => {
    gatewayMocks.request.mockImplementation(async (method: string) => {
      if (method === 'session.create') return { session_id: 'runtime-1', stored_session_id: 'stored-1' }
      if (method === 'file.attach') {
        return { attached: true, ref_text: '@file:.hermes/desktop-attachments/report.pdf' }
      }
      return {}
    })
    await renderAt('/mobile/chat/new')

    const picker = container.querySelector('input[type="file"]') as HTMLInputElement
    const pdf = new File([new TextEncoder().encode('%PDF-')], 'report.pdf', { type: 'application/pdf' })
    Object.defineProperty(picker, 'files', { configurable: true, value: [pdf] })
    await act(async () => {
      picker.dispatchEvent(new Event('change', { bubbles: true }))
    })

    const textarea = container.querySelector('textarea') as HTMLTextAreaElement
    const form = container.querySelector('form') as HTMLFormElement
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
      valueSetter?.call(textarea, 'Summarize this PDF')
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      await waitForReact(() => {
        expect(gatewayMocks.request.mock.calls.some(([method]) => method === 'prompt.submit')).toBe(true)
      })
    })

    expect(gatewayMocks.request).toHaveBeenCalledWith(
      'file.attach',
      expect.objectContaining({
        data_url: 'data:application/pdf;base64,JVBERi0=',
        name: 'report.pdf',
        session_id: 'runtime-1'
      })
    )
    const fileAttachCall = gatewayMocks.request.mock.calls.find(([method]) => method === 'file.attach')
    expect(fileAttachCall?.[1]).not.toHaveProperty('path')
    expect(gatewayMocks.request).toHaveBeenCalledWith(
      'prompt.submit',
      {
        session_id: 'runtime-1',
        text: '@file:.hermes/desktop-attachments/report.pdf\n\nSummarize this PDF'
      }
    )
  })

  it('stages a selected document and includes its gateway file reference in the prompt', async () => {
    gatewayMocks.request.mockImplementation(async (method: string) => {
      if (method === 'session.create') return { session_id: 'runtime-1', stored_session_id: 'stored-1' }
      if (method === 'file.attach') {
        return { attached: true, ref_text: '@file:.hermes/desktop-attachments/notes.txt' }
      }
      return {}
    })
    await renderAt('/mobile/chat/new')

    const picker = container.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['hello'], 'notes.txt', { type: 'text/plain' })
    Object.defineProperty(picker, 'files', { configurable: true, value: [file] })
    await act(async () => {
      picker.dispatchEvent(new Event('change', { bubbles: true }))
    })

    const textarea = container.querySelector('textarea') as HTMLTextAreaElement
    const form = container.querySelector('form') as HTMLFormElement
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
      valueSetter?.call(textarea, 'Summarize the notes')
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      await waitForReact(() => {
        expect(gatewayMocks.request.mock.calls.some(([method]) => method === 'prompt.submit')).toBe(true)
      })
    })

    expect(gatewayMocks.request).toHaveBeenCalledWith(
      'file.attach',
      expect.objectContaining({
        data_url: 'data:text/plain;base64,aGVsbG8=',
        name: 'notes.txt',
        session_id: 'runtime-1'
      })
    )
    const fileAttachCall = gatewayMocks.request.mock.calls.find(([method]) => method === 'file.attach')
    expect(fileAttachCall?.[1]).not.toHaveProperty('path')
    expect(gatewayMocks.request).toHaveBeenCalledWith(
      'prompt.submit',
      {
        session_id: 'runtime-1',
        text: '@file:.hermes/desktop-attachments/notes.txt\n\nSummarize the notes'
      }
    )
  })

  it('does not create an empty session when the only attachment is canceled while reading', async () => {
    let finishRead!: () => void
    class DeferredFileReader {
      error: DOMException | null = null
      onerror: ((event: ProgressEvent<FileReader>) => void) | null = null
      onload: ((event: ProgressEvent<FileReader>) => void) | null = null
      result: string | ArrayBuffer | null = null

      readAsDataURL() {
        finishRead = () => {
          this.result = 'data:text/plain;base64,aGVsbG8='
          this.onload?.(new ProgressEvent('load') as ProgressEvent<FileReader>)
        }
      }
    }
    const originalFileReader = globalThis.FileReader
    Object.defineProperty(globalThis, 'FileReader', { configurable: true, value: DeferredFileReader })
    try {
      await renderAt('/mobile/chat/new')
      const picker = container.querySelector('input[type="file"]') as HTMLInputElement
      const file = new File(['hello'], 'cancel-me.txt', { type: 'text/plain' })
      Object.defineProperty(picker, 'files', { configurable: true, value: [file] })
      await act(async () => picker.dispatchEvent(new Event('change', { bubbles: true })))

      const form = container.querySelector('form') as HTMLFormElement
      await act(async () => {
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      })
      await waitForReact(() => expect(container.querySelector('button[aria-label="Cancel cancel-me.txt"]')).not.toBeNull())
      await act(async () => {
        ;(container.querySelector('button[aria-label="Cancel cancel-me.txt"]') as HTMLButtonElement).click()
        finishRead()
        await Promise.resolve()
      })

      await waitForReact(() => {
        expect(gatewayMocks.request.mock.calls.filter(([method]) => method === 'session.create')).toHaveLength(0)
        expect(gatewayMocks.request.mock.calls.filter(([method]) => method === 'file.attach')).toHaveLength(0)
        expect(gatewayMocks.request.mock.calls.filter(([method]) => method === 'prompt.submit')).toHaveLength(0)
        expect(container.querySelectorAll('.mobile-bubble.is-user')).toHaveLength(0)
      })
    } finally {
      Object.defineProperty(globalThis, 'FileReader', { configurable: true, value: originalFileReader })
    }
  })

  it('does not submit an earlier prepared attachment after every selected file is canceled', async () => {
    const pendingReads: Array<() => void> = []
    class DeferredFileReader {
      error: DOMException | null = null
      onerror: ((event: ProgressEvent<FileReader>) => void) | null = null
      onload: ((event: ProgressEvent<FileReader>) => void) | null = null
      result: string | ArrayBuffer | null = null

      readAsDataURL() {
        pendingReads.push(() => {
          this.result = 'data:text/plain;base64,aGVsbG8='
          this.onload?.(new ProgressEvent('load') as ProgressEvent<FileReader>)
        })
      }
    }
    const originalFileReader = globalThis.FileReader
    Object.defineProperty(globalThis, 'FileReader', { configurable: true, value: DeferredFileReader })
    try {
      await renderAt('/mobile/chat/new')
      const picker = container.querySelector('input[type="file"]') as HTMLInputElement
      const first = new File(['first'], 'first.txt', { type: 'text/plain' })
      const second = new File(['second'], 'second.txt', { type: 'text/plain' })
      Object.defineProperty(picker, 'files', { configurable: true, value: [first, second] })
      await act(async () => picker.dispatchEvent(new Event('change', { bubbles: true })))

      const form = container.querySelector('form') as HTMLFormElement
      await act(async () => {
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
        await waitForReact(() => expect(pendingReads).toHaveLength(1))
        pendingReads[0]()
        await waitForReact(() => expect(pendingReads).toHaveLength(2))
      })
      await act(async () => {
        ;(container.querySelector('button[aria-label="Cancel first.txt"]') as HTMLButtonElement).click()
        ;(container.querySelector('button[aria-label="Cancel second.txt"]') as HTMLButtonElement).click()
        pendingReads[1]()
        await Promise.resolve()
      })

      await waitForReact(() => {
        expect(gatewayMocks.request.mock.calls.filter(([method]) => method === 'session.create')).toHaveLength(0)
        expect(gatewayMocks.request.mock.calls.filter(([method]) => method === 'file.attach')).toHaveLength(0)
        expect(gatewayMocks.request.mock.calls.filter(([method]) => method === 'prompt.submit')).toHaveLength(0)
        expect(container.querySelectorAll('.mobile-bubble.is-user')).toHaveLength(0)
      })
    } finally {
      Object.defineProperty(globalThis, 'FileReader', { configurable: true, value: originalFileReader })
    }
  })

  it('preserves pending and newly selected attachments when an upload fails', async () => {
    let rejectAttach!: (error: Error) => void
    gatewayMocks.request.mockImplementation((method: string) => {
      if (method === 'session.create') return Promise.resolve({ session_id: 'runtime-1', stored_session_id: 'stored-1' })
      if (method === 'file.attach') {
        return new Promise((_resolve, reject) => {
          rejectAttach = reject
        })
      }
      return Promise.resolve({})
    })
    await renderAt('/mobile/chat/new')

    const picker = container.querySelector('input[type="file"]') as HTMLInputElement
    const form = container.querySelector('form') as HTMLFormElement
    const first = new File(['first'], 'first.txt', { type: 'text/plain' })
    Object.defineProperty(picker, 'files', { configurable: true, value: [first] })
    await act(async () => picker.dispatchEvent(new Event('change', { bubbles: true })))

    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      await waitForReact(() => expect(gatewayMocks.request.mock.calls.some(([method]) => method === 'file.attach')).toBe(true))
    })
    expect(picker.disabled).toBe(true)
    expect((container.querySelector('button[aria-label="Add attachment"]') as HTMLButtonElement).disabled).toBe(true)

    const second = new File(['second'], 'second.txt', { type: 'text/plain' })
    Object.defineProperty(picker, 'files', { configurable: true, value: [second] })
    await act(async () => picker.dispatchEvent(new Event('change', { bubbles: true })))
    await act(async () => {
      rejectAttach(new Error('upload failed'))
      await Promise.resolve()
    })

    await waitForReact(() => {
      expect(container.textContent).toContain('first.txt')
      expect(container.textContent).toContain('second.txt')
      expect(container.textContent).toContain('upload failed')
    })
  })

  it('never exposes a recovered operation after switching to another session scope', async () => {
    const outbox = createMobileOutbox()
    await outbox.createReady({ attachments: [], profile: 'default', storedSessionId: 'session-1', text: 'private scope A' })
    outbox.close()
    await renderAt('/mobile/chat/session-1')
    await waitForReact(() => expect(container.querySelector('button[aria-label="Review queued message"]')).not.toBeNull())

    await act(async () => {
      ;(container.querySelector('[data-testid="switch-to-session-b"]') as HTMLAnchorElement).click()
    })

    expect(container.querySelector('button[aria-label="Review queued message"]')).toBeNull()
    expect(container.textContent).not.toContain('private scope A')
  })

  it('never exposes a recovered operation after switching profiles in the same chat route', async () => {
    const outbox = createMobileOutbox()
    await outbox.createReady({ attachments: [], profile: 'default', storedSessionId: 'session-1', text: 'private default profile' })
    outbox.close()
    await renderAt('/mobile/chat/session-1')
    await waitForReact(() => expect(container.querySelector('button[aria-label="Review queued message"]')).not.toBeNull())

    profileMocks.profile = 'mabel'
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/mobile/chat/session-1']} key="/mobile/chat/session-1">
          <MobileAppHarness />
        </MemoryRouter>
      )
    })

    expect(container.querySelector('button[aria-label="Review queued message"]')).toBeNull()
  })

  it('allows drafting while the gateway connects and queues the message safely', async () => {
    let finishConnect!: () => void
    gatewayMocks.connect.mockReturnValueOnce(new Promise<void>(resolve => {
      finishConnect = resolve
    }))
    await renderAt('/mobile/chat/new')

    const textarea = container.querySelector('textarea') as HTMLTextAreaElement
    const form = container.querySelector('.mobile-composer') as HTMLFormElement
    expect(textarea.disabled).toBe(false)
    expect(textarea.placeholder).toBe('Write now — Hermes will send when connected…')
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
      valueSetter?.call(textarea, 'Queue this safely')
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    await waitForReact(() => expect(container.textContent).toContain('Queued until Hermes reconnects'))
    expect(gatewayMocks.request).not.toHaveBeenCalledWith('prompt.submit', expect.anything())

    await act(async () => {
      finishConnect()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(gatewayMocks.request).not.toHaveBeenCalledWith('prompt.submit', expect.anything())
    await waitForReact(() => {
      expect(container.textContent).toContain('Connected to Desktop')
      expect(container.querySelector('button[aria-label="Review queued message"]')).not.toBeNull()
    })
    const reviewQueued = container.querySelector('button[aria-label="Review queued message"]') as HTMLButtonElement
    await act(async () => reviewQueued.click())
    expect(textarea.value).toBe('Queue this safely')
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      await Promise.resolve()
    })
    await waitForReact(() => expect(gatewayMocks.request).toHaveBeenCalledWith(
      'prompt.submit',
      expect.objectContaining({ text: 'Queue this safely' })
    ))
    expect(gatewayMocks.request).toHaveBeenCalledWith(
      'session.create',
      expect.objectContaining({ mobile_operation_id: expect.any(String) })
    )
    expect(gatewayMocks.request.mock.calls.filter(([method]) => method === 'prompt.submit')).toHaveLength(1)
    await waitForReact(() => expect(container.querySelector('button[aria-label="Review queued message"]')).toBeNull())
    const outboxAudit = createMobileOutbox()
    expect(await outboxAudit.list('default', 'new')).toEqual([])
    outboxAudit.close()

    await renderAt('/mobile/chat/new')
    await waitForReact(() => expect(container.textContent).toContain('Connected to Desktop'))
    expect(container.querySelector('button[aria-label="Review queued message"]')).toBeNull()
    expect(gatewayMocks.request.mock.calls.filter(([method]) => method === 'prompt.submit')).toHaveLength(1)
  })

  it('persists unsent drafts across mobile route changes', async () => {
    await renderAt('/mobile/chat/new')
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
      valueSetter?.call(textarea, 'Keep this draft')
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
    })

    await renderAt('/mobile')
    await renderAt('/mobile/chat/new')
    expect((container.querySelector('textarea') as HTMLTextAreaElement).value).toBe('Keep this draft')
  })

  it('marks an uncertain prompt submission for review without restoring it for automatic retry', async () => {
    gatewayMocks.request.mockImplementation(async (method: string) => {
      if (method === 'session.create') return { session_id: 'runtime-1', stored_session_id: 'stored-1' }
      if (method === 'prompt.submit') throw new Error('Connection lost')
      return {}
    })
    await renderAt('/mobile/chat/new')

    const textarea = container.querySelector('textarea') as HTMLTextAreaElement
    const form = container.querySelector('form') as HTMLFormElement
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
      valueSetter?.call(textarea, 'Do not lose this prompt')
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      await Promise.resolve()
      await Promise.resolve()
    })

    await waitForReact(() => {
      expect(textarea.value).toBe('')
      expect(container.textContent).toContain('Connection lost')
      expect(container.textContent).toContain('Needs review: Hermes may already have received this message.')
      expect(container.querySelector('button[aria-label="Review message with uncertain delivery"]')).not.toBeNull()
      expect(container.querySelectorAll('.mobile-bubble.is-user')).toHaveLength(0)
    })

    await renderAt('/mobile/chat/stored-1')
    await waitForReact(() => {
      expect(container.querySelector('button[aria-label="Review message with uncertain delivery"]')).not.toBeNull()
    })
    await renderAt('/mobile/chat/new')
    await waitForReact(() => expect(container.textContent).toContain('Connected to Desktop'))
    expect(container.querySelector('button[aria-label="Review message with uncertain delivery"]')).toBeNull()
    expect(gatewayMocks.request.mock.calls.filter(([method]) => method === 'prompt.submit')).toHaveLength(1)
  })

  it('keeps offline drafting available after the gateway closes without sending prematurely', async () => {
    await renderAt('/mobile/chat/new')
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
      valueSetter?.call(textarea, 'Keep this while reconnecting')
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
      gatewayMocks.stateHandler?.('closed')
    })

    expect(textarea.disabled).toBe(false)
    expect(textarea.value).toBe('Keep this while reconnecting')
    expect(container.querySelector('button[aria-label="Queue message"]')).not.toBeNull()
  })

  it('reconnects with bounded backoff and re-enables the preserved draft', async () => {
    vi.useFakeTimers()
    try {
      gatewayMocks.connect
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('still offline'))
        .mockResolvedValueOnce(undefined)
      await renderAt('/mobile/chat/new')
      const textarea = container.querySelector('textarea') as HTMLTextAreaElement
      await act(async () => {
        const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
        valueSetter?.call(textarea, 'Send after reconnect')
        textarea.dispatchEvent(new Event('input', { bubbles: true }))
        gatewayMocks.stateHandler?.('closed')
      })
      expect(textarea.disabled).toBe(false)
      expect(container.querySelector('button[aria-label="Queue message"]')).not.toBeNull()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(500)
      })
      expect(gatewayMocks.connect).toHaveBeenCalledTimes(2)
      expect(textarea.disabled).toBe(false)

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000)
      })
      expect(gatewayMocks.connect).toHaveBeenCalledTimes(3)
      expect(textarea.disabled).toBe(false)
      expect(textarea.value).toBe('Send after reconnect')
      expect(container.querySelector('button[aria-label="Send message"]')).not.toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('offers a manual retry after automatic reconnect attempts are exhausted', async () => {
    vi.useFakeTimers()
    try {
      gatewayMocks.connect.mockRejectedValue(new Error('offline'))
      await renderAt('/mobile/chat/new')
      await act(async () => {
        await vi.advanceTimersByTimeAsync(15_501)
        await Promise.resolve()
      })

      const retry = container.querySelector('button[aria-label="Retry Hermes connection"]') as HTMLButtonElement
      expect(retry).not.toBeNull()
      gatewayMocks.connect.mockResolvedValue(undefined)
      await act(async () => {
        retry.click()
        await Promise.resolve()
      })
      expect((container.querySelector('textarea') as HTMLTextAreaElement).disabled).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('hydrates persisted history and live state when an existing chat reconnects after its initial connection fails', async () => {
    vi.useFakeTimers()
    try {
      gatewayMocks.connect
        .mockRejectedValueOnce(new Error('initial connection failed'))
        .mockResolvedValueOnce(undefined)
      apiMocks.getSessionMessages.mockResolvedValueOnce({
        messages: [
          { id: 41, role: 'user', content: 'Persisted question', timestamp: 1 } as never,
          { id: 42, role: 'assistant', content: 'Persisted answer', timestamp: 2 } as never
        ],
        pagination: { limit: 500, offset: 0, order: 'latest', returned: 2 },
        session_id: 'session-1'
      })
      gatewayMocks.request.mockImplementation(async (method: string) => {
        if (method === 'session.resume') {
          return {
            inflight: {
              assistant: 'Live partial answer',
              streaming: true,
              user: 'Current desktop prompt'
            },
            running: true,
            session_id: 'runtime-resumed',
            status: 'working'
          }
        }
        return {}
      })

      await renderAt('/mobile/chat/session-1')
      const textarea = container.querySelector('textarea') as HTMLTextAreaElement
      expect(textarea.disabled).toBe(false)
      expect(textarea.placeholder).toBe('Write now — Hermes will send when connected…')
      expect(apiMocks.getSessionMessages).not.toHaveBeenCalled()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(500)
      })

      expect(apiMocks.getSessionMessages).toHaveBeenCalledWith('session-1', '')
      expect(container.textContent).toContain('Persisted question')
      expect(container.textContent).toContain('Persisted answer')
      expect(container.textContent).toContain('Current desktop prompt')
      expect(container.textContent).toContain('Live partial answer')
      expect(textarea.disabled).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the reading position during streaming and offers a jump to latest control', async () => {
    apiMocks.getSessionMessages.mockResolvedValueOnce({
      messages: [
        { role: 'user', content: 'Earlier question', timestamp: 1 } as never,
        { role: 'assistant', content: 'Earlier answer', timestamp: 2 } as never
      ],
      session_id: 'session-1'
    })
    await renderAt('/mobile/chat/session-1')
    const thread = container.querySelector('.mobile-chat-thread') as HTMLDivElement
    Object.defineProperties(thread, {
      clientHeight: { configurable: true, value: 300 },
      scrollHeight: { configurable: true, value: 1000 }
    })
    thread.scrollTop = 200
    thread.dispatchEvent(new Event('scroll', { bubbles: true }))

    await act(async () => {
      gatewayMocks.eventHandler?.({ session_id: 'runtime-resumed', type: 'message.start' })
      await Promise.resolve()
    })

    expect(thread.scrollTop).toBe(200)
    const jump = container.querySelector('button[aria-label="Jump to latest message"]') as HTMLButtonElement | null
    expect(jump).not.toBeNull()
    await act(async () => {
      jump?.click()
    })
    expect(thread.scrollTop).toBe(1000)
  })

  it('loads earlier transcript pages and preserves the visible scroll anchor', async () => {
    let resolveOlder!: (value: {
      messages: never[]
      pagination: { limit: number; offset: number; order: 'latest'; returned: number }
      session_id: string
    }) => void
    const olderPage = new Promise<{
      messages: never[]
      pagination: { limit: number; offset: number; order: 'latest'; returned: number }
      session_id: string
    }>(resolve => {
      resolveOlder = resolve
    })
    apiMocks.getSessionMessages
      .mockResolvedValueOnce({
        messages: [{ id: 501, role: 'assistant', content: 'Newest visible answer' } as never],
        pagination: { limit: 500, offset: 0, order: 'latest', returned: 500 },
        session_id: 'session-1'
      })
      .mockReturnValueOnce(olderPage)
    await renderAt('/mobile/chat/session-1')

    const thread = container.querySelector('.mobile-chat-thread') as HTMLDivElement
    let scrollHeight = 1000
    Object.defineProperties(thread, {
      clientHeight: { configurable: true, value: 300 },
      scrollHeight: { configurable: true, get: () => scrollHeight }
    })
    thread.scrollTop = 100
    thread.dispatchEvent(new Event('scroll', { bubbles: true }))
    const loadEarlier = container.querySelector('button[aria-label="Load earlier messages"]') as HTMLButtonElement

    await act(async () => {
      loadEarlier.click()
      scrollHeight = 1300
      resolveOlder({
        messages: [{ id: 1, role: 'user', content: 'Oldest question' } as never],
        pagination: { limit: 500, offset: 500, order: 'latest', returned: 1 },
        session_id: 'session-1'
      })
      await olderPage
    })

    expect(container.textContent).toContain('Oldest question')
    expect(thread.scrollTop).toBe(400)
    expect(apiMocks.getSessionMessages).toHaveBeenLastCalledWith(
      'session-1',
      '',
      { limit: 500, offset: 500, order: 'latest' }
    )
    expect(container.querySelector('button[aria-label="Load earlier messages"]')).toBeNull()
  })

  it('submits a prompt only once when send is triggered twice before streaming starts', async () => {
    let releasePrompt!: () => void
    const pendingPrompt = new Promise<void>(resolve => {
      releasePrompt = resolve
    })
    gatewayMocks.request.mockImplementation(async (method: string) => {
      if (method === 'session.create') {
        return { session_id: 'runtime-1', stored_session_id: 'stored-1' }
      }
      if (method === 'prompt.submit') return pendingPrompt
      return {}
    })
    await renderAt('/mobile/chat/new')

    const textarea = container.querySelector('textarea') as HTMLTextAreaElement
    const form = container.querySelector('form') as HTMLFormElement
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
      valueSetter?.call(textarea, 'Run once')
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(textarea.value).toBe('Run once')
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      await Promise.resolve()
    })

    await waitForReact(() => {
      expect(gatewayMocks.request.mock.calls.filter(([method]) => method === 'session.create')).toHaveLength(1)
      expect(gatewayMocks.request.mock.calls.filter(([method]) => method === 'prompt.submit')).toHaveLength(1)
    })

    releasePrompt()
    await act(async () => pendingPrompt)
  })

  it('shows failure notifications ahead of disconnected Desktop, failed tasks, and resumable work', async () => {
    apiMocks.getStatus.mockResolvedValueOnce({ active_sessions: 0, gateway_running: false, gateway_state: 'stopped', version: '1.0.0' })
    apiMocks.getCronJobs.mockResolvedValueOnce([{ id: 'failed-task', enabled: true, last_status: 'failed', name: 'Verify backup' } as never])
    apiMocks.getMobileNotifications.mockResolvedValueOnce({ items: [
      { id: 'notice-1', level: 'error', read_at: null, title: 'Backup failed', body: 'Backup could not complete.', created_at: 1 } as never
    ], total: 1 })
    await renderAt('/mobile')

    const cards = Array.from(container.querySelectorAll('.mobile-today-card')).map(card => card.textContent)
    expect(cards).toHaveLength(4)
    expect(cards[0]).toContain('Backup failed')
    expect(cards[1]).toContain('disconnected')
    expect(cards[2]).toContain('Verify backup')
    expect(cards[3]).toContain('Hermes mobile PWA')
    expect(container.querySelector('a[aria-label="Ask Hermes"]')).not.toBeNull()
  })

  it('hides notifications from the previous profile while the next profile is loading', async () => {
    let resolveMabel!: (value: { items: never[]; total: number }) => void
    apiMocks.getMobileNotifications.mockImplementation(((requestedProfile: string) => {
      if (requestedProfile === 'mabel') return new Promise(resolve => { resolveMabel = resolve })
      return Promise.resolve({ items: [
        { id: 'default-notice', level: 'error', read_at: null, title: 'Default profile only', body: 'Private default notice.', created_at: 1 } as never
      ], total: 1 })
    }) as never)

    await act(async () => {
      root.render(<MemoryRouter initialEntries={['/mobile']}><MobileAppHarness /></MemoryRouter>)
      await Promise.resolve()
    })
    await vi.waitFor(() => expect(container.textContent).toContain('Default profile only'))

    profileMocks.profile = 'mabel'
    await act(async () => {
      root.render(<MemoryRouter initialEntries={['/mobile']}><MobileAppHarness /></MemoryRouter>)
      await Promise.resolve()
    })

    expect(container.textContent).not.toContain('Default profile only')
    await act(async () => {
      resolveMabel({ items: [], total: 0 })
      await Promise.resolve()
    })
  })

  it('persists Home visibility, ordering, text size, and density in the selected profile', async () => {
    profileMocks.profile = 'mabel'
    await renderAt('/mobile/more')
    await act(async () => {
      ;(Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Customize') as HTMLButtonElement).click()
    })
    await act(async () => {
      ;(Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Large') as HTMLButtonElement).click()
    })
    await act(async () => {
      ;(Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Compact') as HTMLButtonElement).click()
    })
    await act(async () => {
      ;(container.querySelector('button[aria-label="Move Task attention earlier"]') as HTMLButtonElement).click()
    })

    const stored = JSON.parse(window.localStorage.getItem('hermes.mobile.preferences.v1:mabel') ?? '{}')
    expect(stored).toMatchObject({ textSize: 'large', density: 'compact' })
    expect(stored.cardOrder.indexOf('tasks')).toBeLessThan(2)
  })

  it('enables a normal follow-up after a resumed clarification expires', async () => {
    gatewayMocks.request.mockImplementation(async (method: string) => {
      if (method === 'session.resume') {
        return {
          pending_prompt: {
            type: 'clarify.request',
            payload: { request_id: 'clarify-expired', question: 'Choose?', choices: ['one', 'two'] }
          },
          running: true,
          session_id: 'runtime-expired'
        }
      }
      return {}
    })
    await renderAt('/mobile/chat/session-1')

    const textarea = container.querySelector('textarea[aria-label="Message Hermes"]') as HTMLTextAreaElement
    expect(textarea.disabled).toBe(true)
    await act(async () => gatewayMocks.eventHandler?.({
      payload: { request_id: 'clarify-expired' },
      session_id: 'runtime-expired',
      type: 'clarify.expire'
    }))

    expect(textarea.disabled).toBe(false)
    const form = container.querySelector('form') as HTMLFormElement
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
      setter?.call(textarea, 'Following up normally')
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      await Promise.resolve()
    })
    await waitForReact(() => {
      expect(gatewayMocks.request.mock.calls.filter(([method]) => method === 'prompt.submit')).toHaveLength(1)
    })
  })

  it('allows an expired clarification follow-up after the original submit acknowledgement stalls', async () => {
    let releaseOriginal!: () => void
    let releaseFollowup!: () => void
    const originalSubmit = new Promise<void>(resolve => { releaseOriginal = resolve })
    const followupSubmit = new Promise<void>(resolve => { releaseFollowup = resolve })
    let promptCalls = 0
    gatewayMocks.request.mockImplementation((method: string) => {
      if (method === 'session.resume') return Promise.resolve({ running: false, session_id: 'runtime-expiry-race' })
      if (method === 'prompt.submit') {
        promptCalls += 1
        return promptCalls === 1 ? originalSubmit : followupSubmit
      }
      return Promise.resolve({})
    })
    await renderAt('/mobile/chat/session-1')

    const textarea = container.querySelector('textarea[aria-label="Message Hermes"]') as HTMLTextAreaElement
    const form = container.querySelector('form') as HTMLFormElement
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
      setter?.call(textarea, 'Original prompt')
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      await Promise.resolve()
    })
    await waitForReact(() => expect(promptCalls).toBe(1))
    await act(async () => gatewayMocks.eventHandler?.({
      payload: { request_id: 'clarify-race', question: 'Choose?' },
      session_id: 'runtime-expiry-race',
      type: 'clarify.request'
    }))
    await act(async () => gatewayMocks.eventHandler?.({
      payload: { request_id: 'clarify-race' },
      session_id: 'runtime-expiry-race',
      type: 'clarify.expire'
    }))

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
      setter?.call(textarea, 'Follow-up after expiry')
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      await Promise.resolve()
    })
    await waitForReact(() => expect(promptCalls).toBe(2))
    releaseOriginal()
    await act(async () => originalSubmit)
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
      setter?.call(textarea, 'Third prompt while follow-up is pending')
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      await Promise.resolve()
    })
    expect(promptCalls).toBe(2)
    releaseFollowup()
    await act(async () => followupSubmit)
  })

  it('replays a session action that arrives while session resume is still resolving', async () => {
    let finishResume!: (value: { session_id: string }) => void
    const pendingResume = new Promise<{ session_id: string }>(resolve => { finishResume = resolve })
    gatewayMocks.request.mockImplementation((method: string) => method === 'session.resume' ? pendingResume : Promise.resolve({}))
    await renderAt('/mobile/chat/session-1')

    await act(async () => gatewayMocks.eventHandler?.({
      payload: { choices: ['once', 'deny'], command: 'buffered command', request_id: 'approval-buffered' },
      session_id: 'runtime-buffered',
      type: 'approval.request'
    }))
    expect(container.querySelector('[aria-label="Command approval needed"]')).toBeNull()

    await act(async () => {
      finishResume({ session_id: 'runtime-buffered' })
      await pendingResume
    })
    expect(container.querySelector('[aria-label="Command approval needed"]')).not.toBeNull()
    expect(container.textContent).toContain('buffered command')
  })

  it('buffers the destination session action while switching between resumed chats', async () => {
    let finishSecondResume!: (value: { session_id: string }) => void
    const secondResume = new Promise<{ session_id: string }>(resolve => { finishSecondResume = resolve })
    gatewayMocks.request.mockImplementation((method: string, params?: { session_id?: string }) => {
      if (method !== 'session.resume') return Promise.resolve({})
      return params?.session_id === 'session-a'
        ? Promise.resolve({ session_id: 'runtime-a' })
        : secondResume
    })
    await renderAt('/mobile/chat/session-a')

    await act(async () => {
      ;(container.querySelector('[data-testid="switch-to-session-b"]') as HTMLAnchorElement).click()
      await Promise.resolve()
    })
    await act(async () => gatewayMocks.eventHandler?.({
      payload: { choices: ['once', 'deny'], command: 'destination command', request_id: 'approval-destination' },
      session_id: 'runtime-b',
      type: 'approval.request'
    }))
    await act(async () => {
      finishSecondResume({ session_id: 'runtime-b' })
      await secondResume
    })

    expect(container.querySelector('[aria-label="Command approval needed"]')).not.toBeNull()
    expect(container.textContent).toContain('destination command')
  })

  it('rehydrates the next server-queued approval after responding to the resumed FIFO head', async () => {
    let resumeCount = 0
    gatewayMocks.request.mockImplementation(async (method: string) => {
      if (method === 'session.resume') {
        resumeCount += 1
        const command = resumeCount === 1 ? 'queued command A' : resumeCount === 2 ? 'queued command B' : null
        return {
          ...(command ? {
            pending_prompt: {
              payload: { allow_permanent: false, choices: ['once', 'deny'], command, request_id: `approval-${command.slice(-1)}` },
              type: 'approval.request'
            }
          } : {}),
          session_id: 'runtime-queued-actions'
        }
      }
      return {}
    })
    await renderAt('/mobile/chat/session-1')
    expect(container.textContent).toContain('queued command A')

    await act(async () => {
      ;(container.querySelector('button[aria-label="Run once"]') as HTMLButtonElement).click()
      await Promise.resolve()
      await Promise.resolve()
    })
    await vi.waitFor(() => expect(container.textContent).toContain('queued command B'))
    await act(async () => gatewayMocks.eventHandler?.({
      payload: {
        allow_permanent: false,
        choices: ['once', 'deny'],
        command: 'queued command B',
        request_id: 'approval-B'
      },
      session_id: 'runtime-queued-actions',
      type: 'approval.request'
    }))

    await act(async () => {
      ;(container.querySelector('button[aria-label="Run once"]') as HTMLButtonElement).click()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(gatewayMocks.request.mock.calls.filter(([method]) => method === 'approval.respond')).toHaveLength(2)
    expect(container.textContent).not.toContain('queued command B')
  })

  it('answers queued actions in the same FIFO order the backend resolves them', async () => {
    let finishFirstResponse!: () => void
    const firstResponse = new Promise<void>(resolve => { finishFirstResponse = resolve })
    gatewayMocks.request.mockImplementation((method: string) => {
      if (method === 'session.resume') return Promise.resolve({ session_id: 'runtime-actions' })
      if (method === 'clarify.respond') return firstResponse
      return Promise.resolve({})
    })
    await renderAt('/mobile/chat/session-1')
    await act(async () => gatewayMocks.eventHandler?.({
      payload: { request_id: 'clarify-a', question: 'First question?' },
      session_id: 'runtime-actions',
      type: 'clarify.request'
    }))

    const answer = container.querySelector('textarea[aria-label="Clarification answer"]') as HTMLTextAreaElement
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
      setter?.call(answer, 'First answer')
      answer.dispatchEvent(new Event('input', { bubbles: true }))
      ;(container.querySelector('button[aria-label="Continue clarification"]') as HTMLButtonElement).click()
    })
    await act(async () => gatewayMocks.eventHandler?.({
      payload: { choices: ['once', 'deny'], command: 'echo newer', request_id: 'approval-newer' },
      session_id: 'runtime-actions',
      type: 'approval.request'
    }))
    expect(container.querySelector('[aria-label="Clarification needed"]')).not.toBeNull()
    expect(container.textContent).toContain('First question?')
    expect(container.querySelector('[aria-label="Command approval needed"]')).toBeNull()

    await act(async () => {
      finishFirstResponse()
      await firstResponse
    })
    expect(container.querySelector('[aria-label="Command approval needed"]')).not.toBeNull()
    expect(container.textContent).toContain('echo newer')
  })

  it('recovers from a malformed encoded chat URL', async () => {
    await renderAt('/mobile/chat/%')

    expect(container.textContent).toContain('Chats')
    expect(container.querySelector('nav[aria-label="Mobile navigation"]')).not.toBeNull()
  })

  it('resumes a session through the selected management profile', async () => {
    profileMocks.profile = 'mabel'
    await renderAt('/mobile/chat/session-1')

    expect(apiMocks.getSessionMessages).toHaveBeenCalledWith('session-1', 'mabel')
    expect(gatewayMocks.request).toHaveBeenCalledWith(
      'session.resume',
      expect.objectContaining({ omit_messages: true, profile: 'mabel', session_id: 'session-1' })
    )
  })

  it('hydrates a live Desktop turn and keeps the composer disabled until it completes', async () => {
    gatewayMocks.request.mockImplementation(async (method: string) => {
      if (method === 'session.resume') {
        return {
          inflight: {
            assistant: 'Partial from Desktop',
            streaming: true,
            user: 'Long-running Desktop request'
          },
          running: true,
          session_id: 'runtime-live'
        }
      }
      return {}
    })
    await renderAt('/mobile/chat/session-1')

    const textarea = container.querySelector('textarea') as HTMLTextAreaElement
    expect(container.textContent).toContain('Long-running Desktop request')
    expect(container.textContent).toContain('Partial from Desktop')
    expect(textarea.disabled).toBe(true)

    await act(async () => {
      gatewayMocks.eventHandler?.({
        payload: { text: ' continued' },
        session_id: 'runtime-live',
        type: 'message.delta'
      })
    })
    expect(container.textContent).toContain('Partial from Desktop continued')
  })

  it('creates a session through the selected management profile', async () => {
    profileMocks.profile = 'mabel'
    await renderAt('/mobile/chat/new')

    const textarea = container.querySelector('textarea') as HTMLTextAreaElement
    const form = container.querySelector('form') as HTMLFormElement
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
      valueSetter?.call(textarea, 'Profile-scoped prompt')
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      await Promise.resolve()
    })

    await waitForReact(() => expect(gatewayMocks.request).toHaveBeenCalledWith('session.create', expect.objectContaining({ profile: 'mabel' })))
  })

  it('refreshes conversations after creating a chat so it appears when returning to Chats', async () => {
    const emptySessions = { limit: 20, offset: 0, total: 0, sessions: [] }
    const refreshedSessions = {
      limit: 20,
      offset: 0,
      total: 1,
      sessions: [{
        id: 'stored-1',
        source: 'web',
        model: 'gpt-5.6-sol',
        title: 'Fresh mobile chat',
        started_at: 1,
        ended_at: null,
        last_active: 2,
        is_active: true,
        message_count: 1,
        tool_call_count: 0,
        input_tokens: 1,
        output_tokens: 0,
        preview: 'Created from Mobile'
      }]
    }
    apiMocks.getSessions
      .mockResolvedValueOnce(emptySessions)
      .mockResolvedValueOnce(refreshedSessions as never)
    await renderAt('/mobile/chat/new')

    const textarea = container.querySelector('textarea') as HTMLTextAreaElement
    const form = container.querySelector('form') as HTMLFormElement
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
      valueSetter?.call(textarea, 'Create a visible session')
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      await Promise.resolve()
      await Promise.resolve()
    })

    await waitForReact(() => {
      expect(container.querySelector('button[aria-label="Go back"]')).not.toBeNull()
      expect(apiMocks.getSessions.mock.calls.length).toBeGreaterThanOrEqual(2)
    })
    await act(async () => {
      const back = container.querySelector('button[aria-label="Go back"]') as HTMLButtonElement
      back.click()
      await Promise.resolve()
    })
    await waitForReact(() => expect(container.textContent).toContain('Fresh mobile chat'))
    expect(apiMocks.getSessions.mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(apiMocks.getStatus).toHaveBeenCalledTimes(1)
    expect(apiMocks.getCronJobs).toHaveBeenCalledTimes(1)
  })

  it('loads tasks only from the selected management profile', async () => {
    profileMocks.profile = 'mabel'
    await renderAt('/mobile/tasks')

    expect(apiMocks.getCronJobs).toHaveBeenCalledWith('mabel')
    expect(apiMocks.getCronJobs).not.toHaveBeenCalledWith('all')
  })

  it('shows a load error instead of claiming a failed conversations request is empty', async () => {
    apiMocks.getSessions.mockRejectedValueOnce(new Error('offline'))
    await renderAt('/mobile/chats')

    expect(container.textContent).toContain('Could not load conversations.')
    expect(container.textContent).not.toContain('No conversations yet.')
  })

  it('renders completed conversations without waiting for unrelated requests', async () => {
    apiMocks.getStatus.mockReturnValueOnce(new Promise(() => {}))
    apiMocks.getCronJobs.mockReturnValueOnce(new Promise(() => {}))
    await renderAt('/mobile/chats')

    expect(container.textContent).toContain('Hermes mobile PWA')
    expect(container.textContent).not.toContain('Loading conversations…')
  })

  it('hides the previous profile status while the next profile is loading', async () => {
    apiMocks.getStatus.mockResolvedValueOnce({
      active_sessions: 7,
      gateway_running: true,
      gateway_state: 'running',
      version: '1.0.0'
    })
    await renderAt('/mobile')
    expect(container.textContent).toContain('7 sessions active.')

    apiMocks.getStatus.mockReturnValueOnce(new Promise(() => {}))
    profileMocks.profile = 'mabel'
    await renderAt('/mobile')

    expect(container.textContent).not.toContain('7 sessions active.')
    expect(container.textContent).toContain('Loading Hermes status…')
  })

  it('shows a load error instead of claiming a failed tasks request is empty', async () => {
    apiMocks.getCronJobs.mockRejectedValueOnce(new Error('offline'))
    await renderAt('/mobile/tasks')

    expect(container.textContent).toContain('Could not load scheduled tasks.')
    expect(container.textContent).not.toContain('No scheduled tasks.')
  })

  it('keeps a resumed chat usable when only transcript loading fails', async () => {
    apiMocks.getSessionMessages.mockRejectedValueOnce(new Error('history unavailable'))
    await renderAt('/mobile/chat/session-1')

    const textarea = container.querySelector('textarea') as HTMLTextAreaElement
    expect(container.textContent).toContain('Could not load conversation history.')
    expect(textarea.disabled).toBe(false)
    expect(gatewayMocks.request).toHaveBeenCalledWith(
      'session.resume',
      expect.objectContaining({ session_id: 'session-1' })
    )
  })

  it('loads the routed session history when switching between existing chats', async () => {
    apiMocks.getSessionMessages.mockImplementation(async (sessionId = '') => ({
      messages: [
        {
          id: sessionId === 'session-a' ? 101 : 202,
          role: 'user',
          content: sessionId === 'session-a' ? 'History from A' : 'History from B',
          timestamp: 1
        } as never
      ],
      session_id: sessionId
    }))

    await renderAt('/mobile/chat/session-a')
    expect(container.textContent).toContain('History from A')

    await act(async () => {
      const routeSwitch = container.querySelector('[data-testid="switch-to-session-b"]') as HTMLAnchorElement
      routeSwitch.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
      await Promise.resolve()
    })
    await waitForReact(() => expect(apiMocks.getSessionMessages).toHaveBeenCalledWith('session-b', ''))
    await waitForReact(() => expect(container.textContent).toContain('History from B'))

    expect(apiMocks.getSessionMessages).toHaveBeenCalledWith('session-b', '')
    expect(container.textContent).not.toContain('History from A')
  })

  it('copies, shares with fallback, and restores a user message for explicit retry', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    const share = vi.fn().mockRejectedValue(new Error('native share unavailable'))
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true })
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    Object.defineProperty(navigator, 'share', { configurable: true, value: share })
    apiMocks.getSessionMessages.mockResolvedValueOnce({
      messages: [{ id: 91, role: 'user', content: 'Retry this exact request', timestamp: 1 } as never],
      session_id: 'session-1'
    })
    await renderAt('/mobile/chat/session-1')

    const actions = container.querySelector('button[aria-label^="Actions for message: Retry this"]') as HTMLButtonElement
    await act(async () => actions.click())
    await act(async () => {
      ;(container.querySelector('button[aria-label="Copy message"]') as HTMLButtonElement).click()
      await Promise.resolve()
    })
    expect(writeText).toHaveBeenCalledWith('Retry this exact request')
    await act(async () => {
      ;(container.querySelector('button[aria-label="Share message"]') as HTMLButtonElement).click()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(share).toHaveBeenCalledWith({ text: 'Retry this exact request' })
    expect(writeText).toHaveBeenCalledTimes(2)
    await act(async () => {
      ;(container.querySelector('button[aria-label="Retry message in composer"]') as HTMLButtonElement).click()
    })
    expect((container.querySelector('textarea') as HTMLTextAreaElement).value).toBe('Retry this exact request')
    expect(gatewayMocks.request.mock.calls.filter(([method]) => method === 'prompt.submit')).toHaveLength(0)
  })

  it('stops an active response through the current runtime session', async () => {
    gatewayMocks.request.mockImplementation(async (method: string) => {
      if (method === 'session.resume') {
        return {
          inflight: { assistant: 'Still working', streaming: true, user: 'Long task' },
          running: true,
          session_id: 'runtime-live',
          status: 'working'
        }
      }
      return {}
    })
    await renderAt('/mobile/chat/session-1')
    const stop = container.querySelector('button[aria-label="Stop response"]') as HTMLButtonElement
    expect(stop).not.toBeNull()
    await act(async () => {
      stop.click()
      await Promise.resolve()
    })
    expect(gatewayMocks.request).toHaveBeenCalledWith('session.interrupt', { session_id: 'runtime-live' })
  })

  it('renders a camera capture input alongside the document picker', async () => {
    await renderAt('/mobile/chat/new')

    const camera = container.querySelector('input[aria-label="Take a photo"]') as HTMLInputElement
    expect(camera).not.toBeNull()
    expect(camera.accept).toBe('image/*')
    expect(camera.getAttribute('capture')).toBe('environment')
    expect(container.querySelector('button[aria-label="Take a photo"]')).not.toBeNull()
  })

  it('does not expose voice dictation when SpeechRecognition is unsupported', async () => {
    Object.defineProperty(window, 'SpeechRecognition', { configurable: true, value: undefined })
    Object.defineProperty(window, 'webkitSpeechRecognition', { configurable: true, value: undefined })
    await renderAt('/mobile/chat/new')

    expect(container.querySelector('button[aria-label="Start voice dictation"]')).toBeNull()
  })

  it('shows an image thumbnail and revokes its object URL when removed', async () => {
    const createObjectURL = vi.fn(() => 'blob:photo-preview')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL })
    await renderAt('/mobile/chat/new')

    const picker = container.querySelector('input[type="file"]') as HTMLInputElement
    const image = new File(['photo'], 'thumbnail.png', { type: 'image/png' })
    Object.defineProperty(picker, 'files', { configurable: true, value: [image] })
    await act(async () => picker.dispatchEvent(new Event('change', { bubbles: true })))

    expect(container.querySelector('img[alt="Preview thumbnail.png"]')?.getAttribute('src')).toBe('blob:photo-preview')
    await act(async () => (container.querySelector('button[aria-label="Remove thumbnail.png"]') as HTMLButtonElement).click())
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:photo-preview')
  })

  it('cannot submit to the previous runtime while switching sessions', async () => {
    let resumeSessionB: ((value: { session_id: string }) => void) | undefined
    gatewayMocks.request.mockImplementation((method: string, params: { session_id?: string }) => {
      if (method === 'session.resume' && params.session_id === 'session-a') {
        return Promise.resolve({ session_id: 'runtime-a' })
      }
      if (method === 'session.resume' && params.session_id === 'session-b') {
        return new Promise(resolve => {
          resumeSessionB = resolve
        })
      }
      return Promise.resolve({})
    })

    await renderAt('/mobile/chat/session-a')
    await act(async () => {
      const routeSwitch = container.querySelector('[data-testid="switch-to-session-b"]') as HTMLAnchorElement
      routeSwitch.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
      await Promise.resolve()
    })

    let textarea = container.querySelector('textarea') as HTMLTextAreaElement
    let form = container.querySelector('form') as HTMLFormElement
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
      valueSetter?.call(textarea, 'Must go to B')
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      await Promise.resolve()
    })

    expect(gatewayMocks.request.mock.calls.filter(([method]) => method === 'prompt.submit')).toHaveLength(0)

    await act(async () => {
      resumeSessionB?.({ session_id: 'runtime-b' })
      await Promise.resolve()
    })
    textarea = container.querySelector('textarea') as HTMLTextAreaElement
    form = container.querySelector('form') as HTMLFormElement
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
      valueSetter?.call(textarea, 'Must go to B')
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      await Promise.resolve()
    })

    await waitForReact(() => expect(gatewayMocks.request).toHaveBeenCalledWith(
      'prompt.submit',
      expect.objectContaining({ session_id: 'runtime-b', text: 'Must go to B' })
    ))
  })
})
