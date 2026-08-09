// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Link, MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const apiMocks = vi.hoisted(() => ({
  deleteSession: vi.fn(async () => ({ ok: true })),
  getCronJobs: vi.fn(async () => [
    { id: 'daily', enabled: true, name: 'Morning briefing', next_run_at: '2026-08-09T11:00:00Z' }
  ]),
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

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  apiMocks.deleteSession.mockReset().mockResolvedValue({ ok: true })
  apiMocks.getCronJobs.mockReset().mockResolvedValue([
    { id: 'daily', enabled: true, name: 'Morning briefing', next_run_at: '2026-08-09T11:00:00Z' }
  ])
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
    expect(container.querySelector('button[aria-label="Reload Hermes Mobile update"]')).not.toBeNull()
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

    await vi.waitFor(() => {
      expect(apiMocks.getSessions).toHaveBeenLastCalledWith(30, 0, { archived: true, order: 'recent', profile: '' })
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
      await vi.waitFor(() => {
        expect(gatewayMocks.request.mock.calls.some(([method]) => method === 'prompt.submit')).toBe(true)
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
      await vi.waitFor(() => {
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
      await vi.waitFor(() => {
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
      await vi.waitFor(() => expect(gatewayMocks.request.mock.calls.some(([method]) => method === 'file.attach')).toBe(true))
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

    expect(container.textContent).toContain('first.txt')
    expect(container.textContent).toContain('second.txt')
    expect(container.textContent).toContain('upload failed')
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
    expect(container.textContent).toContain('Queued until Hermes reconnects')
    expect(gatewayMocks.request).not.toHaveBeenCalledWith('prompt.submit', expect.anything())

    await act(async () => {
      finishConnect()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(gatewayMocks.request).not.toHaveBeenCalledWith('prompt.submit', expect.anything())
    const reviewQueued = container.querySelector('button[aria-label="Review queued message"]') as HTMLButtonElement
    expect(reviewQueued).not.toBeNull()
    await act(async () => reviewQueued.click())
    expect(textarea.value).toBe('Queue this safely')
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      await Promise.resolve()
    })
    expect(gatewayMocks.request).toHaveBeenCalledWith(
      'prompt.submit',
      expect.objectContaining({ text: 'Queue this safely' })
    )
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

  it('restores the typed prompt when sending fails', async () => {
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

    expect(textarea.value).toBe('Do not lose this prompt')
    expect(container.textContent).toContain('Connection lost')
    expect(container.querySelectorAll('.mobile-bubble.is-user')).toHaveLength(0)
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

    expect(gatewayMocks.request.mock.calls.filter(([method]) => method === 'session.create')).toHaveLength(1)
    expect(gatewayMocks.request.mock.calls.filter(([method]) => method === 'prompt.submit')).toHaveLength(1)

    releasePrompt()
    await act(async () => pendingPrompt)
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

    expect(gatewayMocks.request).toHaveBeenCalledWith('session.create', expect.objectContaining({ profile: 'mabel' }))
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

    await vi.waitFor(() => {
      expect(container.querySelector('button[aria-label="Go back"]')).not.toBeNull()
    })
    await act(async () => {
      const back = container.querySelector('button[aria-label="Go back"]') as HTMLButtonElement
      back.click()
      await Promise.resolve()
    })
    await vi.waitFor(() => expect(container.textContent).toContain('Fresh mobile chat'))
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
    await vi.waitFor(() => expect(apiMocks.getSessionMessages).toHaveBeenCalledWith('session-b', ''))
    await vi.waitFor(() => expect(container.textContent).toContain('History from B'))

    expect(apiMocks.getSessionMessages).toHaveBeenCalledWith('session-b', '')
    expect(container.textContent).not.toContain('History from A')
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

    expect(gatewayMocks.request).toHaveBeenCalledWith(
      'prompt.submit',
      expect.objectContaining({ session_id: 'runtime-b', text: 'Must go to B' })
    )
  })
})
