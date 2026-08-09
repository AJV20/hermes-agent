// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Link, MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const apiMocks = vi.hoisted(() => ({
  getCronJobs: vi.fn(async () => [
    { id: 'daily', enabled: true, name: 'Morning briefing', next_run_at: '2026-08-09T11:00:00Z' }
  ]),
  getSessionMessages: vi.fn(async () => ({ messages: [], session_id: 'session-1' })),
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

const gatewayMocks = vi.hoisted(() => ({ request: vi.fn() }))
const profileMocks = vi.hoisted(() => ({ profile: '' }))

vi.mock('@/lib/api', () => ({ api: apiMocks }))
vi.mock('@/contexts/useProfileScope', () => ({
  useProfileScope: () => ({ profile: profileMocks.profile })
}))
vi.mock('@/lib/gatewayClient', () => ({
  GatewayClient: class {
    close() {}
    connect() {
      return Promise.resolve()
    }
    onAny() {
      return () => {}
    }
    onState() {
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
  profileMocks.profile = ''
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.clearAllMocks()
})

async function renderAt(path: string) {
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[path]}>
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
    expect(container.textContent).toContain('Good evening.')
    expect(container.textContent).not.toContain('Abdiel')
    expect(container.textContent).toContain('Connected')
    expect(container.textContent).toContain('New chat')
    expect(container.textContent).toContain('Hermes mobile PWA')
    expect(container.textContent).toContain('Morning briefing')
  })

  it('exposes the approved four-tab mobile navigation', async () => {
    await renderAt('/mobile')

    const labels = Array.from(container.querySelectorAll('nav a')).map(node => node.textContent?.trim())
    expect(labels).toEqual(['Home', 'Chats', 'Tasks', 'More'])
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
      expect.objectContaining({ profile: 'mabel', session_id: 'session-1' })
    )
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
