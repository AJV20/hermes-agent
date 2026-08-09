// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Link, MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const apiMocks = vi.hoisted(() => ({
  getCronJobs: vi.fn(async () => [
    { id: 'daily', enabled: true, name: 'Morning briefing', next_run_at: '2026-08-09T11:00:00Z' }
  ]),
  getSessionMessages: vi.fn(async (): Promise<{
    messages: never[]
    pagination?: { limit: number; offset: number; order: 'latest' | 'oldest'; returned: number }
    session_id: string
  }> => ({ messages: [], session_id: 'session-1' })),
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
  }))
}))

const gatewayMocks = vi.hoisted(() => ({
  connect: vi.fn(),
  eventHandler: null as ((event: { payload?: unknown; session_id?: string; type: string }) => void) | null,
  request: vi.fn(),
  stateHandler: null as ((state: string) => void) | null
}))
const profileMocks = vi.hoisted(() => ({ currentProfile: 'default', profile: '' }))

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
  gatewayMocks.request.mockImplementation(async (method: string) => {
    if (method === 'session.create') {
      return { session_id: 'runtime-1', stored_session_id: 'stored-1' }
    }
    if (method === 'session.resume') return { session_id: 'runtime-resumed' }
    return {}
  })
  gatewayMocks.connect.mockResolvedValue(undefined)
  gatewayMocks.eventHandler = null
  gatewayMocks.stateHandler = null
  profileMocks.profile = ''
  profileMocks.currentProfile = 'default'
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

    const names = Array.from(container.querySelectorAll('.mobile-task-card strong')).map(node => node.textContent)
    const schedule = container.querySelector('.mobile-task-card small')?.textContent ?? ''
    expect(names).toEqual(['Soon task', 'Later task', 'Paused task'])
    expect(schedule).not.toContain('2026-08-10T09:00:00-04:00')
    expect(schedule).toMatch(/Aug|Today|Tomorrow/)
  })

  it('keeps a new-chat composer disabled until the gateway connection is ready', async () => {
    let finishConnect!: () => void
    gatewayMocks.connect.mockReturnValueOnce(new Promise<void>(resolve => {
      finishConnect = resolve
    }))
    await renderAt('/mobile/chat/new')

    const textarea = container.querySelector('textarea') as HTMLTextAreaElement
    expect(textarea.disabled).toBe(true)
    expect(textarea.placeholder).toBe('Connecting to Hermes…')

    await act(async () => {
      finishConnect()
      await Promise.resolve()
    })
    expect(textarea.disabled).toBe(false)
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

  it('disables sending after the gateway closes without losing the draft', async () => {
    await renderAt('/mobile/chat/new')
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
      valueSetter?.call(textarea, 'Keep this while reconnecting')
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
      gatewayMocks.stateHandler?.('closed')
    })

    expect(textarea.disabled).toBe(true)
    expect(textarea.value).toBe('Keep this while reconnecting')
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
      expect(textarea.disabled).toBe(true)

      await act(async () => {
        await vi.advanceTimersByTimeAsync(500)
      })
      expect(gatewayMocks.connect).toHaveBeenCalledTimes(2)
      expect(textarea.disabled).toBe(true)

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000)
      })
      expect(gatewayMocks.connect).toHaveBeenCalledTimes(3)
      expect(textarea.disabled).toBe(false)
      expect(textarea.value).toBe('Send after reconnect')
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
