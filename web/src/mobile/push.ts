import { api, type MobilePushSubscriptionRequest } from '@/lib/api'

const DEVICE_ID_KEY = 'hermes-mobile-push-device-id'
export const PUSH_CATEGORIES = ['info', 'success', 'warning', 'error'] as const
let fallbackDeviceId: string | null = null

export function getMobilePushDeviceId(): string {
  let value: string | null = null
  try {
    value = localStorage.getItem(DEVICE_ID_KEY)
  } catch {
    // Private/blocked storage must not make device management unusable.
  }
  if (!value) {
    value = fallbackDeviceId ?? crypto.randomUUID().replace(/-/g, '')
    fallbackDeviceId = value
    try {
      localStorage.setItem(DEVICE_ID_KEY, value)
    } catch {
      // Keep the opaque id for this page lifetime only.
    }
  }
  return value
}

function base64UrlBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const bytes = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='))
  return Uint8Array.from(bytes, character => character.charCodeAt(0))
}

function serialize(subscription: PushSubscription, categories: MobilePushSubscriptionRequest['categories']): MobilePushSubscriptionRequest {
  const raw = subscription.toJSON()
  if (!raw.endpoint || !raw.keys?.p256dh || !raw.keys.auth) throw new Error('Browser returned an invalid push subscription.')
  return { device_id: getMobilePushDeviceId(), endpoint: raw.endpoint, keys: { p256dh: raw.keys.p256dh, auth: raw.keys.auth }, categories }
}

export async function enableMobilePush(profile: string, publicKey: string, categories: MobilePushSubscriptionRequest['categories']): Promise<void> {
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('Notifications are blocked in this browser. Change the site permission and try again.')
  const registration = await navigator.serviceWorker.ready
  let subscription = await registration.pushManager.getSubscription()
  if (!subscription) subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlBytes(publicKey).buffer as ArrayBuffer })
  await api.putMobilePushSubscription(serialize(subscription, categories), profile)
}

export async function refreshMobilePush(profile: string, categories: MobilePushSubscriptionRequest['categories']): Promise<boolean> {
  if (Notification.permission !== 'granted' || !('serviceWorker' in navigator)) return false
  const subscription = await (await navigator.serviceWorker.ready).pushManager.getSubscription()
  if (!subscription) return false
  await api.putMobilePushSubscription(serialize(subscription, categories), profile)
  return true
}

export async function disableMobilePush(profile: string): Promise<void> {
  const registration = await navigator.serviceWorker.ready
  const subscription = await registration.pushManager.getSubscription()
  await api.deleteMobilePushSubscription(getMobilePushDeviceId(), profile)
  if (subscription) await subscription.unsubscribe()
}
