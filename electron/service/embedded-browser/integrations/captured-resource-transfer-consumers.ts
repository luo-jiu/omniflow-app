import type {
  CapturedResourceAccessService,
  CapturedResourceFetchResult,
} from './captured-resource-access'

export type CapturedResourceTransferRequest = {
  resourceId: string
  tabId: string
}

export type CapturedResourceTransferControl = {
  signal?: AbortSignal
}

export type MainOwnedCapturedResourceResponse = {
  resource: CapturedResourceFetchResult['resource']
  response: Response
}

/** The main sink owns response consumption; a rejected sink is cancelled here. */
export type CapturedResourceTransferSink<Result> = (
  input: MainOwnedCapturedResourceResponse,
) => Promise<Result>

type CapturedResourceTransferConsumerOptions<Result> = {
  access: Pick<CapturedResourceAccessService, 'fetch'>
  consume: CapturedResourceTransferSink<Result>
}

function normalizeIdentifier(value: unknown) {
  const normalized = String(value ?? '').trim()
  return normalized || null
}

async function consumeCapturedResource<Result>(
  options: CapturedResourceTransferConsumerOptions<Result>,
  purpose: 'page-drag-stage' | 'resource-download',
  input: CapturedResourceTransferRequest,
  control?: CapturedResourceTransferControl,
) {
  const resourceId = normalizeIdentifier(input?.resourceId)
  const tabId = normalizeIdentifier(input?.tabId)
  if (!resourceId || !tabId) {
    throw new Error('Captured resource transfer request is invalid')
  }

  const result = await options.access.fetch({
    purpose,
    resourceId,
    signal: control?.signal,
    tabId,
  })
  try {
    return await options.consume({
      resource: result.resource,
      response: result.response,
    })
  } catch (error) {
    await result.response.body?.cancel().catch(() => undefined)
    throw error
  }
}

/** Main-only bridge from an opaque resource command to the download sink. */
export class CapturedResourceDownloadService<Result> {
  private readonly options: CapturedResourceTransferConsumerOptions<Result>

  constructor(options: CapturedResourceTransferConsumerOptions<Result>) {
    this.options = options
  }

  download(
    input: CapturedResourceTransferRequest,
    control?: CapturedResourceTransferControl,
  ): Promise<Result> {
    return consumeCapturedResource(this.options, 'resource-download', input, control)
  }
}

/** Main-only bridge from an opaque resource command to the page-drag staging sink. */
export class CapturedResourcePageDragService<Result> {
  private readonly options: CapturedResourceTransferConsumerOptions<Result>

  constructor(options: CapturedResourceTransferConsumerOptions<Result>) {
    this.options = options
  }

  stage(
    input: CapturedResourceTransferRequest,
    control?: CapturedResourceTransferControl,
  ): Promise<Result> {
    return consumeCapturedResource(this.options, 'page-drag-stage', input, control)
  }
}
