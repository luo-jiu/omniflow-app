export type HlsTaskProjection = {
  manifestUrl: string
  mode: 'direct-manifest' | 'local-plan'
  requestId?: string
  revision: number
  stage: 'preparing' | 'downloading-fragments' | 'rewriting-playlist' | 'ffmpeg' | 'completed' | 'error'
  status: 'running' | 'success' | 'error'
  tabId: string
}

type HlsTaskProjectionSelection = {
  afterRevision: number
  manifestUrls: Iterable<string>
  requestId?: string
  tabId: string
}

export function selectNewestMatchingHlsTaskProjection<Projection extends HlsTaskProjection>(
  projections: readonly Projection[],
  selection: HlsTaskProjectionSelection,
) {
  const manifestUrls = new Set(Array.from(selection.manifestUrls, value => String(value || '').trim()).filter(Boolean))
  let newest: Projection | null = null
  for (const projection of projections) {
    if (
      projection.revision <= selection.afterRevision
      || projection.tabId !== selection.tabId
      || !manifestUrls.has(projection.manifestUrl)
      || (selection.requestId && projection.requestId !== selection.requestId)
    ) {
      continue
    }
    if (!newest || projection.revision > newest.revision) {
      newest = projection
    }
  }
  return newest
}
