import type { GatewayEvent } from '@/lib/gatewayClient'

export type MobileApprovalChoice = 'always' | 'deny' | 'once' | 'session'

export type MobileClarifyAction = {
  kind: 'clarify'
  requestId: string
  question: string
  choices: string[]
  multiSelect: boolean
  status: 'expired' | 'submitting' | 'waiting'
}

export type MobileApprovalAction = {
  kind: 'approval'
  allowPermanent: boolean
  choices: MobileApprovalChoice[]
  command: string
  description: string
  requestId: string
  sessionId: string
  status: 'submitting' | 'waiting'
}

export type MobileSensitiveAction = {
  kind: 'sensitive'
  status: 'unsupported'
}

export type MobilePendingAction = MobileApprovalAction | MobileClarifyAction | MobileSensitiveAction

export interface MobileActionState {
  pending: MobilePendingAction | null
  queued: MobilePendingAction[]
}

export const EMPTY_MOBILE_ACTIONS: MobileActionState = { pending: null, queued: [] }

function actionRequestId(action: MobilePendingAction): string | null {
  return action.kind === 'sensitive' ? null : action.requestId
}

function enqueueMobileAction(state: MobileActionState, action: MobilePendingAction): MobileActionState {
  const requestId = actionRequestId(action)
  if (requestId && [state.pending, ...state.queued].some(existing => (
    existing?.kind === action.kind && actionRequestId(existing) === requestId
  ))) return state
  return state.pending
    ? { ...state, queued: [...state.queued, action] }
    : { pending: action, queued: [] }
}

export function completeMobileAction(
  state: MobileActionState,
  expected: MobilePendingAction | null
): MobileActionState {
  if (!expected || state.pending !== expected) return state
  return { pending: state.queued[0] ?? null, queued: state.queued.slice(1) }
}

function record(payload: unknown): Record<string, unknown> {
  return payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
}

function strings(value: unknown, limit = 20): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string')
    .map(item => item.trim())
    .filter(Boolean)
    .slice(0, limit)
}

function approvalChoices(payload: Record<string, unknown>): MobileApprovalChoice[] {
  const allowed = new Set<MobileApprovalChoice>(['always', 'deny', 'once', 'session'])
  const supplied = strings(payload.choices).filter((choice): choice is MobileApprovalChoice => (
    allowed.has(choice as MobileApprovalChoice) && (payload.allow_permanent !== false || choice !== 'always')
  ))
  if (supplied.length) return supplied
  return payload.allow_permanent === false ? ['once', 'deny'] : ['once', 'session', 'always', 'deny']
}

export function hydrateMobileActionResume(
  _state: MobileActionState,
  snapshot: { pending_prompt?: { payload?: unknown; type?: string } | null; session_id: string }
): MobileActionState {
  const pending = snapshot.pending_prompt
  if (!pending?.type) return EMPTY_MOBILE_ACTIONS
  return applyMobileActionEvent(EMPTY_MOBILE_ACTIONS, {
    payload: pending.payload,
    session_id: snapshot.session_id,
    type: pending.type
  }, snapshot.session_id)
}

export function applyMobileActionEvent(
  state: MobileActionState,
  event: Pick<GatewayEvent, 'payload' | 'session_id' | 'type'>,
  runtimeSessionId: string | null
): MobileActionState {
  if (event.session_id && runtimeSessionId && event.session_id !== runtimeSessionId) return state
  const payload = record(event.payload)

  if (event.type === 'clarify.request') {
    const requestId = typeof payload.request_id === 'string' ? payload.request_id : ''
    const question = typeof payload.question === 'string' ? payload.question.trim() : ''
    if (!requestId || !question) return state
    return enqueueMobileAction(state, {
      kind: 'clarify',
      requestId,
      question,
      choices: strings(payload.choices),
      multiSelect: payload.multi_select === true,
      status: 'waiting'
    })
  }

  if (event.type === 'clarify.expire') {
    const requestId = typeof payload.request_id === 'string' ? payload.request_id : ''
    if (state.pending?.kind === 'clarify' && state.pending.requestId === requestId) {
      return { ...state, pending: { ...state.pending, status: 'expired' } }
    }
    return {
      ...state,
      queued: state.queued.map(action => action.kind === 'clarify' && action.requestId === requestId
        ? { ...action, status: 'expired' }
        : action)
    }
  }

  if (event.type === 'approval.request') {
    const sessionId = event.session_id || runtimeSessionId || ''
    const requestId = typeof payload.request_id === 'string' ? payload.request_id : ''
    if (!sessionId || !requestId) return state
    const choices = approvalChoices(payload)
    return enqueueMobileAction(state, {
      kind: 'approval',
      allowPermanent: payload.allow_permanent !== false && choices.includes('always'),
      choices,
      command: typeof payload.command === 'string' ? payload.command : '',
      description: typeof payload.description === 'string' ? payload.description : '',
      requestId,
      sessionId,
      status: 'waiting'
    })
  }

  if (event.type === 'secret.request' || event.type === 'sudo.request' || event.type === 'sensitive.request') {
    return enqueueMobileAction(state, { kind: 'sensitive', status: 'unsupported' })
  }

  return state
}
