import { describe, expect, it } from 'vitest'

import { applyMobileGatewayEvent, projectSessionMessages, type MobileChatState } from './mobile-chat-state'

describe('projectSessionMessages', () => {
  it('keeps user and assistant transcript rows while hiding raw tool plumbing', () => {
    expect(
      projectSessionMessages([
        { role: 'user', content: 'Build the PWA' },
        { role: 'assistant', content: 'I am on it.' },
        { role: 'tool', content: 'large internal result', tool_name: 'terminal' }
      ])
    ).toMatchObject([
      { role: 'user', content: 'Build the PWA' },
      { role: 'assistant', content: 'I am on it.' }
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
