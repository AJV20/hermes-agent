import { describe, expect, it } from 'vitest'

import { applyMobileActionEvent, completeMobileAction, EMPTY_MOBILE_ACTIONS } from './mobile-action-state'

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
        allow_permanent: false,
        request_id: 'approval-1'
      }
    }, 'runtime-1')

    expect(state.pending).toEqual({
      kind: 'approval',
      allowPermanent: false,
      choices: ['once', 'deny'],
      command: 'rm -rf [REDACTED]',
      description: 'Deletes files',
      requestId: 'approval-1',
      sessionId: 'runtime-1',
      status: 'waiting'
    })
  })

  it('removes permanent approval when the backend explicitly forbids it', () => {
    const state = applyMobileActionEvent(EMPTY_MOBILE_ACTIONS, {
      session_id: 'runtime-1',
      type: 'approval.request',
      payload: {
        choices: ['once', 'always', 'deny'],
        allow_permanent: false,
        request_id: 'approval-1'
      }
    }, 'runtime-1')

    expect(state.pending).toMatchObject({
      kind: 'approval',
      allowPermanent: false,
      choices: ['once', 'deny']
    })
  })

  it('serializes same-session approvals in the backend FIFO order', () => {
    const first = applyMobileActionEvent(EMPTY_MOBILE_ACTIONS, {
      session_id: 'runtime-1',
      type: 'approval.request',
      payload: { command: 'command A', choices: ['once', 'deny'], request_id: 'approval-a' }
    }, 'runtime-1')
    const queued = applyMobileActionEvent(first, {
      session_id: 'runtime-1',
      type: 'approval.request',
      payload: { command: 'command B', choices: ['once', 'deny'], request_id: 'approval-b' }
    }, 'runtime-1')

    expect(queued.pending).toMatchObject({ kind: 'approval', command: 'command A' })
    expect(queued.queued).toHaveLength(1)
    expect(completeMobileAction(queued, queued.pending).pending).toMatchObject({
      kind: 'approval', command: 'command B'
    })
  })

  it('deduplicates the same approval projected by resume and a delayed live event', () => {
    const first = applyMobileActionEvent(EMPTY_MOBILE_ACTIONS, {
      session_id: 'runtime-1',
      type: 'approval.request',
      payload: { command: 'command B', choices: ['once', 'deny'], request_id: 'approval-b' }
    }, 'runtime-1')
    const duplicate = applyMobileActionEvent(first, {
      session_id: 'runtime-1',
      type: 'approval.request',
      payload: { command: 'command B', choices: ['once', 'deny'], request_id: 'approval-b' }
    }, 'runtime-1')

    expect(duplicate).toBe(first)
    expect(duplicate.queued).toHaveLength(0)
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
