// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ChatActionCard } from './ChatActionCard'
import type { MobilePendingAction } from '../mobile-action-state'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

async function render(action: MobilePendingAction, respond = vi.fn(async () => {})) {
  await act(async () => {
    root.render(<ChatActionCard action={action} onRespond={respond} />)
  })
  return respond
}

describe('ChatActionCard', () => {
  it('serializes selected multi-select choices as the real clarify response answer', async () => {
    const respond = await render({
      choices: ['staging', 'production'], kind: 'clarify', multiSelect: true,
      question: 'Deploy where?', requestId: 'clarify-1', status: 'waiting'
    })

    const staging = container.querySelector('input[value="staging"]') as HTMLInputElement
    const production = container.querySelector('input[value="production"]') as HTMLInputElement
    await act(async () => {
      staging.click()
      production.click()
      ;(container.querySelector('button[aria-label="Continue clarification"]') as HTMLButtonElement).click()
    })

    expect(respond).toHaveBeenCalledTimes(1)
    expect(respond).toHaveBeenCalledWith({ answer: 'staging, production', kind: 'clarify', requestId: 'clarify-1' })
  })

  it('requires explicit confirmation before sending an always approval', async () => {
    const respond = await render({
      allowPermanent: true, choices: ['once', 'session', 'always', 'deny'], command: 'rm -rf /tmp/build',
      description: 'Remove generated build output', kind: 'approval', sessionId: 'runtime-1', status: 'waiting'
    })

    const always = container.querySelector('button[aria-label="Always allow this command"]') as HTMLButtonElement
    await act(async () => always.click())
    expect(respond).not.toHaveBeenCalled()
    expect(container.textContent).toContain('Always allow this command?')
    await act(async () => (container.querySelector('button[aria-label="Confirm always allow"]') as HTMLButtonElement).click())
    expect(respond).toHaveBeenCalledWith({ choice: 'always', kind: 'approval', sessionId: 'runtime-1' })
  })

  it('never renders permanent approval when the action forbids it', async () => {
    await render({
      allowPermanent: false, choices: ['once', 'always', 'deny'], command: 'echo safe',
      description: 'Run a command', kind: 'approval', sessionId: 'runtime-1', status: 'waiting'
    })

    expect(container.querySelector('button[aria-label="Always allow this command"]')).toBeNull()
    expect(container.querySelector('button[aria-label="Run once"]')).not.toBeNull()
    expect(container.querySelector('button[aria-label="Deny"]')).not.toBeNull()
  })

  it('keeps a failed response actionable and suppresses duplicate taps while submitting', async () => {
    let reject!: (reason: Error) => void
    const pending = new Promise<void>((_resolve, rejecter) => { reject = rejecter })
    const respond = await render({ choices: [], kind: 'clarify', multiSelect: false, question: 'Explain?', requestId: 'clarify-2', status: 'waiting' }, vi.fn(() => pending))
    const input = container.querySelector('textarea') as HTMLTextAreaElement
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
      setter?.call(input, 'Because')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const continueButton = container.querySelector('button[aria-label="Continue clarification"]') as HTMLButtonElement
    await act(async () => { continueButton.click(); continueButton.click() })
    expect(respond).toHaveBeenCalledTimes(1)
    await act(async () => { reject(new Error('offline')); await Promise.resolve() })
    expect(container.textContent).toContain('offline')
    expect((container.querySelector('button[aria-label="Continue clarification"]') as HTMLButtonElement).disabled).toBe(false)
  })

  it('retains expired choices but only offers composer follow-up', async () => {
    await render({ choices: ['one', 'two'], kind: 'clarify', multiSelect: false, question: 'Pick one', requestId: 'clarify-3', status: 'expired' })
    expect(container.textContent).toContain('This question expired.')
    expect(container.textContent).toContain('one')
    expect(container.querySelector('button[aria-label="Continue clarification"]')).toBeNull()
  })

  it('does not render secret or sudo data', async () => {
    await render({ kind: 'sensitive', status: 'unsupported' })
    expect(container.textContent).toContain('Complete this request on trusted desktop.')
    expect(container.textContent).not.toContain('API_TOKEN')
  })
})
