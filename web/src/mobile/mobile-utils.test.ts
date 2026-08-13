import { describe, expect, it } from 'vitest'

import { routeTab } from './mobile-utils'

describe('mobile route tabs', () => {
  it('keeps mobile settings screens inside the More route', () => {
    expect(routeTab('/mobile/push')).toBe('more')
    expect(routeTab('/mobile/models')).toBe('more')
  })
})
