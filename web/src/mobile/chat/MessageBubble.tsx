import { MoreHorizontal } from 'lucide-react'

import { Markdown } from '@/components/Markdown'
import type { MobileChatMessage } from '../mobile-chat-state'

export function MessageBubble({ message, onActions }: { message: MobileChatMessage; onActions: () => void }) {
  return (
    <article className={`mobile-bubble is-${message.role}${message.queued ? ' is-queued' : ''}`}>
      <button aria-label={`Actions for message: ${message.content.slice(0, 40)}`} className="mobile-message-actions" onClick={onActions} type="button">
        <MoreHorizontal />
      </button>
      {message.queued && <span className="mobile-queued-label">Queued</span>}
      {message.role === 'assistant' ? (
        <Markdown content={message.content} streaming={message.streaming} />
      ) : (
        <p>{message.content}</p>
      )}
    </article>
  )
}
