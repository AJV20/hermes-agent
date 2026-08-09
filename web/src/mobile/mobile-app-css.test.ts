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
})
