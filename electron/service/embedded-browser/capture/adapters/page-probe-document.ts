import {
  EMBEDDED_BROWSER_RESOURCE_CONSOLE_PREFIX,
  createProbeBodySource,
  createProbeScriptTemplate,
} from '../../../embeddedBrowserResourceProbeScriptTemplate'
import { createDeepSearchPageAdapterBodySource } from './deep-search-page'
import { createDeepSearchToolkitAdapterBodySource } from './deep-search-toolkit'
import { createMsePageAdapterBodySource } from './mse-page'
import { createPageGeneratedResourceStoreBodySource } from './page-generated-resource'
import { embeddedBrowserPageProbeHostApiBody } from './page-probe-host-api'
import { embeddedBrowserPageProbeRuntimeCoreBody } from './page-probe-runtime-core'

/**
 * Unique production document-start composition for page capture.
 *
 * Body order is part of the contract: shared host -> global API -> target MSE
 * owner -> generated-resource owner -> target Deep owners. MSE stays usable if
 * an unusual page prevents a Deep experience hook install.
 */
export function createEmbeddedBrowserPageProbeDocumentScript(input?: {
  consolePrefix?: string
}) {
  const consolePrefix = String(input?.consolePrefix || '').trim()
    || EMBEDDED_BROWSER_RESOURCE_CONSOLE_PREFIX
  return createProbeScriptTemplate({
    bodySources: [
      createProbeBodySource(embeddedBrowserPageProbeRuntimeCoreBody),
      createProbeBodySource(embeddedBrowserPageProbeHostApiBody),
      createMsePageAdapterBodySource(),
      createPageGeneratedResourceStoreBodySource(),
      createDeepSearchPageAdapterBodySource({ usePageGeneratedResourceStore: true }),
      createDeepSearchToolkitAdapterBodySource(),
    ],
    consolePrefix,
  })
}
