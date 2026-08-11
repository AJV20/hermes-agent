import { describe, expect, it } from 'vitest'

import { buildTodayCards } from './today-feed'

describe('buildTodayCards', () => {
  it('prioritizes failure notices, disconnected status, actionable tasks, then a resumable chat', () => {
    const cards = buildTodayCards({
      cronJobs: [
        { id: 'failed', enabled: true, last_status: 'failed', name: 'Verify backup' },
        { id: 'later', enabled: true, name: 'Daily briefing' }
      ],
      notifications: [
        { id: 'read', level: 'success', read_at: 1, title: 'Finished' },
        { id: 'error', level: 'error', read_at: null, title: 'Backup failed' },
        { id: 'unread', level: 'info', read_at: null, title: 'Review available' }
      ],
      sessions: [{ id: 'chat-1', is_active: false, title: 'Deployment notes' }],
      status: { gateway_running: false, gateway_state: 'stopped' }
    })

    expect(cards.map(card => card.id)).toEqual(['notifications', 'connection', 'tasks', 'continue'])
    expect(cards[0]).toMatchObject({ count: 2, tone: 'danger' })
    expect(cards[1]).toMatchObject({ tone: 'warning' })
    expect(cards[2]).toMatchObject({ count: 1, tone: 'warning' })
  })

  it('honors a valid visible-card order without inventing unavailable cards', () => {
    const cards = buildTodayCards({
      cronJobs: [],
      notifications: [],
      sessions: [{ id: 'chat-1', is_active: false, title: 'Deployment notes' }],
      status: { gateway_running: true, gateway_state: 'running' },
      preferences: {
        cardOrder: ['continue', 'tasks', 'notifications', 'connection'],
        hiddenCards: ['connection'],
        textSize: 'normal',
        density: 'comfortable'
      }
    })

    expect(cards.map(card => card.id)).toEqual(['continue'])
  })
})
