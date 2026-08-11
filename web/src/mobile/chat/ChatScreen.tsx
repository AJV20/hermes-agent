import { ArrowDown, Camera, CheckCircle2, Clock3, FileUp, Mic, Plus, Send, Square, X } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'

import { api } from '@/lib/api'
import { GatewayClient, type GatewayEvent } from '@/lib/gatewayClient'
import {
  applyMobileGatewayEvent,
  hydrateMobileResume,
  projectSessionMessages,
  type MobileChatMessage,
  type MobileChatState,
  type MobileResumeSnapshot
} from '../mobile-chat-state'
import {
  applyMobileActionEvent,
  EMPTY_MOBILE_ACTIONS,
  hydrateMobileActionResume,
  type MobileActionState
} from '../mobile-action-state'
import { ChatActionCard } from './ChatActionCard'
import { MessageBubble } from './MessageBubble'
import { MessageActionSheet } from './MessageActionSheet'
import { IconButton, AppHeader } from '../ui/primitives'
import { loadDraft, loadOutbox, saveDraft, saveOutbox } from '../composer/draft-outbox'
import { getSpeechRecognitionConstructor, type SpeechRecognitionConstructor, type SpeechRecognitionLike } from '../composer/speech-recognition'
import { createMobileAttachment, revokeAttachmentPreview, type MobileAttachment } from '../media/attachment-state'
import { readFileAsDataUrl } from '../media/read-file-as-data-url'

const EMPTY_CHAT: MobileChatState = {
  busy: false,
  error: null,
  messages: [],
  tools: []
}
const PROMPT_TIMEOUT_MS = 1_800_000
const RECONNECT_DELAYS_MS = [500, 1000, 2000, 4000, 8000] as const
const MAX_MOBILE_ATTACHMENT_BYTES = 50 * 1024 * 1024
const MAX_MOBILE_IMAGE_BYTES = 25 * 1024 * 1024

export function ChatScreen({
  onSessionCreated,
  onUpdateBlockedChange,
  profile,
  storedSessionId
}: {
  onSessionCreated: () => void
  onUpdateBlockedChange: (blocked: boolean) => void
  profile: string
  storedSessionId: string
}) {
  const navigate = useNavigate()
  const gateway = useMemo(() => new GatewayClient(), [])
  const isNew = storedSessionId === 'new'
  const runtimeId = useRef<string | null>(null)
  const pendingStoredId = useRef<string | null>(null)
  const submitInFlight = useRef(false)
  const filePickerRef = useRef<HTMLInputElement | null>(null)
  const cameraPickerRef = useRef<HTMLInputElement | null>(null)
  const attachmentRef = useRef<MobileAttachment[]>([])
  const canceledAttachmentIds = useRef(new Set<string>())
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const [chat, setChat] = useState<MobileChatState>(EMPTY_CHAT)
  const [actions, setActions] = useState<MobileActionState>(EMPTY_MOBILE_ACTIONS)
  const [draft, setDraft] = useState(() => loadDraft(profile, storedSessionId))
  const [queuedText, setQueuedText] = useState(() => loadOutbox(profile, storedSessionId))
  const [attachments, setAttachments] = useState<MobileAttachment[]>([])
  const [selectedMessage, setSelectedMessage] = useState<MobileChatMessage | null>(null)
  const [voiceActive, setVoiceActive] = useState(false)
  const [voiceError, setVoiceError] = useState<string | null>(null)
  const [connected, setConnected] = useState(false)
  const [ready, setReady] = useState(false)
  const [connectionEpoch, setConnectionEpoch] = useState(0)
  const [showJumpLatest, setShowJumpLatest] = useState(false)
  const [historyPage, setHistoryPage] = useState({ hasEarlier: false, loading: false, nextOffset: 0 })
  const shouldAutoFollowRef = useRef(true)
  const threadRef = useRef<HTMLDivElement | null>(null)
  const pendingPrependRef = useRef<{ scrollHeight: number; scrollTop: number } | null>(null)
  const historyHydratedRef = useRef(false)

  useEffect(() => {
    saveDraft(profile, storedSessionId, draft)
  }, [draft, profile, storedSessionId])

  useEffect(() => {
    saveOutbox(profile, storedSessionId, queuedText)
  }, [profile, queuedText, storedSessionId])

  useEffect(() => {
    attachmentRef.current = attachments
  }, [attachments])

  useEffect(() => {
    onUpdateBlockedChange(Boolean(draft.trim() || attachments.length || chat.busy || voiceActive))
  }, [attachments.length, chat.busy, draft, onUpdateBlockedChange, voiceActive])

  useEffect(() => () => onUpdateBlockedChange(false), [onUpdateBlockedChange])

  useEffect(() => () => {
    attachmentRef.current.forEach(revokeAttachmentPreview)
    recognitionRef.current?.stop()
  }, [])

  useEffect(() => {
    let cancelled = false
    setActions(EMPTY_MOBILE_ACTIONS)
    historyHydratedRef.current = false
    let reconnectAttempt = 0
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null

    const hydrateResumableSession = async (resumableId: string) => {
      const [storedResult, resumed] = await Promise.all([
        historyHydratedRef.current
          ? Promise.resolve({ ok: null as null })
          : api.getSessionMessages(resumableId, profile).then(
              stored => ({ ok: true as const, stored }),
              () => ({ ok: false as const })
            ),
        gateway.request<MobileResumeSnapshot>('session.resume', {
          cols: 48,
          omit_messages: true,
          ...(profile ? { profile } : {}),
          session_id: resumableId,
          source: 'web'
        })
      ])
      if (cancelled) return
      runtimeId.current = resumed.session_id
      setActions(current => hydrateMobileActionResume(current, resumed))
      if (storedResult.ok === true) {
        const returned = storedResult.stored.pagination?.returned ?? storedResult.stored.messages.length
        const limit = storedResult.stored.pagination?.limit ?? 500
        historyHydratedRef.current = true
        setHistoryPage({ hasEarlier: returned >= limit, loading: false, nextOffset: returned })
      }
      setChat(current => hydrateMobileResume({
        ...current,
        error: storedResult.ok === false ? 'Could not load conversation history.' : null,
        messages: storedResult.ok === true ? projectSessionMessages(storedResult.stored.messages) : current.messages
      }, resumed))
    }

    const resumeAfterReconnect = async () => {
      const resumableId = pendingStoredId.current || (!isNew ? storedSessionId : null)
      if (resumableId) await hydrateResumableSession(resumableId)
      else if (!cancelled) setChat(current => ({ ...current, error: null }))
      if (!cancelled) {
        setConnected(true)
        setReady(true)
      }
    }

    const scheduleReconnect = () => {
      if (cancelled || reconnectTimer) return
      const delay = RECONNECT_DELAYS_MS[reconnectAttempt]
      if (delay === undefined) {
        setChat(current => ({ ...current, error: 'Could not reconnect to Hermes. Reopen this chat to retry.' }))
        return
      }
      reconnectAttempt += 1
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null
        void gateway.connect()
          .then(async () => {
            await resumeAfterReconnect()
            reconnectAttempt = 0
          })
          .catch(() => scheduleReconnect())
      }, delay)
    }

    const disposers = [
      gateway.onAny((event: GatewayEvent) => {
        if (event.profile && event.profile !== profile) return
        if (event.session_id && event.session_id !== runtimeId.current) return
        if (event.type === 'message.complete' || event.type === 'error') submitInFlight.current = false
        setActions(current => applyMobileActionEvent(current, event, runtimeId.current))
        setChat(current => applyMobileGatewayEvent(current, event))
      }),
      gateway.onState(state => {
        const isOpen = state === 'open'
        setConnected(isOpen)
        if (!isOpen) setReady(false)
        if (state === 'closed' || state === 'error') scheduleReconnect()
      })
    ]

    void gateway
      .connect()
      .then(async () => {
        if (cancelled) return
        if (isNew) {
          setReady(true)
          return
        }
        await hydrateResumableSession(storedSessionId)
        if (cancelled) return
        setReady(true)
      })
      .catch((error: Error) => {
        if (!cancelled) {
          setReady(false)
          setChat(current => ({ ...current, error: error.message }))
          scheduleReconnect()
        }
      })

    return () => {
      cancelled = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      disposers.forEach(dispose => dispose())
      gateway.close()
    }
  }, [connectionEpoch, gateway, isNew, navigate, profile, storedSessionId])

  useLayoutEffect(() => {
    const node = threadRef.current
    const pending = pendingPrependRef.current
    if (!node || !pending) return
    node.scrollTop = pending.scrollTop + (node.scrollHeight - pending.scrollHeight)
    pendingPrependRef.current = null
    shouldAutoFollowRef.current = false
  }, [chat.messages])

  useEffect(() => {
    const node = threadRef.current
    if (!node) return
    if (shouldAutoFollowRef.current) {
      node.scrollTop = node.scrollHeight
      setShowJumpLatest(false)
    } else {
      setShowJumpLatest(true)
    }
  }, [chat.messages, chat.tools])

  const trackThreadScroll = useCallback(() => {
    const node = threadRef.current
    if (!node) return
    const nearBottom = node.scrollHeight - node.scrollTop - node.clientHeight <= 80
    shouldAutoFollowRef.current = nearBottom
    if (nearBottom) setShowJumpLatest(false)
  }, [])

  const jumpToLatest = useCallback(() => {
    const node = threadRef.current
    if (!node) return
    shouldAutoFollowRef.current = true
    node.scrollTop = node.scrollHeight
    setShowJumpLatest(false)
  }, [])

  const loadEarlier = useCallback(async () => {
    if (isNew || historyPage.loading || !historyPage.hasEarlier) return
    const node = threadRef.current
    if (node) {
      pendingPrependRef.current = {
        scrollHeight: node.scrollHeight,
        scrollTop: node.scrollTop
      }
    }
    setHistoryPage(current => ({ ...current, loading: true }))
    try {
      const page = await api.getSessionMessages(storedSessionId, profile, {
        limit: 500,
        offset: historyPage.nextOffset,
        order: 'latest'
      })
      const earlier = projectSessionMessages(page.messages)
      setChat(current => {
        const existingIds = new Set(current.messages.map(message => message.id))
        return {
          ...current,
          messages: [...earlier.filter(message => !existingIds.has(message.id)), ...current.messages]
        }
      })
      const returned = page.pagination?.returned ?? page.messages.length
      const limit = page.pagination?.limit ?? 500
      setHistoryPage(current => ({
        hasEarlier: returned >= limit,
        loading: false,
        nextOffset: current.nextOffset + returned
      }))
    } catch (error) {
      pendingPrependRef.current = null
      setHistoryPage(current => ({ ...current, loading: false }))
      setChat(current => ({
        ...current,
        error: error instanceof Error ? error.message : 'Could not load earlier messages.'
      }))
    }
  }, [historyPage.hasEarlier, historyPage.loading, historyPage.nextOffset, isNew, profile, storedSessionId])

  const expiredClarify = actions.pending?.kind === 'clarify' && actions.pending.status === 'expired'
  const composerBusy = chat.busy && !expiredClarify

  const submit = useCallback(
    async (event: FormEvent) => {
      event.preventDefault()
      const text = draft.trim()
      const pendingAttachments = attachments.filter(attachment => attachment.status !== 'canceled')
      if ((!text && !pendingAttachments.length) || (chat.busy && !expiredClarify) || submitInFlight.current) return
      if (!ready) {
        if (pendingAttachments.length) {
          setChat(current => ({ ...current, error: 'Reconnect before sending attachments. Your selection is preserved.' }))
          return
        }
        setQueuedText(text)
        setDraft('')
        setChat(current => ({ ...current, error: null }))
        return
      }
      const optimisticId = `user-${Date.now()}`
      const attachmentNames = pendingAttachments.map(attachment => attachment.file.name).join(', ')
      const optimisticContent = [text, attachmentNames ? `📎 ${attachmentNames}` : ''].filter(Boolean).join('\n')
      submitInFlight.current = true
      setDraft('')
      setAttachments(current => current.map(attachment => (
        pendingAttachments.some(pending => pending.id === attachment.id)
          ? { ...attachment, error: undefined, status: 'reading' }
          : attachment
      )))
      setChat(current => ({
        ...current,
        busy: true,
        error: null,
        messages: [
          ...current.messages,
          {
            content: optimisticContent,
            id: optimisticId,
            role: 'user'
          }
        ]
      }))
      const dropCanceledSubmission = () => {
        const pendingIds = new Set(pendingAttachments.map(attachment => attachment.id))
        submitInFlight.current = false
        setAttachments(current => {
          const removed = current.filter(attachment => pendingIds.has(attachment.id))
          removed.forEach(revokeAttachmentPreview)
          return current.filter(attachment => !pendingIds.has(attachment.id))
        })
        pendingAttachments.forEach(attachment => canceledAttachmentIds.current.delete(attachment.id))
        setChat(current => ({
          ...current,
          busy: false,
          messages: current.messages.filter(message => message.id !== optimisticId)
        }))
      }
      try {
        const preparedAttachments: Array<{ attachment: MobileAttachment; dataUrl: string }> = []
        for (const attachment of pendingAttachments) {
          if (canceledAttachmentIds.current.has(attachment.id)) continue
          setAttachments(current => current.map(item => item.id === attachment.id ? { ...item, status: 'reading' } : item))
          const dataUrl = await readFileAsDataUrl(attachment.file)
          if (!canceledAttachmentIds.current.has(attachment.id)) {
            preparedAttachments.push({ attachment, dataUrl })
          }
        }
        const sendableAttachments = preparedAttachments.filter(
          ({ attachment }) => !canceledAttachmentIds.current.has(attachment.id)
        )
        if (!text && !sendableAttachments.length) {
          dropCanceledSubmission()
          return
        }

        const sendableIds = new Set(sendableAttachments.map(({ attachment }) => attachment.id))
        setAttachments(current => current.map(attachment => sendableIds.has(attachment.id)
          ? { ...attachment, status: 'uploading' }
          : attachment
        ))

        let sid = runtimeId.current
        if (!sid) {
          const created = await gateway.request<{ session_id: string; stored_session_id?: string | null }>(
            'session.create',
            {
              cols: 48,
              ...(profile ? { profile } : {}),
              source: 'web',
              title: (text || attachmentNames || 'Attachment').slice(0, 72)
            }
          )
          sid = created.session_id
          runtimeId.current = sid
          pendingStoredId.current = created.stored_session_id || sid
        }
        const fileRefs: string[] = []
        let attachedCount = 0
        for (const { attachment, dataUrl } of sendableAttachments) {
          if (canceledAttachmentIds.current.has(attachment.id)) continue
          if (attachment.file.type.startsWith('image/')) {
            const attached = await gateway.request<{ attached?: boolean; message?: string }>('image.attach_bytes', {
              content_base64: dataUrl.slice(dataUrl.indexOf(',') + 1),
              filename: attachment.file.name,
              session_id: sid
            })
            if (!attached.attached) throw new Error(attached.message || `Could not attach ${attachment.file.name}`)
            attachedCount += 1
          } else {
            const attached = await gateway.request<{ attached?: boolean; message?: string; ref_text?: string }>(
              'file.attach',
              {
                data_url: dataUrl,
                name: attachment.file.name,
                session_id: sid
              }
            )
            if (!attached.attached || !attached.ref_text) {
              throw new Error(attached.message || `Could not attach ${attachment.file.name}`)
            }
            fileRefs.push(attached.ref_text)
            attachedCount += 1
          }
          setAttachments(current => current.map(item => item.id === attachment.id
            ? { ...item, status: 'staged' }
            : item
          ))
        }
        if (!text && attachedCount === 0) {
          dropCanceledSubmission()
          return
        }
        const promptText = [...fileRefs, text].filter(Boolean).join('\n\n')
        await gateway.request('prompt.submit', { session_id: sid, text: promptText }, PROMPT_TIMEOUT_MS)
        submitInFlight.current = false
        setAttachments(current => {
          const completed = current.filter(attachment => pendingAttachments.some(pending => pending.id === attachment.id))
          completed.forEach(revokeAttachmentPreview)
          return current.filter(attachment => !pendingAttachments.some(pending => pending.id === attachment.id))
        })
        pendingAttachments.forEach(attachment => canceledAttachmentIds.current.delete(attachment.id))
        if (pendingStoredId.current) {
          const durable = pendingStoredId.current
          pendingStoredId.current = null
          onSessionCreated()
          navigate(`/mobile/chat/${encodeURIComponent(durable)}`, { replace: true })
        }
      } catch (error) {
        submitInFlight.current = false
        setDraft(current => current.trim() ? current : text)
        const message = error instanceof Error ? error.message : 'Could not send message'
        setAttachments(current => current.map(attachment => (
          pendingAttachments.some(pending => pending.id === attachment.id) && attachment.status !== 'canceled'
            ? { ...attachment, error: message, status: 'failed' }
            : attachment
        )))
        setChat(current => ({
          ...current,
          busy: false,
          error: message,
          messages: current.messages.filter(message => message.id !== optimisticId)
        }))
      }
    },
    [attachments, chat.busy, draft, expiredClarify, gateway, navigate, onSessionCreated, profile, ready]
  )

  const selectAttachments = useCallback((files: FileList | File[]) => {
    const selected = Array.from(files)
    const accepted: MobileAttachment[] = []
    for (const file of selected) {
      const limit = file.type.startsWith('image/') ? MAX_MOBILE_IMAGE_BYTES : MAX_MOBILE_ATTACHMENT_BYTES
      if (!file.size || file.size > limit) {
        const maxMb = Math.round(limit / (1024 * 1024))
        setChat(current => ({ ...current, error: `${file.name} must be smaller than ${maxMb} MB.` }))
        continue
      }
      const id = `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 8)}`
      accepted.push(createMobileAttachment(file, id))
    }
    if (accepted.length) {
      setAttachments(current => [...current, ...accepted])
      setChat(current => ({ ...current, error: null }))
    }
  }, [])

  const speechRecognitionConstructor = typeof window === 'undefined'
    ? undefined
    : getSpeechRecognitionConstructor(window as unknown as { SpeechRecognition?: SpeechRecognitionConstructor; webkitSpeechRecognition?: SpeechRecognitionConstructor })

  const removeAttachment = useCallback((id: string) => {
    canceledAttachmentIds.current.delete(id)
    setAttachments(current => {
      const attachment = current.find(item => item.id === id)
      if (attachment) revokeAttachmentPreview(attachment)
      return current.filter(item => item.id !== id)
    })
  }, [])

  const cancelAttachment = useCallback((id: string) => {
    canceledAttachmentIds.current.add(id)
    setAttachments(current => current.map(attachment => attachment.id === id
      ? { ...attachment, status: 'canceled' }
      : attachment
    ))
  }, [])

  const startVoiceDictation = useCallback(() => {
    if (!speechRecognitionConstructor) return
    const recognition = new speechRecognitionConstructor()
    recognitionRef.current = recognition
    recognition.continuous = false
    recognition.interimResults = false
    recognition.lang = navigator.language || 'en-US'
    recognition.onresult = event => {
      const transcript = Array.from(event.results).map(result => result[0]?.transcript ?? '').join(' ').trim()
      if (transcript) setDraft(current => [current, transcript].filter(Boolean).join(current ? ' ' : ''))
    }
    recognition.onerror = event => setVoiceError(event.error ? `Voice dictation: ${event.error}` : 'Voice dictation failed.')
    recognition.onend = () => {
      recognitionRef.current = null
      setVoiceActive(false)
    }
    setVoiceError(null)
    setVoiceActive(true)
    try {
      recognition.start()
    } catch {
      recognitionRef.current = null
      setVoiceActive(false)
      setVoiceError('Voice dictation could not start.')
    }
  }, [speechRecognitionConstructor])

  const stopVoiceDictation = useCallback(() => recognitionRef.current?.stop(), [])

  const respondToAction = useCallback(async (response: (
    | { answer: string; kind: 'clarify'; requestId: string }
    | { choice: 'always' | 'deny' | 'once' | 'session'; kind: 'approval'; sessionId: string }
  )) => {
    const respondedAction = actions.pending
    if (response.kind === 'clarify') {
      await gateway.request('clarify.respond', { answer: response.answer, request_id: response.requestId })
    } else {
      await gateway.request('approval.respond', { choice: response.choice, session_id: response.sessionId })
    }
    setActions(current => current.pending === respondedAction ? EMPTY_MOBILE_ACTIONS : current)
  }, [actions.pending, gateway])

  const stopResponse = useCallback(async () => {
    if (!runtimeId.current) return
    try {
      await gateway.request('session.interrupt', { session_id: runtimeId.current })
    } catch (error) {
      setChat(current => ({ ...current, error: error instanceof Error ? error.message : 'Could not stop Hermes.' }))
    }
  }, [gateway])

  return (
    <div className={`mobile-chat-shell${attachments.length ? ' has-attachments' : ''}`}>
      <AppHeader
        back={() => navigate('/mobile/chats')}
        detail={connected ? 'Connected to Desktop' : 'Connecting…'}
        title={isNew ? 'New chat' : 'Hermes'}
      />
      <div className="mobile-chat-thread" onScroll={trackThreadScroll} ref={threadRef}>
        {historyPage.hasEarlier && (
          <button
            aria-label="Load earlier messages"
            className="mobile-load-earlier"
            disabled={historyPage.loading}
            onClick={() => void loadEarlier()}
            type="button"
          >
            {historyPage.loading ? 'Loading earlier messages…' : 'Load earlier messages'}
          </button>
        )}
        {!chat.messages.length && (
          <div className="mobile-chat-empty">
            <span className="mobile-wordmark is-large">H</span>
            <h1>What can I help with?</h1>
            <p>This conversation will also appear in Hermes Desktop.</p>
          </div>
        )}
        {chat.messages.map(message => (
          <MessageBubble key={message.id} message={message} onActions={() => setSelectedMessage(message)} />
        ))}
        {actions.pending && <ChatActionCard action={actions.pending} onRespond={respondToAction} />}
        {!!chat.tools.length && (
          <div className="mobile-tool-strip">
            {chat.tools.slice(-3).map(tool => (
              <span key={tool.id}>
                {tool.status === 'complete' ? <CheckCircle2 /> : <Clock3 />} {tool.name}
              </span>
            ))}
          </div>
        )}
        {chat.busy && runtimeId.current && (
          <button aria-label="Stop response" className="mobile-stop-response" onClick={() => void stopResponse()} type="button">
            <Square /> Stop response
          </button>
        )}
        {chat.error && (
          <div className="mobile-error" role="alert">
            {chat.error}
            {!ready && (
              <button
                aria-label="Retry Hermes connection"
                onClick={() => {
                  setChat(current => ({ ...current, error: null }))
                  setConnectionEpoch(current => current + 1)
                }}
                type="button"
              >
                Retry now
              </button>
            )}
          </div>
        )}
      </div>
      {queuedText && (
        <aside className="mobile-outbox" role="status">
          <span>Queued until Hermes reconnects</span>
          <button
            aria-label="Review queued message"
            onClick={() => {
              if (draft.trim()) {
                setChat(current => ({ ...current, error: 'Clear or send the current draft before reviewing the queued message.' }))
                return
              }
              setDraft(queuedText)
              setQueuedText('')
            }}
            type="button"
          >
            Review
          </button>
        </aside>
      )}
      {showJumpLatest && (
        <button
          aria-label="Jump to latest message"
          className="mobile-jump-latest"
          onClick={jumpToLatest}
          type="button"
        >
          <ArrowDown />
          Latest
        </button>
      )}
      <form className="mobile-composer" onSubmit={submit}>
        {!!attachments.length && (
          <div className="mobile-attachment-list" aria-label="Selected attachments">
            {attachments.map(attachment => (
              <div className="mobile-attachment-chip" key={attachment.id}>
                {attachment.previewUrl ? <img alt={`Preview ${attachment.file.name}`} src={attachment.previewUrl} /> : <FileUp />}
                <span className="mobile-attachment-copy">
                  <strong>{attachment.file.name}</strong>
                  <small>{attachment.status}{attachment.error ? `: ${attachment.error}` : ''}</small>
                </span>
                {attachment.status === 'reading' ? (
                  <button aria-label={`Cancel ${attachment.file.name}`} onClick={() => cancelAttachment(attachment.id)} type="button"><X /></button>
                ) : attachment.status === 'uploading' ? (
                  <small className="mobile-attachment-lock">Finishing…</small>
                ) : (
                  <button aria-label={`Remove ${attachment.file.name}`} onClick={() => removeAttachment(attachment.id)} type="button"><X /></button>
                )}
              </div>
            ))}
          </div>
        )}
        <input
          accept="image/*,.pdf,.txt,.md,.csv,.json,.yaml,.yml,.doc,.docx,.xls,.xlsx,.ppt,.pptx"
          className="mobile-file-picker"
          disabled={chat.busy || submitInFlight.current}
          multiple
          onChange={event => {
            if (event.currentTarget.files) selectAttachments(event.currentTarget.files)
            event.currentTarget.value = ''
          }}
          ref={filePickerRef}
          type="file"
        />
        <input
          accept="image/*"
          aria-label="Take a photo"
          capture="environment"
          className="mobile-file-picker"
          disabled={chat.busy || submitInFlight.current}
          onChange={event => {
            if (event.currentTarget.files) selectAttachments(event.currentTarget.files)
            event.currentTarget.value = ''
          }}
          ref={cameraPickerRef}
          type="file"
        />
        <div className="mobile-composer-tools">
          <IconButton disabled={chat.busy || submitInFlight.current} label="Add attachment" onClick={() => filePickerRef.current?.click()}>
            <Plus />
          </IconButton>
          <IconButton disabled={chat.busy || submitInFlight.current} label="Take a photo" onClick={() => cameraPickerRef.current?.click()}>
            <Camera />
          </IconButton>
          {speechRecognitionConstructor && (
            <IconButton disabled={chat.busy} label={voiceActive ? 'Stop voice dictation' : 'Start voice dictation'} onClick={voiceActive ? stopVoiceDictation : startVoiceDictation}>
              <Mic />
            </IconButton>
          )}
        </div>
        <textarea
          aria-label="Message Hermes"
          disabled={composerBusy}
          onChange={event => setDraft(event.target.value)}
          placeholder={composerBusy ? 'Hermes is responding…' : ready ? 'Message Hermes…' : 'Write now — Hermes will send when connected…'}
          rows={1}
          value={draft}
        />
        <button
          aria-label={ready ? 'Send message' : 'Queue message'}
          className="mobile-send"
          disabled={(!draft.trim() && !attachments.length) || composerBusy}
          type="submit"
        >
          <Send />
        </button>
      </form>
      {voiceActive && <div className="mobile-voice-status" role="status">Listening… tap the microphone to stop.</div>}
      {voiceError && <div className="mobile-voice-status is-error" role="alert">{voiceError}</div>}
      {selectedMessage && (
        <MessageActionSheet
          message={selectedMessage}
          onClose={() => setSelectedMessage(null)}
          onRetry={text => {
            setDraft(text)
            setSelectedMessage(null)
          }}
        />
      )}
    </div>
  )
}
