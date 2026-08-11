export const MOBILE_CARD_IDS = ['notifications', 'connection', 'tasks', 'continue'] as const

export type MobileCardId = typeof MOBILE_CARD_IDS[number]
export type MobileTextSize = 'normal' | 'large'
export type MobileDensity = 'comfortable' | 'compact'

export interface MobilePreferences {
  cardOrder: MobileCardId[]
  density: MobileDensity
  hiddenCards: MobileCardId[]
  textSize: MobileTextSize
}

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export const DEFAULT_MOBILE_PREFERENCES: MobilePreferences = {
  cardOrder: [...MOBILE_CARD_IDS],
  density: 'comfortable',
  hiddenCards: [],
  textSize: 'normal'
}

function keyForProfile(profile: string) {
  return `hermes.mobile.preferences.v1:${profile || 'default'}`
}

function isCardOrder(value: unknown): value is MobileCardId[] {
  return Array.isArray(value) && value.length === MOBILE_CARD_IDS.length &&
    value.every(item => typeof item === 'string' && MOBILE_CARD_IDS.includes(item as MobileCardId)) &&
    new Set(value).size === MOBILE_CARD_IDS.length
}

function isHiddenCards(value: unknown): value is MobileCardId[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string' && MOBILE_CARD_IDS.includes(item as MobileCardId)) && new Set(value).size === value.length
}

function isPreferences(value: unknown): value is MobilePreferences {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<MobilePreferences>
  return isCardOrder(candidate.cardOrder) && isHiddenCards(candidate.hiddenCards) &&
    (candidate.textSize === 'normal' || candidate.textSize === 'large') &&
    (candidate.density === 'comfortable' || candidate.density === 'compact')
}

function browserStorage(): StorageLike | null {
  return typeof window === 'undefined' ? null : window.localStorage
}

export function loadMobilePreferences(profile: string, storage = browserStorage()): MobilePreferences {
  if (!storage) return DEFAULT_MOBILE_PREFERENCES
  try {
    const value: unknown = JSON.parse(storage.getItem(keyForProfile(profile)) ?? 'null')
    return isPreferences(value) ? value : DEFAULT_MOBILE_PREFERENCES
  } catch {
    return DEFAULT_MOBILE_PREFERENCES
  }
}

export function saveMobilePreferences(profile: string, preferences: MobilePreferences, storage = browserStorage()) {
  if (!storage || !isPreferences(preferences)) return
  storage.setItem(keyForProfile(profile), JSON.stringify(preferences))
}
