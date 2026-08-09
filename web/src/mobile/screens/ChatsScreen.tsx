import { Archive, ArchiveRestore, Pin, Plus, Search, Trash2 } from 'lucide-react'
import { useCallback, useState, type FormEvent } from 'react'
import { Link } from 'react-router'

import { api, type SessionInfo } from '@/lib/api'
import type { LoadPhase } from '../types'
import { sessionLabel } from '../mobile-utils'
import { AppHeader, SessionRow } from '../ui/primitives'
import { MobileSheet } from '../ui/sheets'

export function ChatsScreen({
  archived,
  canLoadMore,
  loadMoreError,
  loadingMore,
  onArchiveViewChange,
  onLoadMore,
  onSessionsChanged,
  phase,
  profile,
  sessions
}: {
  archived: boolean
  canLoadMore: boolean
  loadMoreError: boolean
  loadingMore: boolean
  onArchiveViewChange: (archived: boolean) => void
  onLoadMore: () => void
  onSessionsChanged: () => void
  phase: LoadPhase
  profile: string
  sessions: SessionInfo[]
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SessionInfo[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [selected, setSelected] = useState<SessionInfo | null>(null)
  const [title, setTitle] = useState('')
  const [renamed, setRenamed] = useState<Record<string, string>>({})
  const [deleted, setDeleted] = useState<Set<string>>(() => new Set())
  const [updates, setUpdates] = useState<Record<string, Partial<Pick<SessionInfo, 'archived' | 'pinned'>>>>({})
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [working, setWorking] = useState(false)

  const search = useCallback(async (event: FormEvent) => {
    event.preventDefault()
    if (archived) return
    const value = query.trim()
    if (!value) {
      setResults(null)
      return
    }
    setSearching(true)
    try {
      const response = await api.searchSessions(value, { order: 'recent', profile })
      setResults(response.results)
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not search conversations.')
    } finally {
      setSearching(false)
    }
  }, [archived, profile, query])

  const rename = useCallback(async (event: FormEvent) => {
    event.preventDefault()
    const nextTitle = title.trim()
    if (!selected || !nextTitle) return
    setWorking(true)
    setActionError(null)
    try {
      await api.renameSession(selected.id, nextTitle, profile)
      setRenamed(current => ({ ...current, [selected.id]: nextTitle }))
      setSelected(null)
      onSessionsChanged()
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not rename conversation.')
    } finally {
      setWorking(false)
    }
  }, [onSessionsChanged, profile, selected, title])

  const remove = useCallback(async () => {
    if (!selected) return
    setWorking(true)
    setActionError(null)
    try {
      await api.deleteSession(selected.id, profile)
      setDeleted(current => new Set(current).add(selected.id))
      setConfirmingDelete(false)
      setSelected(null)
      onSessionsChanged()
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not delete conversation.')
    } finally {
      setWorking(false)
    }
  }, [onSessionsChanged, profile, selected])

  const updateFlag = useCallback(async (field: 'archived' | 'pinned', value: boolean) => {
    if (!selected) return
    setWorking(true)
    setActionError(null)
    try {
      await api.updateSession(selected.id, { [field]: value }, profile)
      setUpdates(current => ({
        ...current,
        [selected.id]: { ...(current[selected.id] ?? {}), [field]: value }
      }))
      setSelected(null)
      onSessionsChanged()
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not update conversation.')
    } finally {
      setWorking(false)
    }
  }, [onSessionsChanged, profile, selected])

  const visibleSessions = (results ?? sessions)
    .filter(session => !deleted.has(session.id))
    .map(session => ({
      ...session,
      ...updates[session.id],
      ...(renamed[session.id] ? { title: renamed[session.id] } : {})
    }))
    .filter(session => Boolean(session.archived) === archived)
  return (
    <>
      <AppHeader detail={
        phase === 'loading'
          ? 'Loading conversations'
          : phase === 'error'
            ? 'Conversations unavailable'
            : `${sessions.length} ${archived ? 'archived' : 'recent'} conversations`
      } />
      <main className="mobile-screen">
        <div className="mobile-page-heading">
          <div>
            <p className="mobile-eyebrow">Shared with Desktop</p>
            <h1>Chats</h1>
          </div>
          <Link className="mobile-round-action" to="/mobile/chat/new" aria-label="New chat">
            <Plus />
          </Link>
        </div>
        <div aria-label="Conversation visibility" className="mobile-session-filter" role="group">
          <button
            aria-pressed={!archived}
            className={!archived ? 'is-active' : ''}
            onClick={() => {
              setResults(null)
              setQuery('')
              setActionError(null)
              onArchiveViewChange(false)
            }}
            type="button"
          >
            Active
          </button>
          <button
            aria-label={archived ? 'View active conversations' : 'View archived conversations'}
            aria-pressed={archived}
            className={archived ? 'is-active' : ''}
            onClick={() => {
              setResults(null)
              setQuery('')
              setActionError(null)
              onArchiveViewChange(true)
            }}
            type="button"
          >
            Archived
          </button>
        </div>
        <form className="mobile-search" onSubmit={search} role="search">
          <Search aria-hidden="true" />
          <input
            aria-label="Search conversations"
            disabled={archived}
            onChange={event => {
              setQuery(event.target.value)
              if (!event.target.value) setResults(null)
            }}
            placeholder="Search conversations"
            type="search"
            value={query}
          />
          <button disabled={archived || searching || !query.trim()} type="submit">
            {searching ? 'Searching…' : 'Search'}
          </button>
        </form>
        {archived && <p className="mobile-search-note">Search is available in active conversations.</p>}
        {actionError && <div className="mobile-error" role="alert">{actionError}</div>}
        <div className="mobile-session-list">
          {phase === 'ready' && visibleSessions.map(session => (
            <SessionRow
              key={session.id}
              onActions={() => {
                setSelected(session)
                setTitle(sessionLabel(session))
                setActionError(null)
                setConfirmingDelete(false)
              }}
              session={session}
            />
          ))}
          {phase === 'loading' && <div className="mobile-empty-card" aria-busy="true">Loading conversations…</div>}
          {phase === 'error' && <div className="mobile-empty-card" role="alert">Could not load conversations.</div>}
          {phase === 'ready' && !visibleSessions.length && (
            <div className="mobile-empty-card">{results ? 'No matching conversations.' : 'No conversations yet.'}</div>
          )}
          {!results && phase === 'ready' && loadMoreError && (
            <div className="mobile-empty-card" role="alert">Could not load more conversations.</div>
          )}
          {!results && phase === 'ready' && canLoadMore && (
            <button
              aria-label="Load more conversations"
              className="mobile-load-more"
              disabled={loadingMore}
              onClick={onLoadMore}
              type="button"
            >
              {loadingMore ? 'Loading more…' : loadMoreError ? 'Try loading more' : 'Load more'}
            </button>
          )}
        </div>
      </main>
      {selected && (
        <MobileSheet ariaLabel={`Conversation actions for ${sessionLabel(selected)}`} onClose={() => setSelected(null)}>
            <div className="mobile-sheet-handle" />
            <h2>Conversation</h2>
            <form onSubmit={rename}>
              <label>
                Title
                <input aria-label="Conversation title" onChange={event => setTitle(event.target.value)} value={title} />
              </label>
              <button className="mobile-primary-button" disabled={working} type="submit">Save title</button>
            </form>
            <button
              aria-label={selected.pinned ? 'Unpin conversation' : 'Pin conversation'}
              className="mobile-sheet-action"
              disabled={working}
              onClick={() => void updateFlag('pinned', !selected.pinned)}
              type="button"
            >
              <Pin /> {selected.pinned ? 'Unpin conversation' : 'Pin conversation'}
            </button>
            <button
              aria-label={selected.archived ? 'Restore conversation' : 'Archive conversation'}
              className="mobile-sheet-action"
              disabled={working}
              onClick={() => void updateFlag('archived', !selected.archived)}
              type="button"
            >
              {selected.archived ? <ArchiveRestore /> : <Archive />} {selected.archived ? 'Restore conversation' : 'Archive conversation'}
            </button>
            {actionError && <div className="mobile-error" role="alert">{actionError}</div>}
            {!confirmingDelete ? (
              <button
                aria-label="Delete conversation"
                className="mobile-danger-button"
                disabled={working}
                onClick={() => setConfirmingDelete(true)}
                type="button"
              >
                <Trash2 /> Delete conversation
              </button>
            ) : (
              <div className="mobile-confirm-delete" role="alert">
                <p>This permanently removes the conversation from Hermes.</p>
                <button aria-label="Confirm delete conversation" className="mobile-danger-button" disabled={working} onClick={() => void remove()} type="button">
                  Delete permanently
                </button>
                <button onClick={() => setConfirmingDelete(false)} type="button">Keep conversation</button>
              </div>
            )}
            <button className="mobile-sheet-cancel" disabled={working} onClick={() => setSelected(null)} type="button">Cancel</button>
        </MobileSheet>
      )}
    </>
  )
}
