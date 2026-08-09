import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const styles = readFileSync(new URL('./mobile-app.css', import.meta.url), 'utf8')

describe('mobile bottom navigation layout', () => {
  it('caps anomalously large iOS safe-area values', () => {
    const rule = styles.match(/\.mobile-bottom-nav\s*\{([^}]*)\}/)?.[1] ?? ''
    const cappedInset = 'min(env(safe-area-inset-bottom, 0px), 1rem)'

    expect(rule).toContain(`min-height: calc(4rem + ${cappedInset})`)
    expect(rule).toContain(`padding: 0.35rem 0.45rem ${cappedInset}`)
  })
})
