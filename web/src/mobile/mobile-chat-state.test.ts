import { describe, expect, it } from 'vitest'

import {
  applyMobileGatewayEvent,
  hydrateMobileResume,
  projectSessionMessages,
  type MobileChatState
} from './mobile-chat-state'

describe('projectSessionMessages', () => {
  it('keeps user and assistant transcript rows while hiding raw tool plumbing', () => {
    expect(
      projectSessionMessages([
        { id: 10, role: 'user', content: 'Build the PWA' },
        { id: 11, role: 'assistant', content: 'I am on it.' },
        { id: 12, role: 'tool', content: 'large internal result', tool_name: 'terminal' }
      ])
    ).toMatchObject([
      { id: 'db-10', role: 'user', content: 'Build the PWA' },
      { id: 'db-11', role: 'assistant', content: 'I am on it.' }
    ])
  })
})

describe('applyMobileGatewayEvent', () => {
  const empty: MobileChatState = {
    busy: false,
    error: null,
    messages: [],
    tools: []
  }

  it('builds one streaming assistant bubble from start, deltas, and completion', () => {
    const started = applyMobileGatewayEvent(empty, {
      type: 'message.start',
      payload: {}
    })
    const streamed = applyMobileGatewayEvent(started, {
      type: 'message.delta',
      payload: { text: 'Hello' }
    })
    const completed = applyMobileGatewayEvent(streamed, {
      type: 'message.complete',
      payload: { text: 'Hello from Hermes' }
    })

    expect(completed.busy).toBe(false)
    expect(completed.messages).toMatchObject([{ role: 'assistant', content: 'Hello from Hermes', streaming: false }])
  })

  it('keeps tool progress compact and updates the same row on completion', () => {
    const started = applyMobileGatewayEvent(empty, {
      type: 'tool.start',
      payload: { id: 'call-1', name: 'web_search' }
    })
    const completed = applyMobileGatewayEvent(started, {
      type: 'tool.complete',
      payload: { id: 'call-1', name: 'web_search' }
    })

    expect(completed.tools).toEqual([{ id: 'call-1', name: 'web_search', status: 'complete' }])
  })

  it('surfaces gateway errors and ends the busy state', () => {
    const failed = applyMobileGatewayEvent(
      { ...empty, busy: true },
      { type: 'error', payload: { message: 'Connection lost' } }
    )

    expect(failed.busy).toBe(false)
    expect(failed.error).toBe('Connection lost')
  })
})

describe('hydrateMobileResume', () => {
  it('restores an in-flight answer, corrections, and the queued prompt as a busy turn', () => {
    const hydrated = hydrateMobileResume(
      {
        busy: false,
        error: null,
        messages: [{ id: 'stored-1', role: 'assistant', content: 'Earlier answer' }],
        tools: []
      },
      {
        inflight: {
          assistant: 'Partial answer',
          corrections: ['Focus on mobile'],
          streaming: true,
          user: 'Explain the release'
        },
        queued: { user: 'Then summarize it' },
        running: true,
        session_id: 'runtime-resumed'
      }
    )

    expect(hydrated.busy).toBe(true)
    expect(hydrated.messages).toMatchObject([
      { role: 'assistant', content: 'Earlier answer' },
      { role: 'user', content: 'Explain the release' },
      { role: 'user', content: 'Focus on mobile' },
      { role: 'assistant', content: 'Partial answer', streaming: true },
      { role: 'user', content: 'Then summarize it' }
    ])

    const restarted = applyMobileGatewayEvent(hydrated, {
      type: 'message.start',
      payload: {}
    })
    expect(restarted.messages.filter(message => message.role === 'assistant')).toHaveLength(2)
    expect(restarted.messages.filter(message => message.streaming)).toHaveLength(1)

    const continued = applyMobileGatewayEvent(restarted, {
      type: 'message.delta',
      payload: { text: ' continued' }
    })
    expect(continued.messages[3]?.content).toBe('Partial answer continued')
  })
})
