import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const styles = readFileSync(new URL('./mobile-app.css', import.meta.url), 'utf8')

describe('mobile bottom navigation layout', () => {
  it('keeps the complete navigation compact even when iOS reports an oversized safe area', () => {
    const shell = styles.match(/\.mobile-app-shell\s*\{([^}]*)\}/)?.[1] ?? ''
    const nav = styles.match(/\.mobile-bottom-nav\s*\{([^}]*)\}/)?.[1] ?? ''
    const link = styles.match(/\.mobile-bottom-nav a\s*\{([^}]*)\}/)?.[1] ?? ''

    expect(styles).toContain('--mobile-safe-bottom: env(safe-area-inset-bottom, 0px)')
    expect(shell).toContain('position: relative')
    expect(shell).toContain('min-height: var(--mobile-app-height, 100dvh)')
    expect(shell).toContain('height: var(--mobile-app-height, 100dvh)')
    expect(nav).toContain('position: absolute')
    expect(nav).not.toContain('position: fixed')
    expect(nav).toContain('bottom: 0')
    expect(nav).toContain('height: calc(4rem + var(--mobile-safe-bottom-capped))')
    expect(nav).toContain('min-height: calc(4rem + var(--mobile-safe-bottom-capped))')
    expect(nav).toContain('padding: 0.35rem 0.45rem var(--mobile-safe-bottom-capped)')
    expect(nav).toContain('align-items: center')
    expect(nav).toContain('background: color-mix')
    expect(nav).not.toContain('pointer-events: none')
    expect(styles).not.toMatch(/\.mobile-bottom-nav::before\s*\{/)
    expect(link).toContain('height: 3.3rem')
    expect(link).toContain('align-self: center')
  })

  it('uses the same capped bottom safe area for content, navigation, and the composer', () => {
    const screen = styles.match(/\.mobile-screen\s*\{([^}]*)\}/)?.[1] ?? ''
    const nav = styles.match(/\.mobile-bottom-nav\s*\{([^}]*)\}/)?.[1] ?? ''
    const composer = styles.match(/\.mobile-composer\s*\{([^}]*)\}/)?.[1] ?? ''

    expect(styles).toContain('--mobile-safe-bottom-capped: min(var(--mobile-safe-bottom), 1rem)')
    expect(screen).toContain('var(--mobile-safe-bottom-capped)')
    expect(nav).toContain('var(--mobile-safe-bottom-capped)')
    expect(composer).toContain('var(--mobile-safe-bottom-capped)')
    expect(screen).not.toContain('env(safe-area-inset-bottom')
    expect(composer).not.toContain('env(safe-area-inset-bottom')
  })

  it('keeps compact controls at least 44 CSS pixels tall', () => {
    const iconButton = styles.match(/\.mobile-icon-button\s*\{([^}]*)\}/)?.[1] ?? ''
    const sectionLink = styles.match(/\.mobile-section-heading a\s*\{([^}]*)\}/)?.[1] ?? ''
    const resumeButton = styles.match(/\.mobile-resume-card button\s*\{([^}]*)\}/)?.[1] ?? ''
    const roundAction = styles.match(/\.mobile-round-action\s*\{([^}]*)\}/)?.[1] ?? ''
    const attachmentRemove = styles.match(/\.mobile-attachment-chip button\s*\{([^}]*)\}/)?.[1] ?? ''

    expect(iconButton).toContain('width: 3rem')
    expect(iconButton).toContain('height: 3rem')
    expect(sectionLink).toContain('min-height: 3rem')
    expect(resumeButton).toContain('min-height: 3rem')
    expect(roundAction).toContain('width: 3rem')
    expect(roundAction).toContain('height: 3rem')
    expect(attachmentRemove).toContain('width: 3rem')
    expect(attachmentRemove).toContain('height: 3rem')
  })

  it('raises Jump to latest above the attachment composer row', () => {
    const base = styles.match(/\.mobile-jump-latest\s*\{([^}]*)\}/)?.[1] ?? ''
    const withAttachments = styles.match(/\.mobile-chat-shell\.has-attachments \.mobile-jump-latest\s*\{([^}]*)\}/)?.[1] ?? ''

    expect(base).toContain('bottom: calc(5.35rem + var(--mobile-safe-bottom-capped))')
    expect(withAttachments).toContain('bottom: calc(8.6rem + var(--mobile-safe-bottom-capped))')
  })

  it('uses native iPhone interaction and bottom-sheet affordances', () => {
    const sheet = styles.match(/\.mobile-bottom-sheet\s*\{([^}]*)\}/)?.[1] ?? ''
    const backdrop = styles.match(/\.mobile-sheet-backdrop\s*\{([^}]*)\}/)?.[1] ?? ''
    const searchInput = styles.match(/\.mobile-search input\s*\{([^}]*)\}/)?.[1] ?? ''

    expect(styles).toContain('backdrop-filter: saturate(180%) blur(22px)')
    expect(styles).toContain(':focus-visible')
    expect(styles).toContain('touch-action: manipulation')
    expect(styles).toContain('transform: scale(0.97)')
    expect(sheet).toContain('border-radius: 1.5rem 1.5rem 0 0')
    expect(sheet).toContain('width: 100%')
    expect(sheet).toContain('max-width: 31rem')
    expect(backdrop).toContain('justify-content: center')
    expect(sheet).toContain('padding-bottom: calc(1rem + var(--mobile-safe-bottom-capped))')
    expect(styles).toContain('.mobile-sheet-handle')
    expect(searchInput).toContain('font-size: 1rem')
  })

  it('keeps session visibility and action-sheet controls touch sized', () => {
    const filter = styles.match(/\.mobile-session-filter\s*\{([^}]*)\}/)?.[1] ?? ''
    const filterButton = styles.match(/\.mobile-session-filter button\s*\{([^}]*)\}/)?.[1] ?? ''
    const sheetAction = styles.match(/\.mobile-sheet-action\s*\{([^}]*)\}/)?.[1] ?? ''

    expect(filter).toContain('display: grid')
    expect(filterButton).toContain('min-height: 2.75rem')
    expect(sheetAction).toContain('min-height: 2.75rem')
    expect(sheetAction).toContain('width: 100%')
  })

  it('uses two-column quick actions on very narrow phones so action labels do not wrap into cramped tiles', () => {
    expect(styles).toMatch(/@media \(max-width: 22rem\) \{[\s\S]*?\.mobile-quick-grid\s*\{[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)[\s\S]*?\.mobile-quick-action\s*\{[\s\S]*?min-height: 5\.75rem/)
  })

  it('keeps Codex quota readable and full-width when the provider returns one window', () => {
    const singleWindow = styles.match(/\.mobile-codex-quota-window:only-child\s*\{([^}]*)\}/)?.[1] ?? ''
    const refreshButton = styles.match(/\.mobile-codex-quota-icon,\s*\.mobile-codex-quota-heading button\s*\{([^}]*)\}/)?.[1] ?? ''

    expect(singleWindow).toContain('grid-column: 1 / -1')
    expect(refreshButton).toContain('height: 3rem')
  })

  it('keeps update-banner actions at least 44 CSS pixels tall with the 15px base type scale', () => {
    const updateButton = styles.match(/\.mobile-update-banner button\s*\{([^}]*)\}/)?.[1] ?? ''

    expect(updateButton).toContain('min-height: 3rem')
  })

  it('keeps chat bubbles content-sized instead of stretching short messages across iPad', () => {
    const bubble = styles.match(/\.mobile-bubble\s*\{([^}]*)\}/)?.[1] ?? ''

    expect(bubble).toContain('width: fit-content')
    expect(bubble).toContain('max-width: 90%')
  })

  it('applies synchronized viewport sizing and mobile tokens to direct chat routes', () => {
    const route = styles.match(/\.mobile-chat-route\s*\{([^}]*)\}/)?.[1] ?? ''
    const chatBlocks = [...styles.matchAll(/\.mobile-chat-shell\s*\{([^}]*)\}/g)].map(match => match[1])

    expect(styles).toMatch(/\.mobile-app-shell,\s*\.mobile-chat-route,\s*\.mobile-chat-shell\s*\{/)
    expect(route).toContain('height: var(--mobile-app-height, 100dvh)')
    expect(chatBlocks.some(chat => chat.includes('height: var(--mobile-app-height, 100dvh)'))).toBe(true)
  })

  it('keeps chat action cards readable and touch sized', () => {
    const card = styles.match(/\.mobile-action-card\s*\{([^}]*)\}/)?.[1] ?? ''
    const buttons = styles.match(/\.mobile-action-card button\s*\{([^}]*)\}/)?.[1] ?? ''
    const disclosure = styles.match(/\.mobile-action-card summary\s*\{([^}]*)\}/)?.[1] ?? ''
    const command = styles.match(/\.mobile-action-card pre\s*\{([^}]*)\}/)?.[1] ?? ''

    expect(card).toContain('padding: 1rem')
    expect(buttons).toContain('min-height: 2.75rem')
    expect(disclosure).toContain('min-height: 2.75rem')
    expect(command).toContain('overflow-x: auto')
    expect(command).toContain('white-space: pre-wrap')
  })

  it('removes all mobile interaction transitions when reduced motion is requested', () => {
    const reducedMotion = styles.match(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/)?.[1] ?? ''

    expect(reducedMotion).toContain('.mobile-app-shell *')
    expect(reducedMotion).toContain('.mobile-chat-route *')
    expect(reducedMotion).toContain('transition: none !important')
  })

  it('adapts the mobile shell, lists, chat, and sheets for iPad viewports', () => {
    const tablet = styles.match(/@media \(min-width: 48rem\) \{([\s\S]*?)\n\}/)?.[1] ?? ''

    expect(tablet).toContain('width: min(100%, 64rem)')
    expect(tablet).toContain('width: min(100%, 52rem)')
    expect(tablet).toContain('grid-template-columns: repeat(2, minmax(0, 1fr))')
    expect(tablet).toContain('.mobile-home-screen')
    expect(tablet).toContain('.mobile-session-list')
    expect(tablet).toContain('.mobile-task-list')
    expect(tablet).toContain('.mobile-notification-list')
    expect(tablet).toContain('.mobile-sheet-backdrop')
    expect(tablet).toContain('align-items: center')
    expect(tablet).toContain('border-radius: 1.5rem')
    expect(tablet).toContain('max-width: 72%')
  })
})
