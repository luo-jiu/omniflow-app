import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  existsSync,
  lstatSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  statSync,
} from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { decodeUtf8Bytes, sha256Bytes } from './json.ts'

const ancestorCache = new Map<string, GitAncestryState>()
const commitTreeSnapshotCache = new Map<string, VerifiedGitTreeSnapshot>()
const pathStateCache = new Map<string, GitPathState>()
const touchedPathCache = new Map<string, boolean>()

const VERIFIED_COMMIT_CACHE_MAX_ENTRIES = 16_384
const VERIFIED_COMMIT_CACHE_MAX_BYTES = 64 * 1024 * 1024

const GIT_GLOBAL_ARGS = ['--no-replace-objects', '--literal-pathspecs'] as const
const FULL_GIT_OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/
const GIT_COMMIT_HEADER_NAME = /^[A-Za-z0-9-]+$/

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function runGit(cwd: string, args: string[]): string {
  const output = execFileSync('git', [...GIT_GLOBAL_ARGS, ...args], {
    cwd,
    encoding: 'buffer',
    maxBuffer: 128 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return decodeUtf8Bytes(output, 'Git command output').trimEnd()
}

function runGitBuffer(cwd: string, args: string[]): Buffer {
  return execFileSync('git', [...GIT_GLOBAL_ARGS, ...args], {
    cwd,
    encoding: 'buffer',
    maxBuffer: 128 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

function runGitBufferWithInput(cwd: string, args: string[], input: Buffer): Buffer {
  return execFileSync('git', [...GIT_GLOBAL_ARGS, ...args], {
    cwd,
    encoding: 'buffer',
    input,
    maxBuffer: 128 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
}

function gitObjectBytesMatchId(
  type: 'blob' | 'commit' | 'tree',
  bytes: Buffer,
  objectId: string,
): boolean {
  const algorithm = objectId.length === 40 ? 'sha1' : objectId.length === 64 ? 'sha256' : null
  if (!algorithm) return false
  const actualObjectId = createHash(algorithm)
    .update(`${type} ${bytes.length}\0`)
    .update(bytes)
    .digest('hex')
  return actualObjectId === objectId
}

export type VerifiedGitCommitMetadata = {
  commitId: string
  message: string
  messageBytes: Buffer
  parentIds: string[]
  rawObjectHash: string
  treeId: string
}

export type VerifiedGitCommitReadFailure =
  | 'invalid-object-id'
  | 'invalid-message-utf8'
  | 'malformed-object'
  | 'object-id-mismatch'
  | 'object-unavailable'

export type VerifiedGitCommitReadState =
  | { status: 'present'; metadata: VerifiedGitCommitMetadata }
  | { status: 'unavailable'; reason: VerifiedGitCommitReadFailure }

type CachedVerifiedGitCommitMetadata = {
  byteCost: number
  metadata: VerifiedGitCommitMetadata
}

const verifiedCommitMetadataCache = new Map<string, CachedVerifiedGitCommitMetadata>()
let verifiedCommitMetadataCacheBytes = 0

function cloneVerifiedGitCommitMetadata(
  metadata: VerifiedGitCommitMetadata,
): VerifiedGitCommitMetadata {
  return {
    ...metadata,
    messageBytes: Buffer.from(metadata.messageBytes),
    parentIds: [...metadata.parentIds],
  }
}

function verifiedCommitMetadataByteCost(metadata: VerifiedGitCommitMetadata): number {
  return 512 + metadata.messageBytes.length * 3 + metadata.parentIds.length * 128
}

function readCachedVerifiedGitCommitMetadata(
  cacheKey: string,
): VerifiedGitCommitMetadata | null {
  const cached = verifiedCommitMetadataCache.get(cacheKey)
  if (!cached) return null
  verifiedCommitMetadataCache.delete(cacheKey)
  verifiedCommitMetadataCache.set(cacheKey, cached)
  return cloneVerifiedGitCommitMetadata(cached.metadata)
}

function cacheVerifiedGitCommitMetadata(
  cacheKey: string,
  metadata: VerifiedGitCommitMetadata,
): void {
  const byteCost = verifiedCommitMetadataByteCost(metadata)
  if (byteCost > VERIFIED_COMMIT_CACHE_MAX_BYTES) return
  while (
    verifiedCommitMetadataCache.size >= VERIFIED_COMMIT_CACHE_MAX_ENTRIES
    || verifiedCommitMetadataCacheBytes + byteCost > VERIFIED_COMMIT_CACHE_MAX_BYTES
  ) {
    const oldestKey = verifiedCommitMetadataCache.keys().next().value as string | undefined
    if (oldestKey === undefined) break
    const oldest = verifiedCommitMetadataCache.get(oldestKey)
    verifiedCommitMetadataCache.delete(oldestKey)
    verifiedCommitMetadataCacheBytes -= oldest?.byteCost || 0
  }
  const cachedMetadata = cloneVerifiedGitCommitMetadata(metadata)
  verifiedCommitMetadataCache.set(cacheKey, { byteCost, metadata: cachedMetadata })
  verifiedCommitMetadataCacheBytes += byteCost
}

function parseVerifiedGitCommitObject(
  commitId: string,
  rawBytes: Buffer,
): VerifiedGitCommitReadState {
  if (!gitObjectBytesMatchId('commit', rawBytes, commitId)) {
    return { reason: 'object-id-mismatch', status: 'unavailable' }
  }

  const headerEnd = rawBytes.indexOf('\n\n')
  if (headerEnd < 0) return { reason: 'malformed-object', status: 'unavailable' }

  let header: string
  try {
    header = decodeUtf8Bytes(rawBytes.subarray(0, headerEnd), 'Git commit header')
  } catch {
    return { reason: 'malformed-object', status: 'unavailable' }
  }
  if (header.includes('\0') || header.includes('\r')) {
    return { reason: 'malformed-object', status: 'unavailable' }
  }

  const objectIdPattern = commitId.length === 40 ? /^[0-9a-f]{40}$/ : /^[0-9a-f]{64}$/
  const headerLines = header.split('\n')
  const treeMatch = /^tree ([0-9a-f]+)$/.exec(headerLines[0] || '')
  if (!treeMatch || !objectIdPattern.test(treeMatch[1] || '')) {
    return { reason: 'malformed-object', status: 'unavailable' }
  }

  const parentIds: string[] = []
  const parentIdSet = new Set<string>()
  let fieldName: string | null = 'tree'
  let nonParentHeaderSeen = false
  let authorCount = 0
  let committerCount = 0
  for (const line of headerLines.slice(1)) {
    if (!line) return { reason: 'malformed-object', status: 'unavailable' }
    if (line.startsWith(' ')) {
      if (fieldName === null) return { reason: 'malformed-object', status: 'unavailable' }
      continue
    }
    const separator = line.indexOf(' ')
    const name = separator < 0 ? '' : line.slice(0, separator)
    if (!GIT_COMMIT_HEADER_NAME.test(name)) {
      return { reason: 'malformed-object', status: 'unavailable' }
    }
    fieldName = name
    if (name === 'tree') return { reason: 'malformed-object', status: 'unavailable' }
    if (name === 'parent') {
      if (nonParentHeaderSeen) return { reason: 'malformed-object', status: 'unavailable' }
      const parentId = line.slice(separator + 1)
      if (!objectIdPattern.test(parentId)) {
        return { reason: 'malformed-object', status: 'unavailable' }
      }
      if (parentIdSet.has(parentId)) {
        return { reason: 'malformed-object', status: 'unavailable' }
      }
      parentIdSet.add(parentId)
      parentIds.push(parentId)
      continue
    }
    nonParentHeaderSeen = true
    if (name === 'author') authorCount += 1
    if (name === 'committer') committerCount += 1
  }
  if (authorCount !== 1 || committerCount !== 1) {
    return { reason: 'malformed-object', status: 'unavailable' }
  }

  const messageBytes = rawBytes.subarray(headerEnd + 2)
  let message: string
  try {
    message = decodeUtf8Bytes(messageBytes, 'Git commit message')
  } catch {
    return { reason: 'invalid-message-utf8', status: 'unavailable' }
  }

  return {
    metadata: {
      commitId,
      message,
      messageBytes: Buffer.from(messageBytes),
      parentIds,
      rawObjectHash: sha256Bytes(rawBytes),
      treeId: treeMatch[1] || '',
    },
    status: 'present',
  }
}

export function inspectVerifiedGitCommitMetadata(
  cwd: string,
  commitId: string,
): VerifiedGitCommitReadState {
  if (!FULL_GIT_OBJECT_ID.test(commitId)) {
    return { reason: 'invalid-object-id', status: 'unavailable' }
  }
  const cacheKey = `${cwd}\0${commitId}`
  const cached = readCachedVerifiedGitCommitMetadata(cacheKey)
  if (cached) return { metadata: cached, status: 'present' }
  try {
    const rawBytes = runGitBuffer(cwd, ['cat-file', 'commit', commitId])
    const state = parseVerifiedGitCommitObject(commitId, rawBytes)
    if (state.status !== 'present') return state
    cacheVerifiedGitCommitMetadata(cacheKey, state.metadata)
    return {
      metadata: cloneVerifiedGitCommitMetadata(state.metadata),
      status: 'present',
    }
  } catch {
    return { reason: 'object-unavailable', status: 'unavailable' }
  }
}

export function readVerifiedGitCommitMetadata(
  cwd: string,
  commitId: string,
): VerifiedGitCommitMetadata | null {
  const state = inspectVerifiedGitCommitMetadata(cwd, commitId)
  return state.status === 'present' ? state.metadata : null
}

export function tryReadGitHead(cwd: string): string | null {
  try {
    return runGit(cwd, ['rev-parse', 'HEAD']).trim()
  } catch {
    return null
  }
}

export function tryResolveGitCommit(cwd: string, revision: string): string | null {
  if (FULL_GIT_OBJECT_ID.test(revision)) {
    if (inspectVerifiedGitCommitMetadata(cwd, revision).status === 'present') return revision
    try {
      const peeledCommit = runGit(cwd, ['rev-parse', '--verify', `${revision}^{commit}`]).trim()
      if (!FULL_GIT_OBJECT_ID.test(peeledCommit) || peeledCommit === revision) return null
      return inspectVerifiedGitCommitMetadata(cwd, peeledCommit).status === 'present'
        ? peeledCommit
        : null
    } catch {
      return null
    }
  }
  try {
    const resolvedCommit = runGit(cwd, ['rev-parse', '--verify', `${revision}^{commit}`]).trim()
    return FULL_GIT_OBJECT_ID.test(resolvedCommit)
      && inspectVerifiedGitCommitMetadata(cwd, resolvedCommit).status === 'present'
      ? resolvedCommit
      : null
  } catch {
    return null
  }
}

export function tryReadGitRemoteUrl(cwd: string, remote = 'origin'): string | null {
  try {
    return runGit(cwd, ['config', '--get', `remote.${remote}.url`]).trim() || null
  } catch {
    return null
  }
}

export function gitObjectExists(cwd: string, objectId: string): boolean {
  return tryResolveGitCommit(cwd, objectId) !== null
}

export type GitAncestryState = 'ancestor' | 'not-ancestor' | 'unavailable'

export type GitCommitRangeMembershipState =
  | 'excluded'
  | 'included'
  | 'non-ancestor-range'
  | 'unavailable'

export function getGitAncestryState(
  cwd: string,
  ancestor: string,
  descendant: string,
): GitAncestryState {
  const resolvedAncestor = tryResolveGitCommit(cwd, ancestor)
  const resolvedDescendant = tryResolveGitCommit(cwd, descendant)
  if (!resolvedAncestor || !resolvedDescendant) return 'unavailable'
  if (
    !gitObjectExists(cwd, resolvedAncestor)
    || !gitObjectExists(cwd, resolvedDescendant)
  ) return 'unavailable'
  const cacheKey = `${cwd}\0${resolvedAncestor}\0${resolvedDescendant}`
  const cached = ancestorCache.get(cacheKey)
  if (cached !== undefined) return cached
  if (resolvedAncestor === resolvedDescendant) {
    ancestorCache.set(cacheKey, 'ancestor')
    return 'ancestor'
  }

  const pending = [resolvedDescendant]
  const visited = new Set<string>()
  let parentGraphUnavailable = false
  while (pending.length > 0) {
    const current = pending.pop()
    if (!current || visited.has(current)) continue
    visited.add(current)
    const parents = readGitCommitParents(cwd, current)
    if (parents === null) {
      parentGraphUnavailable = true
      continue
    }
    for (const parent of parents) {
      if (parent === resolvedAncestor) {
        ancestorCache.set(cacheKey, 'ancestor')
        return 'ancestor'
      }
      if (!visited.has(parent)) pending.push(parent)
    }
  }

  const result = parentGraphUnavailable ? 'unavailable' : 'not-ancestor'
  if (result !== 'unavailable') ancestorCache.set(cacheKey, result)
  return result
}

export function getGitCommitRangeMembershipState(
  cwd: string,
  fromCommit: string,
  throughCommit: string,
  candidateCommit: string,
): GitCommitRangeMembershipState {
  const resolvedFrom = tryResolveGitCommit(cwd, fromCommit)
  const resolvedThrough = tryResolveGitCommit(cwd, throughCommit)
  const resolvedCandidate = tryResolveGitCommit(cwd, candidateCommit)
  if (
    resolvedFrom !== fromCommit
    || resolvedThrough !== throughCommit
    || resolvedCandidate !== candidateCommit
  ) return 'unavailable'

  const rangeAncestry = getGitAncestryState(cwd, fromCommit, throughCommit)
  if (rangeAncestry === 'unavailable') return 'unavailable'
  if (rangeAncestry === 'not-ancestor') return 'non-ancestor-range'

  const throughMembership = getGitAncestryState(cwd, candidateCommit, throughCommit)
  if (throughMembership === 'unavailable') return 'unavailable'
  if (throughMembership === 'not-ancestor') return 'excluded'

  const fromParents = readGitCommitParents(cwd, fromCommit)
  if (fromParents === null) return 'unavailable'
  for (const parent of fromParents) {
    const excludedAncestry = getGitAncestryState(cwd, candidateCommit, parent)
    if (excludedAncestry === 'unavailable') return 'unavailable'
    if (excludedAncestry === 'ancestor') return 'excluded'
  }
  return 'included'
}

export function isGitAncestor(cwd: string, ancestor: string, descendant: string): boolean {
  return getGitAncestryState(cwd, ancestor, descendant) === 'ancestor'
}

export function gitCommitTouchesPath(cwd: string, commit: string, relativePath: string): boolean {
  try {
    assertRepositoryRelativePath(relativePath)
    const resolvedCommit = tryResolveGitCommit(cwd, commit)
    if (!resolvedCommit) return false
    const cacheKey = `${cwd}\0${resolvedCommit}\0${relativePath}`
    const cached = touchedPathCache.get(cacheKey)
    if (cached !== undefined) return cached
    const metadata = readVerifiedGitCommitMetadata(cwd, resolvedCommit)
    const afterTree = listGitCommitTreeEntries(cwd, resolvedCommit)
    if (!metadata || afterTree.status !== 'present') return false
    const afterEntry = afterTree.entries.find(entry => entry.relativePath === relativePath) || null
    const parentIds: Array<string | null> = metadata.parentIds.length > 0
      ? metadata.parentIds
      : [null]
    let touched = false
    for (const parentId of parentIds) {
      const beforeTree = parentId
        ? listGitCommitTreeEntries(cwd, parentId)
        : { entries: [], status: 'present' } as const
      if (beforeTree.status !== 'present') return false
      const beforeEntry = beforeTree.entries.find(entry => entry.relativePath === relativePath) || null
      if (gitTreeEntriesDiffer(beforeEntry, afterEntry)) {
        touched = true
      }
    }
    touchedPathCache.set(cacheKey, touched)
    return touched
  } catch {
    return false
  }
}

export function gitCommitContainsPathScope(cwd: string, commit: string, relativePath: string): boolean {
  try {
    assertRepositoryRelativePath(relativePath)
    const treeState = listGitCommitTreeEntries(cwd, commit)
    return treeState.status === 'present'
      && treeState.entries.some(entry => gitTreeEntryMatchesScope(entry, relativePath))
  } catch {
    return false
  }
}

function assertRepositoryRelativePath(relativePath: string): void {
  if (
    !relativePath
    || path.isAbsolute(relativePath)
    || relativePath.split(/[\\/]/).includes('..')
    || relativePath.includes('\0')
  ) {
    throw new Error(`Invalid repository-relative path: ${relativePath}`)
  }
}

export function readGitFileAtCommit(
  cwd: string,
  commit: string,
  relativePath: string,
): Buffer | null {
  const state = readGitPathAtCommit(cwd, commit, relativePath)
  return state.status === 'present' ? state.bytes : null
}

export type GitPathState =
  | { status: 'absent' }
  | { status: 'present'; bytes: Buffer }
  | { status: 'unavailable' }

export type GitTreeEntry = {
  mode: string
  objectId: string
  objectType: 'blob' | 'commit'
  relativePath: string
}

export type GitTreeState =
  | { status: 'absent' }
  | { status: 'present'; entries: GitTreeEntry[] }
  | { status: 'unavailable' }

export type BudgetedGitTreeState =
  | { status: 'budget-exhausted'; requiredEntryCount: number }
  | { status: 'present'; entries: GitTreeEntry[]; walkedEntryCount: number }
  | { status: 'unavailable' }

type VerifiedGitTreeSnapshot = {
  directoryPaths: ReadonlySet<string>
  entries: GitTreeEntry[]
  walkedEntryCount: number
}

function gitTreeEntryMatchesScope(entry: GitTreeEntry, relativePath: string): boolean {
  return entry.relativePath === relativePath
    || entry.relativePath.startsWith(`${relativePath.replace(/\/+$/, '')}/`)
}

function gitTreeEntriesDiffer(
  left: GitTreeEntry | null,
  right: GitTreeEntry | null,
): boolean {
  if (!left || !right) return left !== right
  return left.mode !== right.mode
    || left.objectId !== right.objectId
    || left.objectType !== right.objectType
}

function cloneGitTreeEntries(entries: readonly GitTreeEntry[]): GitTreeEntry[] {
  return entries.map(entry => ({ ...entry }))
}

function cloneGitPathState(state: GitPathState): GitPathState {
  return state.status === 'present'
    ? { bytes: Buffer.from(state.bytes), status: 'present' }
    : state
}

function decodeNullTerminatedGitRecords(output: Buffer, source: string): string[] | null {
  if (output.length === 0) return []
  if (output[output.length - 1] !== 0x00) return null

  const records: string[] = []
  let offset = 0
  while (offset < output.length) {
    const recordEnd = output.indexOf(0x00, offset)
    if (recordEnd <= offset) return null
    try {
      records.push(decodeUtf8Bytes(output.subarray(offset, recordEnd), source))
    } catch {
      return null
    }
    offset = recordEnd + 1
  }
  return records
}

type RawGitTreeEntry = {
  kind: 'blob' | 'commit' | 'tree'
  mode: string
  name: string
  nameBytes: Buffer
  objectId: string
}

const CANONICAL_GIT_TREE_MODES = new Map<string, RawGitTreeEntry['kind']>([
  ['100644', 'blob'],
  ['100755', 'blob'],
  ['120000', 'blob'],
  ['160000', 'commit'],
  ['40000', 'tree'],
])

function compareRawGitTreeEntries(left: RawGitTreeEntry, right: RawGitTreeEntry): number {
  const sharedLength = Math.min(left.nameBytes.length, right.nameBytes.length)
  for (let index = 0; index < sharedLength; index += 1) {
    const difference = (left.nameBytes[index] || 0) - (right.nameBytes[index] || 0)
    if (difference !== 0) return difference
  }
  const leftTerminator = left.nameBytes.length === sharedLength
    ? left.kind === 'tree' ? 0x2f : 0x00
    : left.nameBytes[sharedLength] || 0
  const rightTerminator = right.nameBytes.length === sharedLength
    ? right.kind === 'tree' ? 0x2f : 0x00
    : right.nameBytes[sharedLength] || 0
  return leftTerminator - rightTerminator
}

type RawGitTreeBudget = {
  consumedEntries: number
  maxEntries: number
}

type RawGitTreeParseState =
  | { status: 'budget-exhausted'; requiredEntryCount: number }
  | { status: 'present'; entries: RawGitTreeEntry[] }
  | { status: 'unavailable' }

function parseRawGitTreeObject(
  treeId: string,
  rawBytes: Buffer,
  budget: RawGitTreeBudget,
): RawGitTreeParseState {
  const objectIdByteLength = treeId.length === 40 ? 20 : treeId.length === 64 ? 32 : 0
  if (objectIdByteLength === 0) return { status: 'unavailable' }

  const entries: RawGitTreeEntry[] = []
  const names = new Set<string>()
  let offset = 0
  while (offset < rawBytes.length) {
    if (budget.consumedEntries >= budget.maxEntries) {
      return {
        requiredEntryCount: budget.consumedEntries + 1,
        status: 'budget-exhausted',
      }
    }
    budget.consumedEntries += 1
    const modeEnd = rawBytes.indexOf(0x20, offset)
    if (modeEnd <= offset) return { status: 'unavailable' }
    const modeBytes = rawBytes.subarray(offset, modeEnd)
    if (![...modeBytes].every(byte => byte >= 0x30 && byte <= 0x39)) {
      return { status: 'unavailable' }
    }
    const mode = modeBytes.toString('ascii')
    const kind = CANONICAL_GIT_TREE_MODES.get(mode)
    if (!kind) return { status: 'unavailable' }

    const nameStart = modeEnd + 1
    const nameEnd = rawBytes.indexOf(0x00, nameStart)
    if (nameEnd <= nameStart) return { status: 'unavailable' }
    const nameBytes = Buffer.from(rawBytes.subarray(nameStart, nameEnd))
    let name: string
    try {
      name = decodeUtf8Bytes(nameBytes, 'Git tree entry name')
    } catch {
      return { status: 'unavailable' }
    }
    if (name === '.' || name === '..' || name.includes('/') || names.has(name)) {
      return { status: 'unavailable' }
    }
    names.add(name)

    const objectIdStart = nameEnd + 1
    const objectIdEnd = objectIdStart + objectIdByteLength
    if (objectIdEnd > rawBytes.length) return { status: 'unavailable' }
    const objectId = rawBytes.subarray(objectIdStart, objectIdEnd).toString('hex')
    if (
      !FULL_GIT_OBJECT_ID.test(objectId)
      || objectId.length !== treeId.length
      || /^0+$/.test(objectId)
    ) return { status: 'unavailable' }

    const entry = { kind, mode, name, nameBytes, objectId }
    const previousEntry = entries.at(-1)
    if (previousEntry && compareRawGitTreeEntries(previousEntry, entry) >= 0) {
      return { status: 'unavailable' }
    }
    entries.push(entry)
    offset = objectIdEnd
  }
  return { entries, status: 'present' }
}

function readVerifiedRawGitTrees(cwd: string, objectIds: string[]): Map<string, Buffer> | null {
  const uniqueObjectIds = [...new Set(objectIds)].sort(compareCodeUnits)
  if (
    uniqueObjectIds.length === 0
    || !uniqueObjectIds.every(objectId => FULL_GIT_OBJECT_ID.test(objectId))
  ) return null

  try {
    const output = runGitBufferWithInput(
      cwd,
      ['cat-file', '--batch'],
      Buffer.from(`${uniqueObjectIds.join('\n')}\n`),
    )
    const trees = new Map<string, Buffer>()
    let offset = 0
    for (const requestedObjectId of uniqueObjectIds) {
      const headerEnd = output.indexOf(0x0a, offset)
      if (headerEnd < 0) return null
      const header = decodeUtf8Bytes(output.subarray(offset, headerEnd), 'Git tree batch header')
      const match = /^([0-9a-f]{40}|[0-9a-f]{64}) tree (0|[1-9][0-9]*)$/.exec(header)
      if (!match || match[1] !== requestedObjectId) return null
      const byteLength = Number(match[2])
      if (!Number.isSafeInteger(byteLength) || byteLength < 0) return null
      const contentStart = headerEnd + 1
      const contentEnd = contentStart + byteLength
      if (contentEnd >= output.length || output[contentEnd] !== 0x0a) return null
      const bytes = Buffer.from(output.subarray(contentStart, contentEnd))
      if (!gitObjectBytesMatchId('tree', bytes, requestedObjectId)) return null
      trees.set(requestedObjectId, bytes)
      offset = contentEnd + 1
    }
    return offset === output.length ? trees : null
  } catch {
    return null
  }
}

function loadVerifiedGitTreeClosure(
  cwd: string,
  rootTreeId: string,
  maxEntries: number,
):
  | { status: 'budget-exhausted'; requiredEntryCount: number }
  | { status: 'present'; parsedTrees: Map<string, RawGitTreeEntry[]> }
  | { status: 'unavailable' } {
  const budget: RawGitTreeBudget = { consumedEntries: 0, maxEntries }
  const parsedTrees = new Map<string, RawGitTreeEntry[]>()
  let pendingTreeIds = [rootTreeId]
  while (pendingTreeIds.length > 0) {
    const frontier = [...new Set(pendingTreeIds)]
      .filter(treeId => !parsedTrees.has(treeId))
      .sort(compareCodeUnits)
    if (frontier.length === 0) break
    const remainingBudget = budget.maxEntries - budget.consumedEntries
    const boundedFrontier = frontier.slice(0, Math.max(1, remainingBudget))
    const rawTrees = readVerifiedRawGitTrees(cwd, boundedFrontier)
    if (!rawTrees) {
      return remainingBudget === 0
        ? {
            requiredEntryCount: budget.consumedEntries + 1,
            status: 'budget-exhausted',
          }
        : { status: 'unavailable' }
    }
    pendingTreeIds = frontier.slice(boundedFrontier.length)
    for (const treeId of boundedFrontier) {
      const rawTree = rawTrees.get(treeId)
      if (!rawTree) return { status: 'unavailable' }
      const parsed = parseRawGitTreeObject(treeId, rawTree, budget)
      if (parsed.status !== 'present') return parsed
      parsedTrees.set(treeId, parsed.entries)
      pendingTreeIds.push(...parsed.entries
        .filter(entry => entry.kind === 'tree')
        .map(entry => entry.objectId))
    }
  }
  return parsedTrees.has(rootTreeId)
    ? { parsedTrees, status: 'present' }
    : { status: 'unavailable' }
}

function flattenVerifiedGitTreeClosure(
  rootTreeId: string,
  parsedTrees: Map<string, RawGitTreeEntry[]>,
  maxEntries: number,
):
  | { status: 'budget-exhausted'; requiredEntryCount: number }
  | {
      status: 'present'
      directoryPaths: ReadonlySet<string>
      entries: GitTreeEntry[]
      walkedEntryCount: number
    }
  | { status: 'unavailable' } {
  type PendingTree = {
    ancestorTreeIds: ReadonlySet<string>
    pathPrefix: string
    treeId: string
  }
  type PendingLeaf = {
    entry: RawGitTreeEntry
    relativePath: string
  }
  const entries: GitTreeEntry[] = []
  const directoryPaths = new Set<string>()
  const paths = new Set<string>()
  const pending: Array<PendingLeaf | PendingTree> = [{
    ancestorTreeIds: new Set(),
    pathPrefix: '',
    treeId: rootTreeId,
  }]
  let walkedEntryCount = 0
  while (pending.length > 0) {
    const current = pending.pop()
    if (!current) return { status: 'unavailable' }
    if ('entry' in current) {
      if (current.entry.kind === 'tree' || paths.has(current.relativePath)) {
        return { status: 'unavailable' }
      }
      paths.add(current.relativePath)
      entries.push({
        mode: current.entry.mode,
        objectId: current.entry.objectId,
        objectType: current.entry.kind,
        relativePath: current.relativePath,
      })
      continue
    }
    if (current.ancestorTreeIds.has(current.treeId)) return { status: 'unavailable' }
    const rawEntries = parsedTrees.get(current.treeId)
    if (!rawEntries) return { status: 'unavailable' }
    const ancestorTreeIds = new Set(current.ancestorTreeIds)
    ancestorTreeIds.add(current.treeId)

    for (const entry of [...rawEntries].reverse()) {
      if (walkedEntryCount >= maxEntries) {
        return {
          requiredEntryCount: walkedEntryCount + 1,
          status: 'budget-exhausted',
        }
      }
      walkedEntryCount += 1
      const relativePath = current.pathPrefix
        ? `${current.pathPrefix}/${entry.name}`
        : entry.name
      if (!relativePath || relativePath.startsWith('/') || paths.has(relativePath)) {
        return { status: 'unavailable' }
      }
      if (entry.kind === 'tree') {
        directoryPaths.add(relativePath)
        pending.push({ ancestorTreeIds, pathPrefix: relativePath, treeId: entry.objectId })
        continue
      }
      pending.push({ entry, relativePath })
    }
  }
  return { directoryPaths, entries, status: 'present', walkedEntryCount }
}

export function readGitCommitParents(cwd: string, commit: string): string[] | null {
  const resolvedCommit = tryResolveGitCommit(cwd, commit)
  return resolvedCommit
    ? readVerifiedGitCommitMetadata(cwd, resolvedCommit)?.parentIds || null
    : null
}

export function listGitTreeEntriesAtCommit(
  cwd: string,
  commit: string,
  relativePath: string,
): GitTreeState {
  assertRepositoryRelativePath(relativePath)
  const treeState = listGitCommitTreeEntries(cwd, commit)
  if (treeState.status !== 'present') return { status: 'unavailable' }
  const entries = treeState.entries.filter(entry => gitTreeEntryMatchesScope(entry, relativePath))
  return entries.length > 0 ? { entries, status: 'present' } : { status: 'absent' }
}

export function listGitCommitTreeEntriesWithBudget(
  cwd: string,
  commit: string,
  maxEntries: number,
): BudgetedGitTreeState {
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 0) return { status: 'unavailable' }
  const resolvedCommit = tryResolveGitCommit(cwd, commit)
  if (!resolvedCommit) return { status: 'unavailable' }
  const cacheKey = `${cwd}\0${resolvedCommit}`
  const cached = commitTreeSnapshotCache.get(cacheKey)
  if (cached) {
    if (cached.walkedEntryCount > maxEntries) {
      return { requiredEntryCount: maxEntries + 1, status: 'budget-exhausted' }
    }
    return {
      entries: cloneGitTreeEntries(cached.entries),
      status: 'present',
      walkedEntryCount: cached.walkedEntryCount,
    }
  }
  const commitState = inspectVerifiedGitCommitMetadata(cwd, resolvedCommit)
  if (commitState.status !== 'present') return { status: 'unavailable' }

  const rootTreeId = commitState.metadata.treeId
  const closure = loadVerifiedGitTreeClosure(cwd, rootTreeId, maxEntries)
  if (closure.status !== 'present') return closure
  const flattened = flattenVerifiedGitTreeClosure(rootTreeId, closure.parsedTrees, maxEntries)
  if (flattened.status !== 'present') return flattened
  const snapshot = {
    directoryPaths: new Set(flattened.directoryPaths),
    entries: cloneGitTreeEntries(flattened.entries),
    walkedEntryCount: flattened.walkedEntryCount,
  }
  commitTreeSnapshotCache.set(cacheKey, snapshot)
  return {
    entries: flattened.entries,
    status: 'present',
    walkedEntryCount: flattened.walkedEntryCount,
  }
}

export function listGitCommitTreeEntries(cwd: string, commit: string): GitTreeState {
  const state = listGitCommitTreeEntriesWithBudget(cwd, commit, Number.MAX_SAFE_INTEGER)
  return state.status === 'present'
    ? { entries: state.entries, status: 'present' }
    : { status: 'unavailable' }
}

export function readGitBlobObjects(cwd: string, objectIds: string[]): Map<string, Buffer> | null {
  const uniqueObjectIds = [...new Set(objectIds)].sort()
  if (uniqueObjectIds.length === 0) return new Map()
  if (!uniqueObjectIds.every(objectId => /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(objectId))) {
    return null
  }

  try {
    const output = runGitBufferWithInput(
      cwd,
      ['cat-file', '--batch'],
      Buffer.from(`${uniqueObjectIds.join('\n')}\n`),
    )
    const blobs = new Map<string, Buffer>()
    let offset = 0
    for (const requestedObjectId of uniqueObjectIds) {
      const headerEnd = output.indexOf(0x0a, offset)
      if (headerEnd < 0) return null
      const header = decodeUtf8Bytes(output.subarray(offset, headerEnd), 'Git batch header')
      const match = /^([0-9a-f]{40}|[0-9a-f]{64}) blob ([0-9]+)$/.exec(header)
      if (!match || match[1] !== requestedObjectId) return null
      const byteLength = Number(match[2])
      if (!Number.isSafeInteger(byteLength) || byteLength < 0) return null
      const contentStart = headerEnd + 1
      const contentEnd = contentStart + byteLength
      if (contentEnd >= output.length || output[contentEnd] !== 0x0a) return null
      const bytes = output.subarray(contentStart, contentEnd)
      if (!gitObjectBytesMatchId('blob', bytes, requestedObjectId)) return null
      blobs.set(requestedObjectId, bytes)
      offset = contentEnd + 1
    }
    return offset === output.length ? blobs : null
  } catch {
    return null
  }
}

export function readGitPathAtCommit(
  cwd: string,
  commit: string,
  relativePath: string,
): GitPathState {
  assertRepositoryRelativePath(relativePath)
  const resolvedCommit = tryResolveGitCommit(cwd, commit)
  if (!resolvedCommit) return { status: 'unavailable' }
  const treeCacheKey = `${cwd}\0${resolvedCommit}`
  const cacheKey = `${treeCacheKey}\0${relativePath}`
  const cached = pathStateCache.get(cacheKey)
  if (cached) return cloneGitPathState(cached)
  try {
    const treeState = listGitCommitTreeEntries(cwd, resolvedCommit)
    if (treeState.status !== 'present') {
      return { status: 'unavailable' }
    }
    const matchingEntries = treeState.entries.filter(entry => entry.relativePath === relativePath)
    if (matchingEntries.length === 0) {
      if (commitTreeSnapshotCache.get(treeCacheKey)?.directoryPaths.has(relativePath)) {
        return { status: 'unavailable' }
      }
      const result = { status: 'absent' } as const
      pathStateCache.set(cacheKey, result)
      return result
    }
    if (matchingEntries.length !== 1) {
      const result = { status: 'unavailable' } as const
      return result
    }
    const entry = matchingEntries[0]
    if (!entry || entry.objectType !== 'blob' || entry.relativePath !== relativePath) {
      const result = { status: 'unavailable' } as const
      return result
    }
    const bytes = runGitBuffer(cwd, ['cat-file', 'blob', entry.objectId])
    if (!gitObjectBytesMatchId('blob', bytes, entry.objectId)) {
      const result = { status: 'unavailable' } as const
      return result
    }
    const result = { status: 'present', bytes } as const
    pathStateCache.set(cacheKey, cloneGitPathState(result))
    return result
  } catch {
    const result = { status: 'unavailable' } as const
    return result
  }
}

export function listDirtyTrackedPaths(cwd: string): string[] {
  const output = runGit(cwd, ['status', '--porcelain=v1', '--untracked-files=no'])
  if (!output) return []
  return output.split('\n').map(line => line.slice(3).trim()).filter(Boolean).sort()
}

function listTrackedPaths(cwd: string): string[] {
  const output = runGitBuffer(cwd, ['ls-files', '-z'])
  const paths = decodeNullTerminatedGitRecords(output, 'Git tracked path')
  if (!paths) throw new Error('Git returned malformed tracked path records')
  return paths.sort()
}

export function listUntrackedPaths(cwd: string): string[] {
  const output = runGitBuffer(cwd, ['ls-files', '--others', '--exclude-standard', '-z'])
  const paths = decodeNullTerminatedGitRecords(output, 'Git untracked path')
  if (!paths) throw new Error('Git returned malformed untracked path records')
  return paths.sort()
}

function isReportIndexPath(relativePath: string): boolean {
  return relativePath === 'docs/cat-catch/report-index'
    || relativePath.startsWith('docs/cat-catch/report-index/')
}

export function hashTrackedWorktreeInputs(cwd: string): string {
  const manifest = [...new Set([...listTrackedPaths(cwd), ...listUntrackedPaths(cwd)])]
    .filter(relativePath => !isReportIndexPath(relativePath))
    .map(relativePath => {
      const absolutePath = path.join(cwd, relativePath)
      if (!existsSync(absolutePath)) return `missing\0${relativePath}`
      const stat = lstatSync(absolutePath)
      if (stat.isSymbolicLink()) {
        return `120000\0blob\0${relativePath}\0${sha256Bytes(readlinkSync(absolutePath))}`
      }
      if (stat.isDirectory()) {
        const nestedHead = tryReadGitHead(absolutePath) || 'unresolved-directory'
        return `160000\0commit\0${relativePath}\0${nestedHead}`
      }
      const mode = stat.mode & 0o111 ? '100755' : '100644'
      return `${mode}\0blob\0${relativePath}\0${sha256Bytes(readFileSync(absolutePath))}`
    })
    .join('\0')
  return sha256Bytes(manifest)
}

export function hashGitCommitInputs(cwd: string, commit: string): string | null {
  const resolvedCommit = tryResolveGitCommit(cwd, commit)
  if (!resolvedCommit) return null
  const treeState = listGitCommitTreeEntries(cwd, resolvedCommit)
  if (treeState.status !== 'present') return null
  const records = treeState.entries
    .filter(entry => !isReportIndexPath(entry.relativePath))
    .map(entry => `${entry.mode} ${entry.objectType} ${entry.objectId}\t${entry.relativePath}`)
    .sort()
  return sha256Bytes(records.join('\0'))
}

function listFilesRecursively(directory: string): string[] {
  if (!statSync(directory).isDirectory()) return [directory]
  return readdirSync(directory, { withFileTypes: true })
    .flatMap(entry => {
      const target = path.join(directory, entry.name)
      return entry.isDirectory() ? listFilesRecursively(target) : [target]
    })
}

export function hashValidatorSourceManifest(appRoot: string): string {
  const roots = [
    path.join(appRoot, 'tools/cat-catch-lab/validator'),
    path.join(appRoot, 'docs/cat-catch'),
  ]
  const sourceFiles = roots
    .flatMap(root => {
      try {
        return listFilesRecursively(root)
      } catch {
        return []
      }
    })
    .filter(filePath => (
      filePath.endsWith('.ts')
      || filePath.endsWith('.schema.json')
    ))
  const toolchainInputs = [
    path.join(appRoot, 'package.json'),
    path.join(appRoot, 'package-lock.json'),
    path.join(appRoot, 'tsconfig.cat-catch-tools.json'),
  ].filter(existsSync)
  const files = [...new Set([...sourceFiles, ...toolchainInputs])].sort()
  return hashValidatorSourceHashEntries(files.map(filePath => ({
    contentHash: sha256Bytes(readFileSync(filePath)),
    relativePath: normalizeWorktreeRelativePath(path.relative(appRoot, filePath)),
  })))
}

export function normalizeWorktreeRelativePath(
  relativePath: string,
  hostSeparator = path.sep,
): string {
  return hostSeparator === '/' ? relativePath : relativePath.split(hostSeparator).join('/')
}

export function hashValidatorSourceHashEntries(
  entries: Array<{ contentHash: string; relativePath: string }>,
): string {
  const manifest = entries
    .sort((left, right) => compareCodeUnits(left.relativePath, right.relativePath))
    .map(entry => `${entry.relativePath}\0${entry.contentHash}`)
    .join('\0')
  return sha256Bytes(manifest)
}

function tryReadPackageVersion(appRoot: string, packageName: string): string | null {
  const packagePath = path.join(appRoot, 'node_modules', packageName, 'package.json')
  try {
    const packageDocument: unknown = JSON.parse(decodeUtf8Bytes(
      readFileSync(packagePath),
      packagePath,
    ))
    if (!packageDocument || typeof packageDocument !== 'object' || Array.isArray(packageDocument)) return null
    const version = (packageDocument as Record<string, unknown>).version
    return typeof version === 'string' ? version : null
  } catch {
    return null
  }
}

export function hashValidatorToolchainFingerprint(appRoot: string): string {
  return sha256Bytes(JSON.stringify({
    ajv: tryReadPackageVersion(appRoot, 'ajv'),
    ajvFormats: tryReadPackageVersion(appRoot, 'ajv-formats'),
    node: process.versions.node,
    tsx: tryReadPackageVersion(appRoot, 'tsx'),
    typescript: tryReadPackageVersion(appRoot, 'typescript'),
  }))
}
