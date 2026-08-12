import { describe, expect, it } from 'vitest'

import { routeTab } from './mobile-utils'

describe('mobile route tabs', () => {
  it('keeps Push settings inside the More route', () => {
    expect(routeTab('/mobile/push')).toBe('more')
  })
})
