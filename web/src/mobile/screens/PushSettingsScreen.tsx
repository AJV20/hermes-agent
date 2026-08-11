import { Bell, ShieldCheck } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'

import { api, type MobilePushSubscriptionRequest } from '@/lib/api'
import { getMobilePushSupport } from '@/pwa'
import {
  disableMobilePush,
  enableMobilePush,
  getMobilePushDeviceId,
  PUSH_CATEGORIES,
  refreshMobilePush
} from '../push'
import { AppHeader } from '../ui/primitives'

const DEFAULT_CATEGORIES: MobilePushSubscriptionRequest['categories'] = ['error', 'warning']

export function PushSettingsScreen({ profile }: { profile: string }) {
  const navigate = useNavigate()
  const [serverEnabled, setServerEnabled] = useState(false)
  const [deviceEnabled, setDeviceEnabled] = useState(false)
  const [loadedProfile, setLoadedProfile] = useState<string | null>(null)
  const [publicKey, setPublicKey] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [categories, setCategories] = useState<MobilePushSubscriptionRequest['categories']>(DEFAULT_CATEGORIES)
  const support = getMobilePushSupport()

  useEffect(() => {
    let cancelled = false
    const currentDeviceId = getMobilePushDeviceId()
    void Promise.all([
      api.getMobilePushCapability(profile),
      api.getMobilePushSubscription(currentDeviceId, profile)
    ]).then(([capability, subscriptionState]) => {
      if (cancelled) return
      const current = subscriptionState.subscription
      setServerEnabled(capability.enabled)
      setPublicKey(capability.public_key)
      setDeviceEnabled(Boolean(current))
      setCategories(current?.categories.length ? current.categories : DEFAULT_CATEGORIES)
      setLoadedProfile(profile)
    }, () => {
      if (cancelled) return
      setMessage('Could not verify Web Push on this Hermes server.')
      setLoadedProfile(profile)
    })
    return () => { cancelled = true }
  }, [profile])

  const loaded = loadedProfile === profile
  const effectiveServerEnabled = loaded && serverEnabled
  const effectiveDeviceEnabled = loaded && deviceEnabled

  useEffect(() => {
    if (!loaded || !effectiveDeviceEnabled || support !== 'ready') return
    void refreshMobilePush(profile, categories).catch(() => {
      setMessage('Could not update notification categories for this device.')
    })
  }, [categories, effectiveDeviceEnabled, loaded, profile, support])

  const guidance = support === 'denied'
    ? 'Notifications are blocked. Change this site’s notification permission in browser settings, then reload.'
    : support === 'unsupported'
      ? 'This browser does not support Web Push. Use a current supported browser.'
      : support === 'insecure'
        ? 'Web Push requires HTTPS (or localhost). Open Hermes through its secure URL.'
        : support === 'ios-install'
          ? 'On iPhone or iPad, use Share → Add to Home Screen, then open the installed Hermes app.'
          : null

  async function enablePush() {
    if (!publicKey) return
    setBusy(true)
    setMessage(null)
    try {
      await enableMobilePush(profile, publicKey, categories)
      setDeviceEnabled(true)
      setMessage('Notifications are enabled for this device.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not enable notifications.')
    } finally {
      setBusy(false)
    }
  }

  async function disablePush() {
    setBusy(true)
    setMessage(null)
    try {
      await disableMobilePush(profile)
      setDeviceEnabled(false)
      setMessage('Notifications are disabled for this device.')
    } catch {
      setMessage('Could not disable notifications. You can also remove this site’s permission in browser settings.')
    } finally {
      setBusy(false)
    }
  }

  const controlsDisabled = busy || !loaded || Boolean(guidance) || !effectiveServerEnabled
  return <>
    <AppHeader back={() => navigate('/mobile/more')} detail="This device" title="Push notifications" />
    <main className="mobile-screen">
      <div className="mobile-page-heading"><div><p className="mobile-eyebrow">Private alerts</p><h1>Push notifications</h1></div></div>
      <section className="mobile-notification-privacy">
        <ShieldCheck />
        <span><strong>Privacy preview</strong><small>Lock-screen alerts only say “Open Hermes to view this notification.” Content is fetched after authenticated app access.</small></span>
      </section>
      <section className="mobile-empty-card">
        <Bell />
        <strong>Device verification</strong>
        <small>{effectiveDeviceEnabled
          ? 'Notifications are enabled on this device.'
          : effectiveServerEnabled
            ? 'This server is configured. Enable only on a device you control.'
            : 'Web Push is not configured on this Hermes server.'}</small>
      </section>
      {guidance && <div className="mobile-inline-error" role="alert">{guidance}</div>}
      <fieldset disabled={controlsDisabled}>
        <legend>Alert categories</legend>
        {PUSH_CATEGORIES.map(category => <label key={category}>
          <input
            checked={categories.includes(category)}
            onChange={() => setCategories(current => current.includes(category)
              ? current.filter(value => value !== category)
              : [...current, category] as MobilePushSubscriptionRequest['categories'])}
            type="checkbox"
          /> {category}
        </label>)}
      </fieldset>
      {loaded && message && <div className="mobile-empty-card" role="status">{message}</div>}
      <div className="mobile-more-list">
        <button aria-label="Enable push notifications" disabled={controlsDisabled} onClick={() => void enablePush()} type="button">
          <Bell /><strong>Enable on this device</strong>
        </button>
        <button aria-label="Disable push notifications" disabled={busy || !loaded || support !== 'ready' || !effectiveDeviceEnabled} onClick={() => void disablePush()} type="button">
          <strong>Disable on this device</strong>
        </button>
      </div>
    </main>
  </>
}
