import { Copy, RotateCcw, Share2 } from 'lucide-react'
import { useCallback, useState } from 'react'

import { copyTextToClipboard } from '@/lib/clipboard'
import { shareMessageText } from './message-actions'
import type { MobileChatMessage } from '../mobile-chat-state'
import { MobileSheet } from '../ui/sheets'

export function MessageActionSheet({
  message,
  onClose,
  onRetry
}: {
  message: MobileChatMessage
  onClose: () => void
  onRetry: (text: string) => void
}) {
  const [notice, setNotice] = useState<string | null>(null)
  const copy = useCallback(async () => {
    setNotice(await copyTextToClipboard(message.content) ? 'Copied' : 'Could not copy')
  }, [message.content])
  const share = useCallback(async () => {
    const result = await shareMessageText(message.content)
    if (result === 'copied') setNotice('Copied instead')
    else if (result === 'unavailable') setNotice('Could not share')
  }, [message.content])
  return (
    <MobileSheet ariaLabel="Message actions" className="mobile-message-action-sheet" onClose={onClose}>
        <div className="mobile-sheet-handle" />
        <h2>Message</h2>
        <button aria-label="Copy message" onClick={() => void copy()} type="button"><Copy /> Copy</button>
        <button aria-label="Share message" onClick={() => void share()} type="button"><Share2 /> Share</button>
        {message.role === 'user' && (
          <button aria-label="Retry message in composer" onClick={() => onRetry(message.content)} type="button"><RotateCcw /> Retry in composer</button>
        )}
        {notice && <p className="mobile-action-notice" role="status">{notice}</p>}
        <button className="mobile-sheet-cancel" onClick={onClose} type="button">Cancel</button>
    </MobileSheet>
  )
}
