// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const apiMocks = vi.hoisted(() => ({
  deleteMobilePushSubscription: vi.fn(),
  putMobilePushSubscription: vi.fn()
}))

vi.mock('@/lib/api', () => ({ api: apiMocks }))

import { disableMobilePush, enableMobilePush } from './push'

function installPushBrowser(subscription: PushSubscription | null) {
  const pushManager = {
    getSubscription: vi.fn(async () => subscription),
    subscribe: vi.fn(async () => subscription)
  }
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { ready: Promise.resolve({ pushManager }) }
  })
  return pushManager
}

beforeEach(() => {
  apiMocks.deleteMobilePushSubscription.mockReset().mockResolvedValue({ ok: true })
  apiMocks.putMobilePushSubscription.mockReset().mockResolvedValue({ ok: true })
  Object.defineProperty(globalThis, 'Notification', {
    configurable: true,
    value: { permission: 'granted', requestPermission: vi.fn(async () => 'granted') }
  })
  vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('12345678-1234-1234-1234-123456789abc')
  localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('mobile push browser subscription', () => {
  it('uses an in-memory device id when browser storage is blocked', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('blocked') })
    const subscription = {
      toJSON: () => ({
        endpoint: 'https://push.example.test/a',
        keys: { p256dh: 'A'.repeat(87), auth: 'B'.repeat(22) }
      })
    } as unknown as PushSubscription
    installPushBrowser(subscription)

    await enableMobilePush('mabel', 'C'.repeat(87), ['error'])

    expect(apiMocks.putMobilePushSubscription).toHaveBeenCalledWith(
      expect.objectContaining({ device_id: '12345678123412341234123456789abc' }),
      'mabel'
    )
  })

  it('removes the server record before unsubscribing the browser endpoint', async () => {
    const order: string[] = []
    apiMocks.deleteMobilePushSubscription.mockImplementation(async () => { order.push('server') })
    localStorage.setItem('hermes-mobile-push-device-id', 'device-opaque-123')
    const subscription = {
      unsubscribe: vi.fn(async () => { order.push('browser'); return true })
    } as unknown as PushSubscription
    installPushBrowser(subscription)

    await disableMobilePush('mabel')

    expect(order).toEqual(['server', 'browser'])
  })
})
