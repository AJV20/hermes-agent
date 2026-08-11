export type MobileOutboxState = 'DRAFT' | 'READY' | 'SUBMITTING' | 'SENT' | 'AMBIGUOUS' | 'NEEDS_RESELECT' | 'FAILED'

export interface StoredMobileAttachment {
  blob: Blob
  lastModified: number
  name: string
  type: string
}

export interface MobileOutboxOperation {
  attachments: StoredMobileAttachment[]
  createdAt: number
  leaseExpiresAt?: number | null
  operationId: string
  ownerId?: string | null
  profile: string
  revision: number
  state: MobileOutboxState
  storedSessionId: string
  text: string
  updatedAt: number
  version: 1
}

export interface MobileOutboxStore {
  claim(operationId: string, expectedRevision: number, ownerId: string, leaseMs?: number): Promise<MobileOutboxOperation>
  close(): void
  complete(operationId: string, expectedRevision: number, ownerId: string): Promise<void>
  createReady(input: Pick<MobileOutboxOperation, 'attachments' | 'profile' | 'storedSessionId' | 'text'>): Promise<MobileOutboxOperation>
  destroy(): Promise<void>
  failClaim(operationId: string, expectedRevision: number, ownerId: string, state: 'READY' | 'AMBIGUOUS' | 'FAILED'): Promise<MobileOutboxOperation>
  list(profile: string, storedSessionId: string): Promise<MobileOutboxOperation[]>
  rekey(operationId: string, expectedRevision: number, storedSessionId: string, ownerId?: string): Promise<MobileOutboxOperation>
  remove(operationId: string, expectedRevision: number, ownerId?: string): Promise<void>
  replaceReady(operationId: string, expectedRevision: number, input: Pick<MobileOutboxOperation, 'attachments' | 'profile' | 'storedSessionId' | 'text'>): Promise<MobileOutboxOperation>
  transition(operationId: string, expectedRevision: number, state: MobileOutboxState): Promise<void>
  unsafePutForTest(value: unknown): Promise<void>
}

export class MobileOutboxError extends Error {
  readonly code: 'CONFLICT' | 'CORRUPT' | 'LIMIT_EXCEEDED' | 'QUOTA' | 'UNAVAILABLE'

  constructor(code: 'CONFLICT' | 'CORRUPT' | 'LIMIT_EXCEEDED' | 'QUOTA' | 'UNAVAILABLE', message: string) {
    super(message)
    this.code = code
    this.name = 'MobileOutboxError'
  }
}

const DB_NAME = 'hermes-mobile-outbox-v1'
const STORE = 'operations'
const MAX_ITEM_BYTES = 50 * 1024 * 1024
const MAX_TOTAL_BYTES = 200 * 1024 * 1024

function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result)
    value.onerror = () => reject(value.error)
  })
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onabort = () => reject(transaction.error)
    transaction.onerror = () => reject(transaction.error)
  })
}

function byteSize(operation: Pick<MobileOutboxOperation, 'attachments' | 'text'>): number {
  return new TextEncoder().encode(operation.text).byteLength + operation.attachments.reduce((total, item) => total + item.blob.size, 0)
}

function operationId(): string {
  if (typeof crypto === 'undefined') throw new MobileOutboxError('UNAVAILABLE', 'Secure offline recovery is unavailable in this browser.')
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  if (typeof crypto.getRandomValues !== 'function') throw new MobileOutboxError('UNAVAILABLE', 'Secure offline recovery is unavailable in this browser.')
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function validState(value: unknown): value is MobileOutboxState {
  return typeof value === 'string' && ['DRAFT', 'READY', 'SUBMITTING', 'SENT', 'AMBIGUOUS', 'NEEDS_RESELECT', 'FAILED'].includes(value)
}

function isBlob(value: unknown): value is Blob {
  // IndexedDB returns structured-cloned Blobs in the current realm. A numeric
  // `size` property is not sufficient: accepting a plain object would let a
  // corrupt attachment be silently string-coerced into different bytes.
  return typeof Blob !== 'undefined' && value instanceof Blob
}

const ALLOWED_TRANSITIONS: Record<MobileOutboxState, readonly MobileOutboxState[]> = {
  AMBIGUOUS: ['DRAFT'],
  DRAFT: ['READY', 'NEEDS_RESELECT', 'FAILED'],
  FAILED: ['DRAFT', 'READY', 'NEEDS_RESELECT'],
  NEEDS_RESELECT: ['DRAFT'],
  READY: ['DRAFT', 'NEEDS_RESELECT', 'FAILED'],
  SENT: [],
  SUBMITTING: []
}

function validate(value: unknown): asserts value is MobileOutboxOperation {
  const operation = value as Partial<MobileOutboxOperation>
  if (!operation || operation.version !== 1 || typeof operation.operationId !== 'string' || typeof operation.profile !== 'string'
    || typeof operation.storedSessionId !== 'string' || typeof operation.text !== 'string' || !validState(operation.state)
    || !Number.isInteger(operation.revision) || (operation.revision ?? 0) < 1
    || (operation.ownerId != null && typeof operation.ownerId !== 'string')
    || (operation.leaseExpiresAt != null && (!Number.isFinite(operation.leaseExpiresAt) || operation.leaseExpiresAt <= 0))
    || (operation.state === 'SUBMITTING'
      ? !operation.ownerId || operation.leaseExpiresAt == null
      : operation.ownerId != null || operation.leaseExpiresAt != null)
    || !Array.isArray(operation.attachments) || !operation.attachments.every(item => item && isBlob(item.blob)
      && typeof item.name === 'string' && typeof item.type === 'string' && typeof item.lastModified === 'number')) {
    throw new MobileOutboxError('CORRUPT', 'A saved message could not be validated. It was not changed.')
  }
}

export function createMobileOutbox(options: { limits?: { maxItemBytes?: number; maxTotalBytes?: number } } = {}): MobileOutboxStore {
  const maxItemBytes = options.limits?.maxItemBytes ?? MAX_ITEM_BYTES
  const maxTotalBytes = options.limits?.maxTotalBytes ?? MAX_TOTAL_BYTES
  let database: Promise<IDBDatabase> | null = null
  let openedDatabase: IDBDatabase | null = null
  let closed = false

  const open = () => {
    if (closed) return Promise.reject(new MobileOutboxError('UNAVAILABLE', 'Offline recovery is no longer available for this chat.'))
    if (database) return database
    if (typeof indexedDB === 'undefined') return Promise.reject(new MobileOutboxError('UNAVAILABLE', 'Offline saving is unavailable in this browser.'))
    database = new Promise((resolve, reject) => {
      const openRequest = indexedDB.open(DB_NAME, 1)
      openRequest.onupgradeneeded = () => {
        const db = openRequest.result
        const store = db.objectStoreNames.contains(STORE) ? openRequest.transaction!.objectStore(STORE) : db.createObjectStore(STORE, { keyPath: 'operationId' })
        if (!store.indexNames.contains('scope')) store.createIndex('scope', ['profile', 'storedSessionId'])
      }
      openRequest.onsuccess = () => {
        if (closed) {
          openRequest.result.close()
          reject(new MobileOutboxError('UNAVAILABLE', 'Offline recovery is no longer available for this chat.'))
          return
        }
        openedDatabase = openRequest.result
        resolve(openRequest.result)
      }
      openRequest.onerror = () => reject(new MobileOutboxError('UNAVAILABLE', 'Offline saving could not be opened.'))
    })
    return database
  }

  const list = async (profile: string, storedSessionId: string) => {
    const db = await open()
    const tx = db.transaction(STORE, 'readwrite')
    const done = transactionDone(tx)
    const store = tx.objectStore(STORE)
    const rows = await request(store.index('scope').getAll([profile, storedSessionId]))
    try {
      rows.forEach(validate)
    } catch (error) {
      tx.abort()
      await done.catch(() => undefined)
      if (error instanceof MobileOutboxError) throw error
      throw new MobileOutboxError('CORRUPT', 'A saved message could not be validated. It was not changed.')
    }
    const now = Date.now()
    const recoverable: MobileOutboxOperation[] = []
    for (const operation of rows.sort((a, b) => a.createdAt - b.createdAt)) {
      if (operation.state === 'SENT') continue
      if (operation.state === 'SUBMITTING') {
        if ((operation.leaseExpiresAt ?? 0) > now) continue
        const expired: MobileOutboxOperation = {
          ...operation,
          leaseExpiresAt: null,
          ownerId: null,
          revision: operation.revision + 1,
          state: 'AMBIGUOUS',
          updatedAt: now
        }
        store.put(expired)
        recoverable.push(expired)
        continue
      }
      recoverable.push(operation)
    }
    await done
    return recoverable
  }

  const createReady = async (input: Pick<MobileOutboxOperation, 'attachments' | 'profile' | 'storedSessionId' | 'text'>) => {
    const now = Date.now()
    const operation: MobileOutboxOperation = { ...input, createdAt: now, operationId: operationId(), revision: 1, state: 'READY', updatedAt: now, version: 1 }
    validate(operation)
    if (byteSize(operation) > maxItemBytes) throw new MobileOutboxError('LIMIT_EXCEEDED', 'This message is too large to save for reload.')
    const db = await open()
    const tx = db.transaction(STORE, 'readwrite')
    const done = transactionDone(tx)
    const store = tx.objectStore(STORE)
    try {
      const existing = await request(store.getAll())
      existing.forEach(validate)
      if (existing.reduce((total, item) => total + byteSize(item), 0) + byteSize(operation) > maxTotalBytes) {
        tx.abort()
        await done.catch(() => undefined)
        throw new MobileOutboxError('LIMIT_EXCEEDED', 'Offline outbox storage is full. Nothing was removed.')
      }
      store.put(operation)
      await done
      return operation
    } catch (error) {
      if (error instanceof MobileOutboxError) throw error
      if (error instanceof DOMException && error.name === 'QuotaExceededError') throw new MobileOutboxError('QUOTA', 'Offline storage is full. Your composer was not cleared.')
      throw error
    }
  }

  const transition = async (id: string, expectedRevision: number, state: MobileOutboxState) => {
    const db = await open()
    const tx = db.transaction(STORE, 'readwrite')
    const done = transactionDone(tx)
    const store = tx.objectStore(STORE)
    const operation = await request(store.get(id))
    validate(operation)
    if (operation.revision !== expectedRevision) {
      tx.abort()
      await done.catch(() => undefined)
      throw new MobileOutboxError('CONFLICT', 'This saved message changed in another tab. Review the latest version.')
    }
    if (!ALLOWED_TRANSITIONS[operation.state].includes(state)) {
      tx.abort()
      await done.catch(() => undefined)
      throw new MobileOutboxError('CORRUPT', `Cannot transition a saved message from ${operation.state} to ${state}.`)
    }
    store.put({ ...operation, revision: operation.revision + 1, state, updatedAt: Date.now() })
    await done
  }

  const rewrite = async (
    id: string,
    expectedRevision: number,
    update: (operation: MobileOutboxOperation) => MobileOutboxOperation
  ) => {
    const db = await open()
    const tx = db.transaction(STORE, 'readwrite')
    const done = transactionDone(tx)
    const store = tx.objectStore(STORE)
    const operation = await request(store.get(id))
    validate(operation)
    if (operation.revision !== expectedRevision) {
      tx.abort()
      await done.catch(() => undefined)
      throw new MobileOutboxError('CONFLICT', 'This saved message changed in another tab. Review the latest version.')
    }
    const candidate = update(operation)
    const rewritten = { ...candidate, revision: operation.revision + 1 }
    validate(rewritten)
    const existing = await request(store.getAll())
    existing.forEach(validate)
    const otherBytes = existing
      .filter(item => item.operationId !== id)
      .reduce((total, item) => total + byteSize(item), 0)
    if (byteSize(rewritten) > maxItemBytes || otherBytes + byteSize(rewritten) > maxTotalBytes) {
      tx.abort()
      await done.catch(() => undefined)
      throw new MobileOutboxError('LIMIT_EXCEEDED', 'This message is too large to save for reload.')
    }
    store.put(rewritten)
    await done
    return rewritten
  }

  const claim = (id: string, expectedRevision: number, ownerId: string, leaseMs = 31 * 60 * 1000) => rewrite(id, expectedRevision, operation => {
    if (!ownerId || !['READY', 'AMBIGUOUS', 'FAILED', 'DRAFT'].includes(operation.state)) {
      throw new MobileOutboxError('CORRUPT', 'This saved message is already owned by another send.')
    }
    const now = Date.now()
    return { ...operation, leaseExpiresAt: now + Math.max(1, leaseMs), ownerId, state: 'SUBMITTING', updatedAt: now }
  })

  const failClaim = (id: string, expectedRevision: number, ownerId: string, state: 'READY' | 'AMBIGUOUS' | 'FAILED') => rewrite(id, expectedRevision, operation => {
    if (operation.state !== 'SUBMITTING' || operation.ownerId !== ownerId) {
      throw new MobileOutboxError('CORRUPT', 'This saved message is owned by another send.')
    }
    return { ...operation, leaseExpiresAt: null, ownerId: null, state, updatedAt: Date.now() }
  })

  const complete = async (id: string, expectedRevision: number, ownerId: string) => {
    const db = await open()
    const tx = db.transaction(STORE, 'readwrite')
    const done = transactionDone(tx)
    const store = tx.objectStore(STORE)
    const operation = await request(store.get(id))
    validate(operation)
    if (operation.revision !== expectedRevision) {
      tx.abort()
      await done.catch(() => undefined)
      throw new MobileOutboxError('CONFLICT', 'This saved message changed in another tab. Review the latest version.')
    }
    if (operation.state !== 'SUBMITTING' || operation.ownerId !== ownerId) {
      tx.abort()
      await done.catch(() => undefined)
      throw new MobileOutboxError('CORRUPT', 'This saved message is owned by another send.')
    }
    store.delete(id)
    await done
  }

  const remove = async (id: string, expectedRevision: number, ownerId?: string) => {
    const db = await open()
    const tx = db.transaction(STORE, 'readwrite')
    const done = transactionDone(tx)
    const store = tx.objectStore(STORE)
    const operation = await request(store.get(id))
    if (operation === undefined) {
      tx.abort()
      await done.catch(() => undefined)
      throw new MobileOutboxError('CONFLICT', 'This saved message changed in another tab. Review the latest version.')
    }
    validate(operation)
    if (operation.revision !== expectedRevision) {
      tx.abort()
      await done.catch(() => undefined)
      throw new MobileOutboxError('CONFLICT', 'This saved message changed in another tab. Review the latest version.')
    }
    if (operation.state === 'SUBMITTING' && operation.ownerId !== ownerId) {
      tx.abort()
      await done.catch(() => undefined)
      throw new MobileOutboxError('CORRUPT', 'This saved message is owned by another send.')
    }
    store.delete(id)
    await done
  }

  return {
    claim,
    close: () => {
      closed = true
      if (openedDatabase) openedDatabase.close()
      else if (database) void database.then(value => value.close(), () => undefined)
      openedDatabase = null
      database = null
    },
    complete,
    createReady,
    destroy: async () => {
      closed = true
      if (openedDatabase) openedDatabase.close()
      else if (database) (await database).close()
      openedDatabase = null
      database = null
    },
    failClaim,
    list,
    rekey: (id, expectedRevision, storedSessionId, ownerId) => rewrite(id, expectedRevision, operation => {
      if (operation.state === 'SUBMITTING' && operation.ownerId !== ownerId) {
        throw new MobileOutboxError('CORRUPT', 'This saved message is owned by another send.')
      }
      return {
        ...operation,
        storedSessionId,
        updatedAt: Date.now()
      }
    }),
    remove,
    replaceReady: (id, expectedRevision, input) => rewrite(id, expectedRevision, operation => {
      if (!['READY', 'AMBIGUOUS', 'FAILED', 'DRAFT'].includes(operation.state)
        || operation.profile !== input.profile || operation.storedSessionId !== input.storedSessionId) {
        throw new MobileOutboxError('CORRUPT', 'This saved message is already owned by another send or scope.')
      }
      return {
        ...operation,
        ...input,
        state: 'READY',
        updatedAt: Date.now()
      }
    }),
    transition,
    unsafePutForTest: async value => {
      const db = await open()
      const tx = db.transaction(STORE, 'readwrite')
      const done = transactionDone(tx)
      tx.objectStore(STORE).put(value)
      await done
    }
  }
}
