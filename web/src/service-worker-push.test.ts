import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const worker = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8')

describe('mobile Web Push service worker', () => {
  it('keeps previews opaque and ignores all payload-provided content and routing', () => {
    expect(worker).toContain('body: "Open Hermes to view this notification."')
    expect(worker).toContain('const target = "/mobile/notifications"')
    expect(worker).not.toContain('data.target')
    expect(worker).not.toContain('body: data.body')
    expect(worker).not.toContain('title: data.title')
  })

  it('navigates an existing Hermes window to the generic notification center before focusing it', () => {
    expect(worker).toContain('await existing.navigate(absolute)')
    expect(worker).toContain('return existing.focus()')
    expect(worker).toContain('self.clients.openWindow(absolute)')
  })
})
