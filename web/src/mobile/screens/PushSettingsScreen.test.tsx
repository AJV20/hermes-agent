// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const apiMocks = vi.hoisted(() => ({
  getMobilePushCapability: vi.fn(),
  getMobilePushSubscription: vi.fn()
}))
const pushMocks = vi.hoisted(() => ({
  disableMobilePush: vi.fn(),
  enableMobilePush: vi.fn(),
  getMobilePushDeviceId: vi.fn(() => 'device-opaque-123'),
  refreshMobilePush: vi.fn()
}))
const pwaMocks = vi.hoisted(() => ({ getMobilePushSupport: vi.fn(() => 'ready') }))

vi.mock('@/lib/api', () => ({ api: apiMocks }))
vi.mock('@/pwa', () => ({ getMobilePushSupport: pwaMocks.getMobilePushSupport }))
vi.mock('../push', () => ({
  ...pushMocks,
  PUSH_CATEGORIES: ['info', 'success', 'warning', 'error']
}))

import { PushSettingsScreen } from './PushSettingsScreen'

let container: HTMLDivElement
let root: Root

async function render(profile: string) {
  await act(async () => {
    root.render(<MemoryRouter><PushSettingsScreen profile={profile} /></MemoryRouter>)
  })
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  apiMocks.getMobilePushCapability.mockReset().mockResolvedValue({ enabled: true, public_key: 'B'.repeat(87), preview: false })
  apiMocks.getMobilePushSubscription.mockReset().mockResolvedValue({ subscription: null })
  pushMocks.refreshMobilePush.mockReset().mockResolvedValue(true)
  pushMocks.enableMobilePush.mockReset().mockResolvedValue(undefined)
  pushMocks.disableMobilePush.mockReset().mockResolvedValue(undefined)
  pwaMocks.getMobilePushSupport.mockReset().mockReturnValue('ready')
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

describe('PushSettingsScreen', () => {
  it('hydrates this device’s saved categories before refreshing its subscription', async () => {
    apiMocks.getMobilePushSubscription.mockResolvedValue({
      subscription: { categories: ['error', 'success'], device_id: 'device-opaque-123' }
    })

    await render('mabel')
    await act(async () => { await vi.waitFor(() => expect(pushMocks.refreshMobilePush).toHaveBeenCalled()) })

    expect(pushMocks.refreshMobilePush).toHaveBeenLastCalledWith('mabel', ['error', 'success'])
    const checkboxes = [...container.querySelectorAll('input[type="checkbox"]')] as HTMLInputElement[]
    expect(container.textContent).toContain('Notifications are enabled on this device')
    expect(checkboxes).toHaveLength(4)
    expect(checkboxes[1].checked).toBe(true)
    expect(checkboxes[2].checked).toBe(false)
    expect(checkboxes[3].checked).toBe(true)
  })

  it('ignores a stale capability response from the previous profile', async () => {
    let resolveOld!: (value: unknown) => void
    const old = new Promise(resolve => { resolveOld = resolve })
    apiMocks.getMobilePushCapability.mockImplementation((profile: string) => (
      profile === 'old' ? old : Promise.resolve({ enabled: false, public_key: null, preview: false })
    ))

    await render('old')
    await render('new')
    await act(async () => { resolveOld({ enabled: true, public_key: 'B'.repeat(87), preview: false }); await old })

    expect(container.textContent).toContain('Web Push is not configured on this Hermes server')
  })

  it('explains the installed-iOS requirement without enabling the permission action', async () => {
    pwaMocks.getMobilePushSupport.mockReturnValue('ios-install')

    await render('mabel')

    expect(container.textContent).toContain('Add to Home Screen')
    expect((container.querySelector('button[aria-label="Enable push notifications"]') as HTMLButtonElement).disabled).toBe(true)
  })
})
