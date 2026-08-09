import { copyTextToClipboard } from '@/lib/clipboard'

export type ShareResult = 'copied' | 'dismissed' | 'shared' | 'unavailable'

export interface ShareDependencies {
  copy?: (text: string) => Promise<boolean>
  share?: (data: ShareData) => Promise<void>
}

function isShareDismissal(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

export async function shareMessageText(text: string, dependencies: ShareDependencies = {}): Promise<ShareResult> {
  const share = dependencies.share ?? (typeof navigator === 'undefined' ? undefined : navigator.share?.bind(navigator))
  const copy = dependencies.copy ?? copyTextToClipboard
  if (share) {
    try {
      await share({ text })
      return 'shared'
    } catch (error) {
      if (isShareDismissal(error)) return 'dismissed'
    }
  }
  return await copy(text) ? 'copied' : 'unavailable'
}
