// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createMobileAttachment,
  revokeAttachmentPreview,
  type MobileAttachment
} from './attachment-state'

describe('mobile attachment state', () => {
  afterEach(() => vi.restoreAllMocks())

  it('creates an object URL preview for selected images and revokes it when discarded', () => {
    const createObjectURL = vi.fn(() => 'blob:photo-preview')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL })
    const image = new File(['image'], 'photo.png', { type: 'image/png' })

    const attachment = createMobileAttachment(image, 'photo-1')
    revokeAttachmentPreview(attachment)

    expect(attachment).toMatchObject({ id: 'photo-1', previewUrl: 'blob:photo-preview', status: 'selected' })
    expect(createObjectURL).toHaveBeenCalledWith(image)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:photo-preview')
  })

  it('does not create previews for non-images and reports failed uploads without dropping the file', () => {
    const createObjectURL = vi.fn()
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL: vi.fn() })
    const file = new File(['report'], 'report.txt', { type: 'text/plain' })

    const attachment: MobileAttachment = {
      ...createMobileAttachment(file, 'report-1'),
      error: 'upload failed',
      status: 'failed'
    }

    expect(attachment.file).toBe(file)
    expect(attachment.previewUrl).toBeUndefined()
    expect(attachment.status).toBe('failed')
    expect(attachment.error).toBe('upload failed')
    expect(createObjectURL).not.toHaveBeenCalled()
  })
})
