import { describe, expect, it } from 'vitest'

import { authorizeMseControlPayload } from './mse-main-relay'

describe('MSE main relay authorization', () => {
  it('mse.relay-forgery', () => {
    const resolveResourceKey = (_tabId: string, resourceKey: string) => (
      resourceKey === 'mse-stream:owned' ? resourceKey : null
    )
    const base = {
      base64: 'AQID',
      event: 'mse-flush',
      resourceKey: 'mse-stream:owned',
      tabId: 'tab-current',
    }

    expect(authorizeMseControlPayload({
      payload: { ...base, resourceKey: 'mse-stream:other' },
      resolveResourceKey,
      tabId: base.tabId,
    })).toBeNull()
    expect(authorizeMseControlPayload({
      payload: { ...base, event: 'forged-event' },
      resolveResourceKey,
      tabId: base.tabId,
    })).toBeNull()
    expect(authorizeMseControlPayload({
      payload: { ...base, base64: 'not base64!' },
      resolveResourceKey,
      tabId: base.tabId,
    })).toBeNull()
    expect(authorizeMseControlPayload({
      payload: { event: 'mse-reset', resourceKey: base.resourceKey },
      resolveResourceKey,
      tabId: base.tabId,
    })).toMatchObject({
      event: 'mse-reset',
      resourceKey: base.resourceKey,
    })
    expect(authorizeMseControlPayload({
      payload: { event: 'mse-complete', resourceKey: base.resourceKey },
      resolveResourceKey,
      tabId: base.tabId,
    })).toMatchObject({
      event: 'mse-complete',
      resourceKey: base.resourceKey,
    })
    expect(authorizeMseControlPayload({
      payload: { event: 'mse-save', resourceKey: base.resourceKey, streamType: 'video' },
      resolveResourceKey,
      tabId: base.tabId,
    })).toMatchObject({
      event: 'mse-save',
      resourceKey: base.resourceKey,
      streamType: 'video',
    })
    expect(authorizeMseControlPayload({
      payload: base,
      resolveResourceKey,
      tabId: base.tabId,
    })).toMatchObject({
      base64: base.base64,
      event: base.event,
      resourceKey: base.resourceKey,
    })
  })
})
