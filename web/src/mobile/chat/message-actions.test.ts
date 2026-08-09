import { describe, expect, it, vi } from 'vitest'

import { shareMessageText } from './message-actions'

describe('shareMessageText', () => {
  it('uses native share when available', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    const copy = vi.fn()

    await expect(shareMessageText('Share this', { copy, share })).resolves.toBe('shared')
    expect(share).toHaveBeenCalledWith({ text: 'Share this' })
    expect(copy).not.toHaveBeenCalled()
  })

  it('falls back to clipboard when native share fails', async () => {
    const share = vi.fn().mockRejectedValue(new Error('share failed'))
    const copy = vi.fn().mockResolvedValue(true)

    await expect(shareMessageText('Share this', { copy, share })).resolves.toBe('copied')
    expect(copy).toHaveBeenCalledWith('Share this')
  })

  it('treats a dismissed native share sheet as benign without copying', async () => {
    const share = vi.fn().mockRejectedValue(new DOMException('Dismissed', 'AbortError'))
    const copy = vi.fn()

    await expect(shareMessageText('Share this', { copy, share })).resolves.toBe('dismissed')
    expect(copy).not.toHaveBeenCalled()
  })
})
