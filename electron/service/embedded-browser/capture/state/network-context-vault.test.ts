import { describe, expect, it } from 'vitest'

import {
  NetworkContextVault,
  type NetworkContextInvalidation,
  type NetworkContextPurpose,
  type NetworkContextRedemptionInput,
  type PromoteNetworkRequestInput,
  type RecordNetworkRequestInput,
} from './network-context-vault'

const BASE_PAGE_URL = 'https://page.example/watch/one'
const BASE_REQUEST: Omit<RecordNetworkRequestInput, 'requestHeaders'> = {
  navigationGeneration: 7,
  observedRequestUrl: 'https://media.example/video.mp4?token=public-id',
  pageOrigin: 'https://page.example',
  requestId: 'request-1',
  sourceResourceType: 'xhr',
  tabId: 'tab-1',
  webContentsId: 41,
}

const BASE_PROMOTE: Omit<PromoteNetworkRequestInput, 'purposes'> = {
  navigationGeneration: BASE_REQUEST.navigationGeneration,
  observedRequestUrl: BASE_REQUEST.observedRequestUrl,
  requestId: BASE_REQUEST.requestId,
  resourceUrl: BASE_REQUEST.observedRequestUrl,
  sourceResourceType: BASE_REQUEST.sourceResourceType,
  tabId: BASE_REQUEST.tabId,
  webContentsId: BASE_REQUEST.webContentsId,
}

const BASE_REDEMPTION: Omit<NetworkContextRedemptionInput, 'contextRef' | 'purpose'> = {
  navigationGeneration: BASE_REQUEST.navigationGeneration,
  pageOrigin: BASE_REQUEST.pageOrigin,
  replayResourceType: 'media',
  resourceUrl: BASE_REQUEST.observedRequestUrl,
  tabId: BASE_REQUEST.tabId,
  webContentsId: BASE_REQUEST.webContentsId,
}

function createVault(options: ConstructorParameters<typeof NetworkContextVault>[0] = {}) {
  let contextIndex = 0
  return new NetworkContextVault({
    createContextRef: () => `context-${++contextIndex}`,
    ...options,
  })
}

function promoteRecordedRequest(
  vault: NetworkContextVault,
  input: Omit<RecordNetworkRequestInput, 'requestHeaders'>,
  purposes: readonly NetworkContextPurpose[] = ['resource-download'],
  overrides: Partial<Omit<PromoteNetworkRequestInput, 'purposes'>> = {},
) {
  return vault.promoteRequest({
    navigationGeneration: input.navigationGeneration,
    observedRequestUrl: input.observedRequestUrl,
    purposes,
    requestId: input.requestId,
    resourceUrl: input.observedRequestUrl,
    sourceResourceType: input.sourceResourceType,
    tabId: input.tabId,
    webContentsId: input.webContentsId,
    ...overrides,
  })
}

function recordAndPromote(
  vault: NetworkContextVault,
  input: RecordNetworkRequestInput,
  purposes: readonly NetworkContextPurpose[] = ['resource-download'],
) {
  expect(vault.recordRequest(input)).toBe(true)
  return promoteRecordedRequest(vault, input, purposes)
}

describe('network.sensitive-header-projection', () => {
  it('keeps Cat Catch header selection in main and publishes values only on redemption', () => {
    const vault = createVault()
    const requestHeaders = [
      { name: 'Authorization', value: 'Bearer first-secret' },
      { name: 'Origin', value: 'https://page.example' },
      { name: 'Cookie', value: 'sid=cookie-secret' },
      { name: 'X-Monkey', value: 'keyword-secret' },
      { name: 'X-Trace', value: 'not-protected' },
      { name: 'Token', value: ' ' },
      { name: 'authorization', value: 'Bearer final-secret' },
      { name: 'Authorization', value: '' },
      { binaryValue: new Uint8Array([1, 2, 3]), name: 'api-key' },
      { name: '', value: 'ignored' },
    ]

    expect(vault.recordRequest({ ...BASE_REQUEST, requestHeaders })).toBe(true)
    requestHeaders[1]!.value = 'https://mutated.example'
    const projection = vault.promoteRequest({
      ...BASE_PROMOTE,
      purposes: ['resource-download', 'resource-inspection'],
    })

    expect(projection).toEqual({
      capabilities: {
        hasAuthorization: true,
        hasCookie: true,
      },
      contextRef: 'context-1',
      headerNames: ['authorization', 'origin', 'x-monkey', 'token', 'cookie'],
    })
    expect(Object.keys(projection || {}).sort()).toEqual([
      'capabilities',
      'contextRef',
      'headerNames',
    ])
    const serializedProjection = JSON.stringify(projection)
    for (const secret of [
      'Bearer first-secret',
      'Bearer final-secret',
      'sid=cookie-secret',
      'keyword-secret',
      BASE_REQUEST.observedRequestUrl,
      BASE_REQUEST.pageOrigin,
      BASE_REQUEST.requestId,
    ]) {
      expect(serializedProjection).not.toContain(secret)
    }

    const redeemed = vault.redeem({
      ...BASE_REDEMPTION,
      contextRef: projection!.contextRef,
      purpose: 'resource-download',
    })
    expect(redeemed).toEqual({
      headers: [
        ['authorization', 'Bearer final-secret'],
        ['origin', 'https://page.example'],
        ['x-monkey', 'keyword-secret'],
        ['token', ' '],
        ['cookie', 'sid=cookie-secret'],
      ],
      redirectMode: 'manual',
    })

    redeemed!.headers[1]![1] = 'https://mutated-redemption.example'
    expect(vault.redeem({
      ...BASE_REDEMPTION,
      contextRef: projection!.contextRef,
      purpose: 'resource-download',
    })?.headers[1]).toEqual(['origin', 'https://page.example'])
  })
})

describe('network.context-ttl-purpose-binding', () => {
  it('reports each retained context invalidation without exposing header values', () => {
    let now = 1_000
    const invalidations: NetworkContextInvalidation[] = []
    const vault = createVault({
      contextTtlMs: 100,
      maxContextEntries: 1,
      now: () => now,
      onContextInvalidated: invalidation => invalidations.push(invalidation),
    })
    const request = (index: number) => ({
      ...BASE_REQUEST,
      observedRequestUrl: `https://media.example/invalidation-${index}.mp4`,
      requestHeaders: { Authorization: `Bearer invalidation-secret-${index}` },
      requestId: `invalidation-${index}`,
    })

    const first = recordAndPromote(vault, request(1))!
    const secondRequest = request(2)
    const second = recordAndPromote(vault, secondRequest)!
    expect(invalidations).toEqual([{
      contextRef: first.contextRef,
      reason: 'capacity',
    }])

    now = 1_100
    expect(vault.redeem({
      ...BASE_REDEMPTION,
      contextRef: second.contextRef,
      purpose: 'resource-download',
      resourceUrl: secondRequest.observedRequestUrl,
    })).toBeNull()

    const third = recordAndPromote(vault, request(3))!
    now = 1_200
    expect(vault.sweepExpired()).toBe(1)

    const fourth = recordAndPromote(vault, request(4))!
    expect(vault.release(fourth.contextRef)).toBe(true)
    const fifth = recordAndPromote(vault, request(5))!
    expect(vault.clearTab(BASE_REQUEST.tabId)).toBe(1)
    const sixth = recordAndPromote(vault, request(6))!
    expect(vault.clearWebContents(BASE_REQUEST.webContentsId)).toBe(1)
    const seventh = recordAndPromote(vault, request(7))!
    expect(vault.clear()).toBe(1)

    expect(invalidations).toEqual([
      { contextRef: first.contextRef, reason: 'capacity' },
      { contextRef: second.contextRef, reason: 'expired' },
      { contextRef: third.contextRef, reason: 'expired' },
      { contextRef: fourth.contextRef, reason: 'release' },
      { contextRef: fifth.contextRef, reason: 'tab-clear' },
      { contextRef: sixth.contextRef, reason: 'web-contents-clear' },
      { contextRef: seventh.contextRef, reason: 'vault-clear' },
    ])
    expect(JSON.stringify(invalidations)).not.toContain('invalidation-secret')
  })

  it('requires owner, navigation, URL, page-origin, replay type, and purpose bindings', () => {
    let now = 1_000
    const vault = createVault({ contextTtlMs: 100, now: () => now })
    const projection = recordAndPromote(vault, {
      ...BASE_REQUEST,
      requestHeaders: { Authorization: 'Bearer bound-secret' },
    }, ['resource-download'])
    expect(projection).not.toBeNull()

    const redeem = (overrides: Partial<NetworkContextRedemptionInput> = {}) => vault.redeem({
      ...BASE_REDEMPTION,
      contextRef: projection!.contextRef,
      purpose: 'resource-download',
      ...overrides,
    })

    expect(redeem({ tabId: 'tab-2' })).toBeNull()
    expect(redeem({ webContentsId: 42 })).toBeNull()
    expect(redeem({ navigationGeneration: 8 })).toBeNull()
    expect(redeem({ resourceUrl: 'https://media.example/other.mp4?token=public-id' })).toBeNull()
    expect(redeem({ pageOrigin: 'https://other-page.example' })).toBeNull()
    expect(redeem({ purpose: 'external-tool' })).toBeNull()
    expect(redeem({ replayResourceType: 'script' as never })).toBeNull()
    expect(redeem()).toEqual({
      headers: [['authorization', 'Bearer bound-secret']],
      redirectMode: 'manual',
    })

    now = 1_100
    expect(redeem()).toBeNull()
    expect(vault.sweepExpired()).toBe(0)
  })

  it('expires pending request context before promotion without scanning other entries', () => {
    let now = 1_000
    const vault = createVault({ now: () => now, pendingTtlMs: 100 })
    expect(vault.recordRequest({
      ...BASE_REQUEST,
      requestHeaders: { Authorization: 'Bearer pending-secret' },
    })).toBe(true)

    now = 1_100
    expect(vault.promoteRequest({
      ...BASE_PROMOTE,
      purposes: ['resource-download'],
    })).toBeNull()
    expect(vault.sweepExpired()).toBe(0)
  })

  it('removes unrelated expired entries only during explicit maintenance', () => {
    let now = 1_000
    const vault = createVault({
      contextTtlMs: 200,
      now: () => now,
      pendingTtlMs: 100,
    })
    const projection = recordAndPromote(vault, {
      ...BASE_REQUEST,
      requestHeaders: { Authorization: 'Bearer retained-secret' },
    })
    expect(vault.recordRequest({
      ...BASE_REQUEST,
      requestHeaders: { Token: 'pending-secret' },
      requestId: 'pending-for-sweep',
    })).toBe(true)

    now = 1_100
    expect(vault.sweepExpired()).toBe(1)
    expect(vault.redeem({
      ...BASE_REDEMPTION,
      contextRef: projection!.contextRef,
      purpose: 'resource-download',
    })).not.toBeNull()

    now = 1_200
    expect(vault.sweepExpired()).toBe(1)
    expect(vault.redeem({
      ...BASE_REDEMPTION,
      contextRef: projection!.contextRef,
      purpose: 'resource-download',
    })).toBeNull()
  })

  it('separates pending terminal cleanup from retained context ownership', () => {
    const vault = createVault()
    expect(vault.recordRequest({
      ...BASE_REQUEST,
      requestHeaders: { Authorization: 'Bearer pending-secret' },
    })).toBe(true)
    expect(vault.finishRequest({
      requestId: BASE_REQUEST.requestId,
      webContentsId: BASE_REQUEST.webContentsId,
    })).toBe(true)
    expect(vault.promoteRequest({
      ...BASE_PROMOTE,
      purposes: ['resource-download'],
    })).toBeNull()

    const retainedRequest = {
      ...BASE_REQUEST,
      requestId: 'request-2',
      requestHeaders: { Authorization: 'Bearer retained-secret' },
    }
    const projection = recordAndPromote(vault, retainedRequest)
    expect(projection).not.toBeNull()
    expect(vault.finishRequest({
      requestId: retainedRequest.requestId,
      webContentsId: retainedRequest.webContentsId,
    })).toBe(false)
    expect(vault.redeem({
      ...BASE_REDEMPTION,
      contextRef: projection!.contextRef,
      purpose: 'resource-download',
    })).not.toBeNull()

    expect(vault.recordRequest({
      ...BASE_REQUEST,
      requestId: 'request-3',
      requestHeaders: { Token: 'pending-tab-secret' },
    })).toBe(true)
    expect(vault.clearTab(BASE_REQUEST.tabId)).toBe(2)
    expect(vault.redeem({
      ...BASE_REDEMPTION,
      contextRef: projection!.contextRef,
      purpose: 'resource-download',
    })).toBeNull()
  })

  it('evicts the oldest pending request context at capacity', () => {
    const vault = createVault({ maxPendingEntries: 2 })
    const requests = [1, 2, 3].map(index => ({
      ...BASE_REQUEST,
      observedRequestUrl: `https://media.example/pending-${index}.mp4`,
      requestHeaders: { Authorization: `Bearer pending-${index}` },
      requestId: `pending-${index}`,
    }))
    for (const request of requests) expect(vault.recordRequest(request)).toBe(true)

    expect(promoteRecordedRequest(vault, requests[0]!)).toBeNull()
    expect(promoteRecordedRequest(vault, requests[1]!)).not.toBeNull()
    expect(promoteRecordedRequest(vault, requests[2]!)).not.toBeNull()
  })

  it('evicts the oldest retained context and cleans an owner without touching unrelated state', () => {
    const vault = createVault({ maxContextEntries: 3 })
    const requests = [1, 2, 3].map(index => ({
      ...BASE_REQUEST,
      observedRequestUrl: `https://media.example/video-${index}.mp4`,
      requestHeaders: { Authorization: `Bearer capacity-${index}` },
      requestId: `capacity-${index}`,
    }))
    const projections = requests.map(request => recordAndPromote(vault, request))
    const unrelatedRequest = {
      ...BASE_REQUEST,
      observedRequestUrl: 'https://other-media.example/unrelated.mp4',
      pageOrigin: 'https://other-page.example',
      requestHeaders: { Authorization: 'Bearer unrelated-secret' },
      requestId: 'capacity-unrelated',
      tabId: 'tab-unrelated',
      webContentsId: 99,
    }
    const unrelatedProjection = recordAndPromote(vault, unrelatedRequest)

    expect(vault.redeem({
      ...BASE_REDEMPTION,
      contextRef: projections[0]!.contextRef,
      purpose: 'resource-download',
      resourceUrl: requests[0]!.observedRequestUrl,
    })).toBeNull()
    expect(vault.redeem({
      ...BASE_REDEMPTION,
      contextRef: projections[1]!.contextRef,
      purpose: 'resource-download',
      resourceUrl: requests[1]!.observedRequestUrl,
    })).not.toBeNull()

    expect(vault.clearWebContents(BASE_REQUEST.webContentsId)).toBe(2)
    const unrelatedRedemption = {
      ...BASE_REDEMPTION,
      contextRef: unrelatedProjection!.contextRef,
      pageOrigin: unrelatedRequest.pageOrigin,
      purpose: 'resource-download' as const,
      resourceUrl: unrelatedRequest.observedRequestUrl,
      tabId: unrelatedRequest.tabId,
      webContentsId: unrelatedRequest.webContentsId,
    }
    expect(vault.redeem(unrelatedRedemption)).not.toBeNull()
    expect(vault.release(unrelatedProjection!.contextRef)).toBe(true)
    expect(vault.redeem(unrelatedRedemption)).toBeNull()
    expect(vault.release(unrelatedProjection!.contextRef)).toBe(false)
    expect(vault.clear()).toBe(0)
  })

  it('clears non-empty pending and retained state together', () => {
    const vault = createVault()
    const projection = recordAndPromote(vault, {
      ...BASE_REQUEST,
      requestHeaders: { Authorization: 'Bearer retained-secret' },
    })
    const pendingRequest = {
      ...BASE_REQUEST,
      requestHeaders: { Token: 'pending-secret' },
      requestId: 'pending-after-retained',
    }
    expect(vault.recordRequest(pendingRequest)).toBe(true)

    expect(vault.clear()).toBe(2)
    expect(vault.redeem({
      ...BASE_REDEMPTION,
      contextRef: projection!.contextRef,
      purpose: 'resource-download',
    })).toBeNull()
    expect(promoteRecordedRequest(vault, pendingRequest)).toBeNull()
    expect(vault.clear()).toBe(0)
  })
})

describe('network.request-header-rule-scope', () => {
  it('allows Cat Catch replay types independently from the original request type', () => {
    const vault = createVault()
    const projection = recordAndPromote(vault, {
      ...BASE_REQUEST,
      requestHeaders: { Authorization: 'Bearer other-secret' },
      sourceResourceType: 'other',
    })
    expect(projection).not.toBeNull()

    for (const replayResourceType of ['xhr', 'media', 'image'] as const) {
      expect(vault.redeem({
        ...BASE_REDEMPTION,
        contextRef: projection!.contextRef,
        purpose: 'resource-download',
        replayResourceType,
      })).not.toBeNull()
    }
  })

  it('rejects promotion when the source request binding changes', () => {
    const vault = createVault()
    expect(vault.recordRequest({
      ...BASE_REQUEST,
      requestHeaders: { Authorization: 'Bearer mismatch-secret' },
      sourceResourceType: 'other',
    })).toBe(true)

    expect(vault.promoteRequest({
      ...BASE_PROMOTE,
      purposes: ['resource-download'],
      sourceResourceType: 'xhr',
    })).toBeNull()
  })

  it('fails closed when regex classification rewrites the observed request URL', () => {
    const vault = createVault()
    expect(vault.recordRequest({
      ...BASE_REQUEST,
      requestHeaders: { Authorization: 'Bearer rewrite-secret' },
    })).toBe(true)

    expect(vault.promoteRequest({
      ...BASE_PROMOTE,
      purposes: ['resource-download'],
      resourceUrl: 'https://media.example/rewritten.mp4?token=public-id',
    })).toBeNull()
    expect(vault.promoteRequest({
      ...BASE_PROMOTE,
      purposes: ['resource-download'],
    })).toBeNull()
  })

  it('uses exact URL and purpose-specific Cookie policy without creating browser rules', () => {
    const vault = createVault()
    const projection = recordAndPromote(vault, {
      ...BASE_REQUEST,
      requestHeaders: [
        { name: 'Referer', value: BASE_PAGE_URL },
        { name: 'Authorization', value: 'Bearer replay-secret' },
        { name: 'Cookie', value: 'sid=replay-cookie' },
      ],
    }, [
      'external-tool',
      'page-drag-stage',
      'resource-download',
      'resource-inspection',
    ])
    expect(projection).not.toBeNull()

    const redeem = (purpose: NetworkContextPurpose, overrides: Partial<NetworkContextRedemptionInput> = {}) => (
      vault.redeem({
        ...BASE_REDEMPTION,
        contextRef: projection!.contextRef,
        purpose,
        ...overrides,
      })
    )

    expect(redeem('resource-download')).toEqual({
      headers: [
        ['referer', BASE_PAGE_URL],
        ['authorization', 'Bearer replay-secret'],
        ['cookie', 'sid=replay-cookie'],
      ],
      redirectMode: 'manual',
    })
    expect(redeem('external-tool')?.headers.at(-1)).toEqual([
      'cookie',
      'sid=replay-cookie',
    ])
    expect(redeem('page-drag-stage')?.headers).toEqual([
      ['referer', BASE_PAGE_URL],
      ['authorization', 'Bearer replay-secret'],
    ])
    expect(redeem('resource-inspection', {
      resourceUrl: 'https://media.example/segment-1.ts',
    })).toBeNull()
    expect(redeem('resource-download', {
      resourceUrl: 'https://redirect.example/video.mp4',
    })).toBeNull()
  })
})
