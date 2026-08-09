export type MobileAttachmentStatus = 'selected' | 'reading' | 'uploading' | 'staged' | 'failed' | 'canceled'

export interface MobileAttachment {
  error?: string
  file: File
  id: string
  previewUrl?: string
  status: MobileAttachmentStatus
}

function canCreateObjectUrl(): boolean {
  return typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function'
}

export function createMobileAttachment(file: File, id: string): MobileAttachment {
  return {
    file,
    id,
    previewUrl: file.type.startsWith('image/') && canCreateObjectUrl() ? URL.createObjectURL(file) : undefined,
    status: 'selected'
  }
}

export function revokeAttachmentPreview(attachment: Pick<MobileAttachment, 'previewUrl'>) {
  if (attachment.previewUrl && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
    URL.revokeObjectURL(attachment.previewUrl)
  }
}
