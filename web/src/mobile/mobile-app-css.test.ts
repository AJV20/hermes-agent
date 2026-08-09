import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const styles = readFileSync(new URL('./mobile-app.css', import.meta.url), 'utf8')

describe('mobile bottom navigation layout', () => {
  it('renders compact controls and chrome at the bottom of the full iOS safe area', () => {
    const shell = styles.match(/\.mobile-app-shell\s*\{([^}]*)\}/)?.[1] ?? ''
    const nav = styles.match(/\.mobile-bottom-nav\s*\{([^}]*)\}/)?.[1] ?? ''
    const chrome = styles.match(/\.mobile-bottom-nav::before\s*\{([^}]*)\}/)?.[1] ?? ''
    const link = styles.match(/\.mobile-bottom-nav a\s*\{([^}]*)\}/)?.[1] ?? ''

    expect(styles).toContain('--mobile-safe-bottom: env(safe-area-inset-bottom, 0px)')
    expect(shell).toContain('min-height: 100vh')
    expect(shell).toContain('min-height: 100dvh')
    expect(shell).toContain('height: auto')
    expect(shell).toContain('overflow: visible')
    expect(nav).toContain('bottom: 0')
    expect(nav).toContain('min-height: calc(4rem + var(--mobile-safe-bottom))')
    expect(nav).toContain('padding: 0.35rem 0.45rem min(var(--mobile-safe-bottom), 1rem)')
    expect(nav).toContain('align-items: end')
    expect(nav).toContain('pointer-events: none')
    expect(chrome).toContain('height: calc(4rem + min(var(--mobile-safe-bottom), 1rem))')
    expect(link).toContain('height: 3.3rem')
    expect(link).toContain('pointer-events: auto')
  })
})
