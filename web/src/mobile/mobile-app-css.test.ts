import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const styles = readFileSync(new URL('./mobile-app.css', import.meta.url), 'utf8')

describe('mobile bottom navigation layout', () => {
  it('keeps the complete navigation compact even when iOS reports an oversized safe area', () => {
    const shell = styles.match(/\.mobile-app-shell\s*\{([^}]*)\}/)?.[1] ?? ''
    const nav = styles.match(/\.mobile-bottom-nav\s*\{([^}]*)\}/)?.[1] ?? ''
    const link = styles.match(/\.mobile-bottom-nav a\s*\{([^}]*)\}/)?.[1] ?? ''

    expect(styles).toContain('--mobile-safe-bottom: env(safe-area-inset-bottom, 0px)')
    expect(shell).toContain('min-height: var(--mobile-app-height, 100dvh)')
    expect(shell).toContain('height: var(--mobile-app-height, 100dvh)')
    expect(nav).toContain('bottom: 0')
    expect(nav).toContain('height: calc(4rem + min(var(--mobile-safe-bottom), 1rem))')
    expect(nav).toContain('min-height: calc(4rem + min(var(--mobile-safe-bottom), 1rem))')
    expect(nav).toContain('padding: 0.35rem 0.45rem min(var(--mobile-safe-bottom), 1rem)')
    expect(nav).toContain('align-items: center')
    expect(nav).toContain('background: color-mix')
    expect(nav).not.toContain('pointer-events: none')
    expect(styles).not.toMatch(/\.mobile-bottom-nav::before\s*\{/)
    expect(link).toContain('height: 3.3rem')
    expect(link).toContain('align-self: center')
  })

  it('keeps compact controls at least 44 CSS pixels tall', () => {
    const iconButton = styles.match(/\.mobile-icon-button\s*\{([^}]*)\}/)?.[1] ?? ''
    const sectionLink = styles.match(/\.mobile-section-heading a\s*\{([^}]*)\}/)?.[1] ?? ''
    const resumeButton = styles.match(/\.mobile-resume-card button\s*\{([^}]*)\}/)?.[1] ?? ''
    const roundAction = styles.match(/\.mobile-round-action\s*\{([^}]*)\}/)?.[1] ?? ''

    expect(iconButton).toContain('width: 3rem')
    expect(iconButton).toContain('height: 3rem')
    expect(sectionLink).toContain('min-height: 3rem')
    expect(resumeButton).toContain('min-height: 3rem')
    expect(roundAction).toContain('width: 3rem')
    expect(roundAction).toContain('height: 3rem')
  })
})
