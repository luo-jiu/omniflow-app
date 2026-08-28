/**
 * Renderer compatibility exports for the shared HLS contract and pure port.
 * The behavior owners live under electron/service/embedded-browser.
 */

export type {
  EmbeddedBrowserHlsAttributeMap,
  EmbeddedBrowserHlsByteRange,
  EmbeddedBrowserHlsDownloadFragment,
  EmbeddedBrowserHlsDownloadKeyRef,
  EmbeddedBrowserHlsDownloadMapRef,
  EmbeddedBrowserHlsDownloadPlan,
  EmbeddedBrowserHlsKey,
  EmbeddedBrowserHlsManifest,
  EmbeddedBrowserHlsMap,
  EmbeddedBrowserHlsRendition,
  EmbeddedBrowserHlsSegment,
  EmbeddedBrowserHlsVariableList,
  EmbeddedBrowserHlsVariant,
} from '../../../../../electron/service/embedded-browser/contracts/hls'

export {
  createHlsDownloadPlan as createEmbeddedBrowserHlsDownloadPlan,
} from '../../../../../electron/service/embedded-browser/cat-catch-port/hls/plan'
export {
  parseHlsAttributeList,
  parseHlsByteRange,
  parseHlsManifest as parseEmbeddedBrowserHlsManifest,
} from '../../../../../electron/service/embedded-browser/cat-catch-port/hls/parser'
export {
  applyCatCatchHlsSegmentQueryToPlan as applyEmbeddedBrowserHlsSegmentQuery,
  extractCatCatchHlsSegmentQueryDefault as extractEmbeddedBrowserHlsSegmentQueryDefault,
} from '../../../../../electron/service/embedded-browser/cat-catch-port/hls/segment-query'
