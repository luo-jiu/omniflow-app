/**
 * HLS fragment query compatibility ported from Cat Catch.
 *
 * Upstream: xifangczy/cat-catch@2cb981d7c2f4614732edccc167c4b5793d1cb138
 * Source: js/m3u8.js#tsAddArg, parseTs(data), and #tsAddArg click handler
 * Reason: some sites require the manifest query on every media fragment, while
 * other sites need a stale fragment query removed before downloading.
 * Adaptation: pure plan transform; UI and Electron transport stay outside the port.
 * Fixture: hls-segment-query-rewrite
 */

export type CatCatchHlsSegmentQuery = string | null

export function extractCatCatchHlsSegmentQueryDefault(manifestUrl: string) {
  const match = /\.m3u8\?([^\n]*)/.exec(String(manifestUrl || ''))
  return match ? match[1] : null
}

export function rewriteCatCatchHlsFragmentUrl(
  fragmentUrl: string,
  segmentQuery: CatCatchHlsSegmentQuery,
) {
  if (segmentQuery === null) {
    return fragmentUrl
  }
  const match = /([^?]*)/.exec(fragmentUrl)
  if (!match?.[0]) {
    return fragmentUrl
  }
  return `${match[0]}${segmentQuery ? `?${segmentQuery}` : ''}`
}

export function applyCatCatchHlsSegmentQueryToPlan<
  TFragment extends { url: string },
  TSegment extends { url: string },
  TPlan extends { fragments: TFragment[], segments: TSegment[] },
>(
  plan: TPlan,
  segmentQuery: CatCatchHlsSegmentQuery,
): TPlan {
  if (segmentQuery === null) {
    return plan
  }
  return {
    ...plan,
    fragments: plan.fragments.map(fragment => ({
      ...fragment,
      url: rewriteCatCatchHlsFragmentUrl(fragment.url, segmentQuery),
    })),
    segments: plan.segments.map(segment => ({
      ...segment,
      url: rewriteCatCatchHlsFragmentUrl(segment.url, segmentQuery),
    })),
  }
}
