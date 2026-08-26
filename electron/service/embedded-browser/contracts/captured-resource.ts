export const CAPTURE_MODES = ['off', 'network', 'deep'] as const
export const CAPTURED_RESOURCE_KINDS = [
  'manifest',
  'media',
  'image',
  'subtitle',
  'document',
  'key',
  'other',
] as const

export type CaptureMode = typeof CAPTURE_MODES[number]
export type CapturedResourceKind = typeof CAPTURED_RESOURCE_KINDS[number]
export type CapturedResourceSource = 'network' | 'probe'
export type CapturedResourceStreamType = 'audio' | 'video'

export type CapturedResourceContextProjection = {
  hasAuthorization: boolean
  hasCookie: boolean
  headerNames: string[]
}

export type CapturedResourceProjection = {
  capturedAt: number
  contentLength?: number
  context?: CapturedResourceContextProjection
  ext?: string
  id: string
  kind: CapturedResourceKind
  method?: string
  mimeType?: string
  name?: string
  resourceType?: string
  source: CapturedResourceSource
  statusCode?: number
  streamType?: CapturedResourceStreamType
  tabId: string
  url: string
}

export type ResourceStateStamp = {
  incarnation: number
  revision: number
  tabId: string
}

export type ActiveResourceStateSnapshot = ResourceStateStamp & {
  captureMode: CaptureMode
  resources: CapturedResourceProjection[]
  status: 'active'
}

export type DisposedResourceStateSnapshot = ResourceStateStamp & {
  status: 'disposed'
}

export type ResourceStateSnapshot =
  | ActiveResourceStateSnapshot
  | DisposedResourceStateSnapshot

export type ResourceStateUpsertChange = ResourceStateStamp & {
  resources: CapturedResourceProjection[]
  type: 'upsert'
}

export type ResourceStateRemoveChange = ResourceStateStamp & {
  reason: 'ttl'
  resourceIds: string[]
  type: 'remove'
}

export type ResourceStateActiveResetCause =
  | 'capacity'
  | 'clear'
  | 'navigation'
  | 'register'
  | 'replace'

export type ResourceStateDisposeCause =
  | 'app-dispose'
  | 'tab-dispose'
  | 'web-contents-dispose'

export type ResourceStateResetChange = ResourceStateStamp & (
  | {
    captureMode: CaptureMode
    cause: ResourceStateActiveResetCause
    status: 'active'
    type: 'reset'
  }
  | {
    cause: ResourceStateDisposeCause
    status: 'disposed'
    type: 'reset'
  }
)

export type ResourceStateModeChange = ResourceStateStamp & {
  captureMode: CaptureMode
  type: 'mode'
}

export type ResourceStateChange =
  | ResourceStateModeChange
  | ResourceStateRemoveChange
  | ResourceStateResetChange
  | ResourceStateUpsertChange

export type CapturedResourceReduceResult = {
  decision: 'applied' | 'ignored' | 'invalid' | 'resync'
  state: ResourceStateSnapshot | null
}

const captureModeSet = new Set<string>(CAPTURE_MODES)
const resourceKindSet = new Set<string>(CAPTURED_RESOURCE_KINDS)
const resourceSourceSet = new Set<string>(['network', 'probe'])
const streamTypeSet = new Set<string>(['audio', 'video'])
const activeResetCauseSet = new Set<string>([
  'capacity',
  'clear',
  'navigation',
  'register',
  'replace',
])
const disposeCauseSet = new Set<string>([
  'app-dispose',
  'tab-dispose',
  'web-contents-dispose',
])
const headerNamePattern = /^[!#$%&'*+\-.^_`|~0-9a-z]+$/i

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function readRequiredString(record: Record<string, unknown>, key: string) {
  const value = record[key]
  return typeof value === 'string' && value.trim() ? value : null
}

function readOptionalString(record: Record<string, unknown>, key: string) {
  const value = record[key]
  if (value === undefined) return undefined
  return typeof value === 'string' && value.trim() ? value : null
}

function readNumber(record: Record<string, unknown>, key: string, integer = false) {
  const value = record[key]
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null
  return integer && !Number.isInteger(value) ? null : value
}

function readOptionalNumber(record: Record<string, unknown>, key: string, integer = false) {
  if (record[key] === undefined) return undefined
  return readNumber(record, key, integer)
}

function parseStamp(record: Record<string, unknown>): ResourceStateStamp | null {
  const incarnation = readNumber(record, 'incarnation', true)
  const revision = readNumber(record, 'revision', true)
  const tabId = readRequiredString(record, 'tabId')
  if (incarnation === null || incarnation === 0 || revision === null || !tabId) return null
  return { incarnation, revision, tabId }
}

function parseContext(value: unknown): CapturedResourceContextProjection | null | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value)) return null
  if (
    typeof value.hasAuthorization !== 'boolean'
    || typeof value.hasCookie !== 'boolean'
    || !Array.isArray(value.headerNames)
  ) {
    return null
  }
  const headerNames: string[] = []
  for (const name of value.headerNames) {
    if (typeof name !== 'string' || !headerNamePattern.test(name)) return null
    headerNames.push(name.toLowerCase())
  }
  return {
    hasAuthorization: value.hasAuthorization,
    hasCookie: value.hasCookie,
    headerNames,
  }
}

function parseResource(value: unknown): CapturedResourceProjection | null {
  if (!isRecord(value)) return null
  const capturedAt = readNumber(value, 'capturedAt')
  const id = readRequiredString(value, 'id')
  const kind = readRequiredString(value, 'kind')
  const source = readRequiredString(value, 'source')
  const tabId = readRequiredString(value, 'tabId')
  const url = readRequiredString(value, 'url')
  if (
    capturedAt === null
    || !id
    || !kind
    || !resourceKindSet.has(kind)
    || !source
    || !resourceSourceSet.has(source)
    || !tabId
    || !url
  ) {
    return null
  }

  const optionalStrings = ['ext', 'method', 'mimeType', 'name', 'resourceType'] as const
  const strings: Partial<Record<typeof optionalStrings[number], string>> = {}
  for (const key of optionalStrings) {
    const parsed = readOptionalString(value, key)
    if (parsed === null) return null
    if (parsed !== undefined) strings[key] = parsed
  }
  const contentLength = readOptionalNumber(value, 'contentLength')
  const statusCode = readOptionalNumber(value, 'statusCode', true)
  if (contentLength === null || statusCode === null) return null
  const context = parseContext(value.context)
  if (context === null) return null
  const rawStreamType = readOptionalString(value, 'streamType')
  if (rawStreamType === null || (rawStreamType && !streamTypeSet.has(rawStreamType))) return null

  return {
    capturedAt,
    contentLength,
    context,
    ext: strings.ext,
    id,
    kind: kind as CapturedResourceKind,
    method: strings.method,
    mimeType: strings.mimeType,
    name: strings.name,
    resourceType: strings.resourceType,
    source: source as CapturedResourceSource,
    statusCode,
    streamType: rawStreamType as CapturedResourceStreamType | undefined,
    tabId,
    url,
  }
}

function parseResources(value: unknown, tabId: string) {
  if (!Array.isArray(value)) return null
  const resources: CapturedResourceProjection[] = []
  const resourceIds = new Set<string>()
  for (const item of value) {
    const resource = parseResource(item)
    if (!resource || resource.tabId !== tabId || resourceIds.has(resource.id)) return null
    resourceIds.add(resource.id)
    resources.push(resource)
  }
  return resources
}

function parseSnapshot(value: unknown): ResourceStateSnapshot | null {
  if (!isRecord(value)) return null
  const stamp = parseStamp(value)
  if (!stamp) return null
  if (value.status === 'disposed') return { ...stamp, status: 'disposed' }
  if (value.status !== 'active') return null
  const captureMode = readRequiredString(value, 'captureMode')
  const resources = parseResources(value.resources, stamp.tabId)
  if (!captureMode || !captureModeSet.has(captureMode) || !resources) return null
  return {
    ...stamp,
    captureMode: captureMode as CaptureMode,
    resources,
    status: 'active',
  }
}

function parseStringArray(value: unknown) {
  if (!Array.isArray(value)) return null
  const result: string[] = []
  const unique = new Set<string>()
  for (const item of value) {
    if (typeof item !== 'string' || !item.trim() || unique.has(item)) return null
    unique.add(item)
    result.push(item)
  }
  return result
}

function parseChange(value: unknown): ResourceStateChange | null {
  if (!isRecord(value)) return null
  const stamp = parseStamp(value)
  const type = readRequiredString(value, 'type')
  if (!stamp || !type) return null

  if (type === 'upsert') {
    const resources = parseResources(value.resources, stamp.tabId)
    return resources ? { ...stamp, resources, type } : null
  }
  if (type === 'remove') {
    const resourceIds = parseStringArray(value.resourceIds)
    return value.reason === 'ttl' && resourceIds
      ? { ...stamp, reason: 'ttl', resourceIds, type }
      : null
  }
  if (type === 'mode') {
    const captureMode = readRequiredString(value, 'captureMode')
    return captureMode && captureModeSet.has(captureMode)
      ? { ...stamp, captureMode: captureMode as CaptureMode, type }
      : null
  }
  if (type !== 'reset') return null
  const cause = readRequiredString(value, 'cause')
  if (!cause) return null
  if (value.status === 'disposed' && disposeCauseSet.has(cause)) {
    return { ...stamp, cause: cause as ResourceStateDisposeCause, status: 'disposed', type }
  }
  const captureMode = readRequiredString(value, 'captureMode')
  if (
    value.status !== 'active'
    || !activeResetCauseSet.has(cause)
    || !captureMode
    || !captureModeSet.has(captureMode)
  ) {
    return null
  }
  return {
    ...stamp,
    captureMode: captureMode as CaptureMode,
    cause: cause as ResourceStateActiveResetCause,
    status: 'active',
    type,
  }
}

function stateFromReset(change: ResourceStateResetChange): ResourceStateSnapshot {
  if (change.status === 'disposed') {
    return {
      incarnation: change.incarnation,
      revision: change.revision,
      status: 'disposed',
      tabId: change.tabId,
    }
  }
  return {
    captureMode: change.captureMode,
    incarnation: change.incarnation,
    resources: [],
    revision: change.revision,
    status: 'active',
    tabId: change.tabId,
  }
}

function applySequentialChange(
  current: ActiveResourceStateSnapshot,
  change: Exclude<ResourceStateChange, ResourceStateResetChange>,
): ActiveResourceStateSnapshot {
  if (change.type === 'mode') return { ...current, captureMode: change.captureMode, revision: change.revision }
  if (change.type === 'remove') {
    const removedIds = new Set(change.resourceIds)
    return {
      ...current,
      resources: current.resources.filter(resource => !removedIds.has(resource.id)),
      revision: change.revision,
    }
  }

  const nextById = new Map(current.resources.map(resource => [resource.id, resource]))
  for (const resource of change.resources) nextById.set(resource.id, resource)
  const resources = Array.from(nextById.values()).sort((left, right) => (
    right.capturedAt - left.capturedAt
  ))
  return { ...current, resources, revision: change.revision }
}

function reduce(
  currentInput: ResourceStateSnapshot | null,
  message: unknown,
): CapturedResourceReduceResult {
  const current = currentInput ? parseSnapshot(currentInput) : null
  if (currentInput && !current) return { decision: 'invalid', state: null }
  const isChange = isRecord(message) && typeof message.type === 'string'
  const incoming = isChange ? parseChange(message) : parseSnapshot(message)
  if (!incoming) return { decision: 'invalid', state: current }

  if (!current) {
    if (!isChange) return { decision: 'applied', state: incoming as ResourceStateSnapshot }
    const change = incoming as ResourceStateChange
    return change.type === 'reset'
      ? { decision: 'applied', state: stateFromReset(change) }
      : { decision: 'resync', state: null }
  }
  if (incoming.tabId !== current.tabId) return { decision: 'invalid', state: current }
  if (incoming.incarnation < current.incarnation) return { decision: 'ignored', state: current }
  if (incoming.incarnation === current.incarnation && incoming.revision <= current.revision) {
    return { decision: 'ignored', state: current }
  }
  if (!isChange) {
    const snapshot = incoming as ResourceStateSnapshot
    if (
      current.status === 'disposed'
      && snapshot.incarnation === current.incarnation
      && snapshot.status === 'active'
    ) {
      return { decision: 'resync', state: current }
    }
    return { decision: 'applied', state: snapshot }
  }

  const change = incoming as ResourceStateChange
  if (incoming.incarnation > current.incarnation) {
    return change.type === 'reset'
      ? { decision: 'applied', state: stateFromReset(change) }
      : { decision: 'resync', state: current }
  }
  if (incoming.revision !== current.revision + 1 || current.status === 'disposed') {
    return { decision: 'resync', state: current }
  }
  if (change.type === 'reset') {
    return { decision: 'applied', state: stateFromReset(change) }
  }
  return {
    decision: 'applied',
    state: applySequentialChange(current, change),
  }
}

export const CapturedResourceContract = {
  parseChange,
  parseResource,
  parseSnapshot,
  reduce,
} as const
