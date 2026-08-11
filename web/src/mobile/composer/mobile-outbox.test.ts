// @vitest-environment jsdom
import { Blob as NodeBlob, File as NodeFile } from 'node:buffer'
import 'fake-indexeddb/auto'

Object.assign(globalThis, { Blob: NodeBlob, File: NodeFile })

import { afterEach, describe, expect, it } from 'vitest'

import {
  MobileOutboxError,
  createMobileOutbox,
  type MobileOutboxStore
} from './mobile-outbox'

const stores: MobileOutboxStore[] = []

function store(options?: Parameters<typeof createMobileOutbox>[0]) {
  const value = createMobileOutbox(options)
  stores.push(value)
  return value
}

afterEach(async () => {
  await Promise.all(stores.splice(0).map(value => value.destroy()))
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase('hermes-mobile-outbox-v1')
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
})

describe('MobileOutboxStore', () => {
  it('persists blob attachments across a fresh store instance in attachment order', async () => {
    const first = store()
    const operation = await first.createReady({
      attachments: [
        { blob: new NodeBlob(['first'], { type: 'text/plain' }) as unknown as Blob, lastModified: 1, name: 'first.txt', type: 'text/plain' },
        { blob: new NodeBlob(['second'], { type: 'text/plain' }) as unknown as Blob, lastModified: 2, name: 'second.txt', type: 'text/plain' }
      ],
      profile: 'default',
      storedSessionId: 'session-a',
      text: 'summarize these'
    })
    await first.close()

    const reloaded = store()
    const recovered = await reloaded.list('default', 'session-a')
    expect(recovered).toHaveLength(1)
    expect(recovered[0]).toMatchObject({ operationId: operation.operationId, state: 'READY', text: 'summarize these' })
    expect(recovered[0].attachments.map(attachment => attachment.name)).toEqual(['first.txt', 'second.txt'])
    await expect(recovered[0].attachments[0].blob.text()).resolves.toBe('first')
    await expect(recovered[0].attachments[1].blob.text()).resolves.toBe('second')
  })

  it('isolates operations by profile and durable stored session identity', async () => {
    const outbox = store()
    await outbox.createReady({ attachments: [], profile: 'alpha', storedSessionId: 'same', text: 'alpha' })
    await outbox.createReady({ attachments: [], profile: 'beta', storedSessionId: 'same', text: 'beta' })
    await outbox.createReady({ attachments: [], profile: 'alpha', storedSessionId: 'other', text: 'other' })

    await expect(outbox.list('alpha', 'same')).resolves.toMatchObject([{ text: 'alpha' }])
    await expect(outbox.list('beta', 'same')).resolves.toMatchObject([{ text: 'beta' }])
  })

  it('rejects oversize writes without silently evicting an existing operation', async () => {
    const outbox = store({ limits: { maxItemBytes: 4, maxTotalBytes: 8 } })
    await outbox.createReady({ attachments: [], profile: 'default', storedSessionId: 'session-a', text: 'ok' })

    await expect(outbox.createReady({
      attachments: [{ blob: new Blob(['12345']), lastModified: 1, name: 'too-big.txt', type: 'text/plain' }],
      profile: 'default', storedSessionId: 'session-a', text: ''
    })).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' })
    await expect(outbox.list('default', 'session-a')).resolves.toHaveLength(1)
  })

  it('fails closed for a corrupted record instead of returning or deleting it', async () => {
    const outbox = store()
    await outbox.unsafePutForTest({ operationId: 'bad', profile: 'default', storedSessionId: 'session-a', version: 999 })
    await expect(outbox.list('default', 'session-a')).rejects.toBeInstanceOf(MobileOutboxError)
    await expect(outbox.list('default', 'session-a')).rejects.toMatchObject({ code: 'CORRUPT' })
  })

  it('marks incomplete submission recovery as ambiguous and never replays it', async () => {
    const outbox = store()
    const item = await outbox.createReady({ attachments: [], profile: 'default', storedSessionId: 'session-a', text: 'do not replay' })
    await outbox.transition(item.operationId, 'SUBMITTING')
    await outbox.transition(item.operationId, 'AMBIGUOUS')

    const recovered = await outbox.list('default', 'session-a')
    expect(recovered[0].state).toBe('AMBIGUOUS')
  })

  it('persists browser File blobs used by the composer', async () => {
    const outbox = store()
    const file = new File(['browser attachment'], 'browser.txt', { type: 'text/plain' })

    await outbox.createReady({
      attachments: [{ blob: file, lastModified: file.lastModified, name: file.name, type: file.type }],
      profile: 'default', storedSessionId: 'session-a', text: ''
    })
    await expect(outbox.list('default', 'session-a')).resolves.toHaveLength(1)
  })

  it('does not reopen storage after a chat closes', async () => {
    const outbox = store()
    await outbox.list('default', 'session-a')
    await outbox.close()

    await expect(outbox.createReady({ attachments: [], profile: 'default', storedSessionId: 'session-a', text: 'late write' }))
      .rejects.toMatchObject({ code: 'UNAVAILABLE' })
  })

  it('allows initial recovery loading and a new durable send to overlap without deadlocking', async () => {
    const outbox = store()

    const [initial, created] = await Promise.all([
      outbox.list('default', 'session-a'),
      outbox.createReady({
        attachments: [{ blob: new NodeBlob(['image'], { type: 'image/png' }) as unknown as Blob, lastModified: 1, name: 'image.png', type: 'image/png' }],
        profile: 'default',
        storedSessionId: 'session-a',
        text: 'send now'
      })
    ])

    expect(initial).toEqual([])
    expect(created.text).toBe('send now')
    await expect(outbox.list('default', 'session-a')).resolves.toHaveLength(1)
  })

  it('rejects impossible state transitions without changing the saved operation', async () => {
    const outbox = store()
    const item = await outbox.createReady({ attachments: [], profile: 'default', storedSessionId: 'session-a', text: 'safe state' })

    await expect(outbox.transition(item.operationId, 'SENT')).rejects.toMatchObject({ code: 'CORRUPT' })
    await expect(outbox.list('default', 'session-a')).resolves.toMatchObject([{ state: 'READY' }])
  })
})
