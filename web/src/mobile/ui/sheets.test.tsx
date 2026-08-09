// @vitest-environment jsdom
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { MobileSheet } from './sheets'

let container: HTMLDivElement
let root: Root

function Harness() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button onClick={() => setOpen(true)} type="button">Open actions</button>
      {open && (
        <MobileSheet ariaLabel="Test actions" onClose={() => setOpen(false)}>
          <button type="button">First action</button>
          <button type="button">Last action</button>
        </MobileSheet>
      )}
    </>
  )
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  document.body.style.overflow = ''
})

async function openSheet() {
  await act(async () => root.render(<Harness />))
  const trigger = container.querySelector('button') as HTMLButtonElement
  trigger.focus()
  await act(async () => trigger.click())
  return trigger
}

describe('MobileSheet', () => {
  it('focuses the first action, closes on Escape, and restores trigger focus', async () => {
    const trigger = await openSheet()
    const actions = container.querySelectorAll('.mobile-bottom-sheet button')

    expect(document.activeElement).toBe(actions[0])
    expect(document.body.style.overflow).toBe('hidden')
    await act(async () => {
      document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }))
    })

    expect(container.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement).toBe(trigger)
    expect(document.body.style.overflow).toBe('')
  })

  it('keeps keyboard focus inside the sheet', async () => {
    await openSheet()
    const actions = container.querySelectorAll('.mobile-bottom-sheet button')
    ;(actions[actions.length - 1] as HTMLButtonElement).focus()
    document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Tab' }))
    expect(document.activeElement).toBe(actions[0])

    ;(actions[0] as HTMLButtonElement).focus()
    document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Tab', shiftKey: true }))
    expect(document.activeElement).toBe(actions[actions.length - 1])
  })
})
