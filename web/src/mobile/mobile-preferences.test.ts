import { describe, expect, it } from 'vitest'

import {
  DEFAULT_MOBILE_PREFERENCES,
  loadMobilePreferences,
  saveMobilePreferences
} from './mobile-preferences'

describe('mobile preferences', () => {
  it('stores validated preferences separately for each profile', () => {
    const storage = new Map<string, string>()
    const localStorage = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => void storage.set(key, value)
    }

    saveMobilePreferences('mabel', {
      cardOrder: ['tasks', 'notifications', 'connection', 'continue'],
      hiddenCards: ['connection'],
      textSize: 'large',
      density: 'compact'
    }, localStorage)

    expect(loadMobilePreferences('mabel', localStorage)).toEqual({
      cardOrder: ['tasks', 'notifications', 'connection', 'continue'],
      hiddenCards: ['connection'],
      textSize: 'large',
      density: 'compact'
    })
    expect(loadMobilePreferences('default', localStorage)).toEqual(DEFAULT_MOBILE_PREFERENCES)
  })

  it('falls back to safe defaults for malformed or invalid persisted values', () => {
    const localStorage = {
      getItem: () => JSON.stringify({
        cardOrder: ['tasks', 'tasks', 'made-up'],
        hiddenCards: ['made-up'],
        textSize: 'giant',
        density: 'dense'
      }),
      setItem: () => undefined
    }

    expect(loadMobilePreferences('default', localStorage)).toEqual(DEFAULT_MOBILE_PREFERENCES)
  })
})
