import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const styles = readFileSync(new URL('./mobile-app.css', import.meta.url), 'utf8')

describe('mobile bottom navigation layout', () => {
  it('extends through oversized iOS bottom insets while retaining a compact margin', () => {
    const rule = styles.match(/\.mobile-bottom-nav\s*\{([^}]*)\}/)?.[1] ?? ''
    const inset = 'env(safe-area-inset-bottom, 0px)'
    const retainedMargin = `min(${inset}, 1rem)`

    expect(rule).toContain(`bottom: calc(${retainedMargin} - ${inset})`)
    expect(rule).toContain('min-height: 4rem')
    expect(rule).toContain('padding: 0.35rem 0.45rem')
  })
})
