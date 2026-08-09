import type { GatewayEvent } from '@/lib/gatewayClient'
import type { SessionMessage } from '@/lib/api'

export interface MobileChatMessage {
  content: string
  id: string
  queued?: boolean
  role: 'assistant' | 'user'
  streaming?: boolean
}

export interface MobileToolActivity {
  id: string
  name: string
  status: 'complete' | 'running'
}

export interface MobileChatState {
  busy: boolean
  error: string | null
  messages: MobileChatMessage[]
  tools: MobileToolActivity[]
}

export interface MobileResumeSnapshot {
  inflight?: {
    assistant?: string
    corrections?: string[]
    error?: string
    recoverable?: boolean
    status?: string
    streaming?: boolean
    user?: string
  } | null
  queued?: { user?: string } | null
  running?: boolean
  status?: string
  session_id: string
}

function text(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return ''
  const value = (payload as { text?: unknown }).text
  return typeof value === 'string' ? value : ''
}

function identity(payload: unknown): { id: string; name: string } {
  if (!payload || typeof payload !== 'object') {
    return { id: 'tool', name: 'Tool' }
  }
  const record = payload as Record<string, unknown>
  const name = String(record.name ?? record.tool_name ?? 'Tool')
  return { id: String(record.id ?? record.tool_call_id ?? name), name }
}

function activeAssistantIndex(messages: MobileChatMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'assistant' && messages[index]?.streaming) {
      return index
    }
  }
  return -1
}

export function projectSessionMessages(messages: SessionMessage[]): MobileChatMessage[] {
  return messages.flatMap((message, index) => {
    if (message.role !== 'user' && message.role !== 'assistant') return []
    const content = typeof message.content === 'string' ? message.content : ''
    if (!content.trim()) return []
    return [
      {
        content,
        id: typeof message.id === 'number' ? `db-${message.id}` : `stored-${index}-${message.timestamp ?? 0}`,
        role: message.role,
        streaming: false
      }
    ]
  })
}

export function hydrateMobileResume(
  state: MobileChatState,
  snapshot: MobileResumeSnapshot
): MobileChatState {
  const hasLiveSnapshot = Boolean(snapshot.inflight || snapshot.queued)
  const messages = hasLiveSnapshot
    ? state.messages.filter(message => !message.id.startsWith('resume-'))
    : [...state.messages]
  const append = (
    role: MobileChatMessage['role'],
    content: string | undefined,
    id: string,
    streaming = false,
    queued = false
  ) => {
    const value = typeof content === 'string' ? content : ''
    if (!value.trim() && !streaming) return
    const last = messages.at(-1)
    if (last?.role === role && last.content === value) {
      if ((streaming && !last.streaming) || (queued && !last.queued)) {
        messages[messages.length - 1] = { ...last, queued: queued || last.queued, streaming: streaming || last.streaming }
      }
      return
    }
    messages.push({ content: value, id, queued, role, streaming })
  }

  const inflight = snapshot.inflight
  if (inflight) {
    append('user', inflight.user, 'resume-inflight-user')
    for (const [index, correction] of (inflight.corrections ?? []).entries()) {
      append('user', correction, `resume-correction-${index}`)
    }
    append(
      'assistant',
      inflight.assistant,
      'resume-inflight-assistant',
      Boolean(inflight.streaming && !inflight.error)
    )
  }
  append('user', snapshot.queued?.user, 'resume-queued-user', false, true)

  const busyStatus = snapshot.status === 'starting'
    || snapshot.status === 'working'
    || snapshot.status === 'waiting'

  return {
    ...state,
    busy: Boolean(snapshot.running || inflight?.streaming || busyStatus),
    error: inflight?.error || state.error,
    messages
  }
}

export function applyMobileGatewayEvent(
  state: MobileChatState,
  event: Pick<GatewayEvent, 'payload' | 'type'>
): MobileChatState {
  if (event.type === 'message.start') {
    if (activeAssistantIndex(state.messages) >= 0) {
      return { ...state, busy: true, error: null, tools: [] }
    }
    return {
      ...state,
      busy: true,
      error: null,
      messages: [
        ...state.messages,
        {
          content: '',
          id: `live-${state.messages.length}`,
          role: 'assistant',
          streaming: true
        }
      ],
      tools: []
    }
  }

  if (event.type === 'message.delta' || event.type === 'message.interim') {
    const delta = text(event.payload)
    const index = activeAssistantIndex(state.messages)
    if (index < 0 || !delta) return state
    const messages = [...state.messages]
    const current = messages[index]
    if (!current) return state
    messages[index] = { ...current, content: `${current.content}${delta}` }
    return { ...state, messages }
  }

  if (event.type === 'message.complete') {
    const finalText = text(event.payload)
    const index = activeAssistantIndex(state.messages)
    if (index < 0) return { ...state, busy: false }
    const messages = [...state.messages]
    const current = messages[index]
    if (!current) return { ...state, busy: false }
    messages[index] = {
      ...current,
      content: finalText || current.content,
      streaming: false
    }
    return { ...state, busy: false, messages }
  }

  if (event.type === 'tool.start' || event.type === 'tool.complete') {
    const tool = identity(event.payload)
    const status = event.type === 'tool.complete' ? 'complete' : 'running'
    const currentIndex = state.tools.findIndex(item => item.id === tool.id)
    const tools = [...state.tools]
    const next = { ...tool, status } satisfies MobileToolActivity
    if (currentIndex >= 0) tools[currentIndex] = next
    else tools.push(next)
    return { ...state, tools }
  }

  if (event.type === 'error') {
    const message =
      event.payload && typeof event.payload === 'object'
        ? String((event.payload as { message?: unknown }).message ?? 'Hermes encountered an error')
        : 'Hermes encountered an error'
    return { ...state, busy: false, error: message }
  }

  return state
}
