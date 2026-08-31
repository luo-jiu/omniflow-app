/**
 * Main-side output contract. A processing terminal only describes whether a
 * task produced a staged artifact; it never contains the private filesystem
 * path and it does not claim that a delivery has committed.
 */
export type ProcessingTaskTerminalStatus = 'success' | 'error' | 'cancelled'

export type StagedOutputReady = {
  fileName: string
  leaseId: string
  mimeType?: string
  sizeBytes?: number
}

export type ProcessingTaskTerminal = {
  error?: string
  kind: 'processing'
  stagedOutput?: StagedOutputReady
  status: ProcessingTaskTerminalStatus
  taskId: string
}

export type OutputDeliveryTerminalStatus = 'pending' | 'success' | 'error' | 'cancelled'

export type OutputDeliveryTerminal = {
  error?: string
  kind: 'delivery'
  leaseId: string
  status: OutputDeliveryTerminalStatus
  taskId: string
}

function normalizeRequiredText(value: unknown, label: string) {
  const normalized = String(value ?? '').trim()
  if (!normalized) {
    throw new Error(`${label} 不能为空`)
  }
  return normalized
}

function normalizeOptionalError(value: unknown) {
  const normalized = String(value ?? '').trim()
  return normalized || undefined
}

function normalizeStagedOutput(input: StagedOutputReady): StagedOutputReady {
  const sizeBytes = input.sizeBytes
  if (
    sizeBytes !== undefined
    && (!Number.isFinite(sizeBytes) || sizeBytes < 0)
  ) {
    throw new Error('staged output sizeBytes 无效')
  }
  return {
    fileName: normalizeRequiredText(input.fileName, 'staged output fileName'),
    leaseId: normalizeRequiredText(input.leaseId, 'staged output leaseId'),
    mimeType: normalizeOptionalError(input.mimeType),
    sizeBytes,
  }
}

/** Creates a path-free processing terminal snapshot. */
export function createProcessingTaskTerminal(input: {
  error?: string
  stagedOutput?: StagedOutputReady
  status: ProcessingTaskTerminalStatus
  taskId: string
}): ProcessingTaskTerminal {
  const taskId = normalizeRequiredText(input.taskId, 'processing taskId')
  const error = normalizeOptionalError(input.error)
  const stagedOutput = input.stagedOutput
    ? normalizeStagedOutput(input.stagedOutput)
    : undefined

  if (input.status === 'success' && !stagedOutput) {
    throw new Error('processing success 必须关联 ready staged output')
  }
  if (input.status !== 'success' && stagedOutput) {
    throw new Error('processing 非 success 不得声明 ready staged output')
  }

  return {
    ...(error ? { error } : {}),
    kind: 'processing',
    ...(stagedOutput ? { stagedOutput } : {}),
    status: input.status,
    taskId,
  }
}

/**
 * Creates the next delivery terminal from a successful processing terminal.
 * Delivery can fail or remain pending while processing stays successful.
 */
export function createOutputDeliveryTerminal(input: {
  error?: string
  processing: ProcessingTaskTerminal
  status: OutputDeliveryTerminalStatus
}): OutputDeliveryTerminal {
  if (input.processing.status !== 'success' || !input.processing.stagedOutput) {
    throw new Error('delivery terminal 必须建立在 processing success 之上')
  }
  const error = normalizeOptionalError(input.error)
  return {
    ...(error ? { error } : {}),
    kind: 'delivery',
    leaseId: input.processing.stagedOutput.leaseId,
    status: input.status,
    taskId: input.processing.taskId,
  }
}
