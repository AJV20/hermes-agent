import { describe, expect, it } from 'vitest'

import { applyMobileActionEvent, EMPTY_MOBILE_ACTIONS } from './mobile-action-state'

describe('mobile action projection', () => {
  it('creates and expires a scoped clarify card without losing its choices', () => {
    const waiting = applyMobileActionEvent(EMPTY_MOBILE_ACTIONS, {
      session_id: 'runtime-1',
      type: 'clarify.request',
      payload: {
        request_id: 'request-1',
        question: 'Which environment?',
        choices: ['staging', 'production'],
        multi_select: true
      }
    }, 'runtime-1')

    expect(waiting.pending).toEqual({
      kind: 'clarify',
      requestId: 'request-1',
      question: 'Which environment?',
      choices: ['staging', 'production'],
      multiSelect: true,
      status: 'waiting'
    })

    const expired = applyMobileActionEvent(waiting, {
      session_id: 'runtime-1',
      type: 'clarify.expire',
      payload: { request_id: 'request-1' }
    }, 'runtime-1')

    expect(expired.pending).toMatchObject({ requestId: 'request-1', status: 'expired' })
    expect(expired.pending && 'choices' in expired.pending ? expired.pending.choices : []).toEqual(['staging', 'production'])
  })

  it('ignores action events owned by another runtime session', () => {
    const state = applyMobileActionEvent(EMPTY_MOBILE_ACTIONS, {
      session_id: 'runtime-other',
      type: 'clarify.request',
      payload: { request_id: 'request-2', question: 'Leaked?', choices: ['yes'] }
    }, 'runtime-1')

    expect(state).toBe(EMPTY_MOBILE_ACTIONS)
  })

  it('honors the approval choices supplied by the backend', () => {
    const state = applyMobileActionEvent(EMPTY_MOBILE_ACTIONS, {
      session_id: 'runtime-1',
      type: 'approval.request',
      payload: {
        command: 'rm -rf [REDACTED]',
        description: 'Deletes files',
        choices: ['once', 'deny'],
        allow_permanent: false
      }
    }, 'runtime-1')

    expect(state.pending).toEqual({
      kind: 'approval',
      allowPermanent: false,
      choices: ['once', 'deny'],
      command: 'rm -rf [REDACTED]',
      description: 'Deletes files',
      sessionId: 'runtime-1',
      status: 'waiting'
    })
  })

  it('never retains sudo or secret request payloads on mobile', () => {
    const state = applyMobileActionEvent(EMPTY_MOBILE_ACTIONS, {
      session_id: 'runtime-1',
      type: 'secret.request',
      payload: { env_var: 'API_KEY', prompt: 'paste secret value' }
    }, 'runtime-1')

    expect(state.pending).toEqual({ kind: 'sensitive', status: 'unsupported' })
    expect(JSON.stringify(state)).not.toContain('API_KEY')
    expect(JSON.stringify(state)).not.toContain('paste secret value')
  })
})
