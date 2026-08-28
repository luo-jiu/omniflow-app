import { createEmbeddedBrowserResourceProbeScript } from '../../../embeddedBrowserResourceProbe'
import { createDeepSearchPageAdapterBodySource } from './deep-search-page'
import { createDeepSearchToolkitAdapterBodySource } from './deep-search-toolkit'

/**
 * Target-only probe composition used to prove the deep-search cutover before
 * replacing the production template. Existing MSE/resource support remains
 * unchanged; the target page adapter is the only appended deep hook owner.
 */
export function createDeepSearchTargetProbeScript(input: {
  consolePrefix: string
}) {
  return createEmbeddedBrowserResourceProbeScript({
    additionalBodySources: [
      createDeepSearchPageAdapterBodySource(),
      createDeepSearchToolkitAdapterBodySource(),
    ],
    consolePrefix: input.consolePrefix,
  })
}
