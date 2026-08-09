import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const styles = readFileSync(new URL('./mobile-app.css', import.meta.url), 'utf8')

describe('mobile bottom navigation layout', () => {
  it('includes safe-area padding inside its declared minimum height', () => {
    const rule = styles.match(/\.mobile-bottom-nav\s*\{([^}]*)\}/)?.[1] ?? ''

    expect(rule).toContain('min-height: calc(4rem + env(safe-area-inset-bottom, 0px))')
    expect(rule).toContain('box-sizing: border-box')
  })
})
