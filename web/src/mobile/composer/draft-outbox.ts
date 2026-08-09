export function draftStorageKey(profile: string, storedSessionId: string): string {
  return `hermes.mobile.draft:${profile || 'default'}:${storedSessionId}`
}

export function loadDraft(profile: string, storedSessionId: string): string {
  try {
    return window.localStorage.getItem(draftStorageKey(profile, storedSessionId)) || ''
  } catch {
    return ''
  }
}

export function saveDraft(profile: string, storedSessionId: string, value: string) {
  try {
    const key = draftStorageKey(profile, storedSessionId)
    if (value) window.localStorage.setItem(key, value)
    else window.localStorage.removeItem(key)
  } catch {
    // Draft persistence is best-effort in restricted browser contexts.
  }
}

export function outboxStorageKey(profile: string, storedSessionId: string): string {
  return `hermes.mobile.outbox:${profile || 'default'}:${storedSessionId}`
}

export function loadOutbox(profile: string, storedSessionId: string): string {
  try {
    return window.localStorage.getItem(outboxStorageKey(profile, storedSessionId)) || ''
  } catch {
    return ''
  }
}

export function saveOutbox(profile: string, storedSessionId: string, value: string) {
  try {
    const key = outboxStorageKey(profile, storedSessionId)
    if (value) window.localStorage.setItem(key, value)
    else window.localStorage.removeItem(key)
  } catch {
    // The in-memory outbox still works when storage is unavailable.
  }
}
