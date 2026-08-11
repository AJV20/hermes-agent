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
  operationId: string
  profile: string
  state: MobileOutboxState
  storedSessionId: string
  text: string
  updatedAt: number
  version: 1
}

export interface MobileOutboxStore {
  close(): void
  createReady(input: Pick<MobileOutboxOperation, 'attachments' | 'profile' | 'storedSessionId' | 'text'>): Promise<MobileOutboxOperation>
  destroy(): Promise<void>
  list(profile: string, storedSessionId: string): Promise<MobileOutboxOperation[]>
  rekey(operationId: string, storedSessionId: string): Promise<MobileOutboxOperation>
  remove(operationId: string): Promise<void>
  replaceReady(operationId: string, input: Pick<MobileOutboxOperation, 'attachments' | 'profile' | 'storedSessionId' | 'text'>): Promise<MobileOutboxOperation>
  transition(operationId: string, state: MobileOutboxState): Promise<void>
  unsafePutForTest(value: unknown): Promise<void>
}

export class MobileOutboxError extends Error {
  readonly code: 'CORRUPT' | 'LIMIT_EXCEEDED' | 'QUOTA' | 'UNAVAILABLE'

  constructor(code: 'CORRUPT' | 'LIMIT_EXCEEDED' | 'QUOTA' | 'UNAVAILABLE', message: string) {
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
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `op-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function validState(value: unknown): value is MobileOutboxState {
  return typeof value === 'string' && ['DRAFT', 'READY', 'SUBMITTING', 'SENT', 'AMBIGUOUS', 'NEEDS_RESELECT', 'FAILED'].includes(value)
}

function isBlob(value: unknown): value is Blob {
  return Boolean(value) && typeof (value as Blob).size === 'number'
}

const ALLOWED_TRANSITIONS: Record<MobileOutboxState, readonly MobileOutboxState[]> = {
  AMBIGUOUS: ['DRAFT'],
  DRAFT: ['READY', 'NEEDS_RESELECT', 'FAILED'],
  FAILED: ['DRAFT', 'READY', 'NEEDS_RESELECT'],
  NEEDS_RESELECT: ['DRAFT'],
  READY: ['DRAFT', 'SUBMITTING', 'NEEDS_RESELECT', 'FAILED'],
  SENT: [],
  SUBMITTING: ['READY', 'SENT', 'AMBIGUOUS', 'NEEDS_RESELECT', 'FAILED']
}

function validate(value: unknown): asserts value is MobileOutboxOperation {
  const operation = value as Partial<MobileOutboxOperation>
  if (!operation || operation.version !== 1 || typeof operation.operationId !== 'string' || typeof operation.profile !== 'string'
    || typeof operation.storedSessionId !== 'string' || typeof operation.text !== 'string' || !validState(operation.state)
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
    const tx = db.transaction(STORE, 'readonly')
    const done = transactionDone(tx)
    const rows = await request(tx.objectStore(STORE).index('scope').getAll([profile, storedSessionId]))
    await done
    try {
      rows.forEach(validate)
    } catch (error) {
      if (error instanceof MobileOutboxError) throw error
      throw new MobileOutboxError('CORRUPT', 'A saved message could not be validated. It was not changed.')
    }
    const recoverable = rows.filter(operation => operation.state !== 'SENT').sort((a, b) => a.createdAt - b.createdAt)
    await Promise.all(recoverable.filter(operation => operation.state === 'SUBMITTING').map(async operation => {
      await transition(operation.operationId, 'AMBIGUOUS')
      operation.state = 'AMBIGUOUS'
      operation.updatedAt = Date.now()
    }))
    return recoverable
  }

  const createReady = async (input: Pick<MobileOutboxOperation, 'attachments' | 'profile' | 'storedSessionId' | 'text'>) => {
    const now = Date.now()
    const operation: MobileOutboxOperation = { ...input, createdAt: now, operationId: operationId(), state: 'READY', updatedAt: now, version: 1 }
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

  const transition = async (id: string, state: MobileOutboxState) => {
    const db = await open()
    const tx = db.transaction(STORE, 'readwrite')
    const done = transactionDone(tx)
    const store = tx.objectStore(STORE)
    const operation = await request(store.get(id))
    validate(operation)
    if (!ALLOWED_TRANSITIONS[operation.state].includes(state)) {
      tx.abort()
      await done.catch(() => undefined)
      throw new MobileOutboxError('CORRUPT', `Cannot transition a saved message from ${operation.state} to ${state}.`)
    }
    store.put({ ...operation, state, updatedAt: Date.now() })
    await done
  }

  const rewrite = async (
    id: string,
    update: (operation: MobileOutboxOperation) => MobileOutboxOperation
  ) => {
    const db = await open()
    const tx = db.transaction(STORE, 'readwrite')
    const done = transactionDone(tx)
    const store = tx.objectStore(STORE)
    const operation = await request(store.get(id))
    validate(operation)
    const rewritten = update(operation)
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

  return {
    close: () => {
      closed = true
      if (openedDatabase) openedDatabase.close()
      else if (database) void database.then(value => value.close(), () => undefined)
      openedDatabase = null
      database = null
    },
    createReady,
    destroy: async () => {
      closed = true
      if (openedDatabase) openedDatabase.close()
      else if (database) (await database).close()
      openedDatabase = null
      database = null
    },
    list,
    rekey: (id, storedSessionId) => rewrite(id, operation => ({
      ...operation,
      storedSessionId,
      updatedAt: Date.now()
    })),
    remove: async id => {
      const db = await open()
      const tx = db.transaction(STORE, 'readwrite')
      const done = transactionDone(tx)
      tx.objectStore(STORE).delete(id)
      await done
    },
    replaceReady: (id, input) => rewrite(id, operation => {
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
