import { execFileSync } from 'node:child_process'

import {
  inspectVerifiedGitCommitMetadata,
  listGitCommitTreeEntriesWithBudget,
  readGitBlobObjects,
  type GitTreeEntry,
  type VerifiedGitCommitMetadata,
  type VerifiedGitCommitReadFailure,
} from './git-input.ts'
import { decodeUtf8Bytes, sha256Bytes } from './json.ts'

export const COMMIT_MESSAGE_LITERAL_PROFILE = 'commit-message-literal-v1' as const
export const CHANGED_BLOB_LITERAL_PROFILE = 'changed-blob-literal-v1' as const

export type ExactHistoryQueryProfile =
  | typeof COMMIT_MESSAGE_LITERAL_PROFILE
  | typeof CHANGED_BLOB_LITERAL_PROFILE

export type ExactHistoryQuery = {
  id: string
  literal: string
  profile: ExactHistoryQueryProfile
}

export type ExactHistoryTouchset = {
  fromCommit: string
  id: string
  pathScopes: string[]
  queries: ExactHistoryQuery[]
  throughCommit: string
}

export type NormalizedExactHistoryTouchset = {
  fromCommit: string
  id: string
  pathScopes: string[]
  queries: ExactHistoryQuery[]
  throughCommit: string
}

export type ExactHistoryScanIssueCode =
  | 'history-scan.ancestry-commit-budget-exhausted'
  | 'history-scan.blob-byte-budget-exhausted'
  | 'history-scan.blob-object-budget-exhausted'
  | 'history-scan.blobs-unavailable'
  | 'history-scan.budget-invalid'
  | 'history-scan.change-budget-exhausted'
  | 'history-scan.changed-blob-invalid-utf8'
  | 'history-scan.commit-identity-mismatch'
  | 'history-scan.commit-byte-budget-exhausted'
  | 'history-scan.commit-malformed'
  | 'history-scan.commit-message-invalid-utf8'
  | 'history-scan.commit-unavailable'
  | 'history-scan.from-commit-invalid'
  | 'history-scan.gitlink-changed'
  | 'history-scan.hash-format-mismatch'
  | 'history-scan.hit-budget-exhausted'
  | 'history-scan.non-ancestor-range'
  | 'history-scan.path-scope-empty'
  | 'history-scan.path-scope-budget-exhausted'
  | 'history-scan.path-scope-invalid'
  | 'history-scan.path-scope-unresolved'
  | 'history-scan.path-scopes-empty'
  | 'history-scan.path-scopes-invalid'
  | 'history-scan.query-id-duplicate'
  | 'history-scan.query-id-empty'
  | 'history-scan.query-id-invalid-unicode'
  | 'history-scan.query-budget-exhausted'
  | 'history-scan.query-invalid'
  | 'history-scan.query-literal-empty'
  | 'history-scan.query-literal-invalid-unicode'
  | 'history-scan.query-profile-unsupported'
  | 'history-scan.query-zero-hits'
  | 'history-scan.queries-empty'
  | 'history-scan.queries-invalid'
  | 'history-scan.through-commit-invalid'
  | 'history-scan.touchset-id-empty'
  | 'history-scan.touchset-id-invalid-unicode'
  | 'history-scan.compared-path-budget-exhausted'
  | 'history-scan.tree-entry-duplicate'
  | 'history-scan.tree-entry-budget-exhausted'
  | 'history-scan.tree-unavailable'
  | 'history-scan.search-byte-budget-exhausted'

export type ExactHistoryScanIssue = {
  code: ExactHistoryScanIssueCode
  commitId: string | null
  kind: 'invalid-input' | 'no-match' | 'unresolved-history' | 'unresolved-source'
  message: string
  parentCommitId: string | null
  path: string | null
  queryId: string | null
  value: string | null
}

export type ExactHistoryBlobState = {
  byteLength: number
  commitId: string
  mode: string
  objectId: string
  rawSourceHash: string
}

export type ExactHistoryChange = {
  after: ExactHistoryBlobState | null
  afterCommitId: string
  before: ExactHistoryBlobState | null
  beforeCommitId: string | null
  kind: 'add' | 'delete' | 'modify'
  path: string
}

export type ExactHistoryCommit = {
  commitId: string
  messageRawSourceHash: string
  parentCommitIds: string[]
  rawObjectHash: string
  treeId: string
}

export type ExactHistoryQueryHit = {
  byteEnd: number
  byteStart: number
  codeUnitEnd: number
  codeUnitStart: number
  commitId: string
  literal: string
  parentCommitId: string | null
  path: string | null
  profile: ExactHistoryQueryProfile
  queryId: string
  rawSourceHash: string
  side: 'after' | 'before' | 'commit-message'
}

export type ExactHistoryScanCompleteResult = {
  changes: ExactHistoryChange[]
  commits: ExactHistoryCommit[]
  queryHits: ExactHistoryQueryHit[]
  touchset: NormalizedExactHistoryTouchset
}

export type ExactHistoryScanResult =
  | { issues: ExactHistoryScanIssue[]; ok: false; result: null }
  | { issues: []; ok: true; result: ExactHistoryScanCompleteResult }

export type ExactHistoryScanBudgets = Readonly<{
  maxAncestryCommits: number
  maxBlobBytes: number
  maxBlobObjects: number
  maxChanges: number
  maxCommitBytes: number
  maxComparedPaths: number
  maxHits: number
  maxPathScopes: number
  maxQueries: number
  maxSearchBytes: number
  maxTreeEntries: number
}>

export type ExactHistoryScanBudgetOverrides = Partial<ExactHistoryScanBudgets>

// This stays below git-input.ts's 128 MiB cat-file buffer while leaving room for framing.
export const DEFAULT_EXACT_HISTORY_SCAN_BUDGETS: ExactHistoryScanBudgets = Object.freeze({
  maxAncestryCommits: 10_000,
  maxBlobBytes: 96 * 1024 * 1024,
  maxBlobObjects: 100_000,
  maxChanges: 1_000_000,
  maxCommitBytes: 96 * 1024 * 1024,
  maxComparedPaths: 10_000_000,
  maxHits: 1_000_000,
  maxPathScopes: 1_000,
  maxQueries: 1_000,
  maxSearchBytes: 512 * 1024 * 1024,
  maxTreeEntries: 2_000_000,
})

const EXACT_HISTORY_SCAN_BUDGET_NAMES = [
  'maxAncestryCommits',
  'maxBlobBytes',
  'maxBlobObjects',
  'maxChanges',
  'maxCommitBytes',
  'maxComparedPaths',
  'maxHits',
  'maxPathScopes',
  'maxQueries',
  'maxSearchBytes',
  'maxTreeEntries',
] as const satisfies readonly (keyof ExactHistoryScanBudgets)[]

type NormalizedInput = {
  touchset: NormalizedExactHistoryTouchset | null
  issues: ExactHistoryScanIssue[]
}

type PendingChange = {
  afterEntry: GitTreeEntry | null
  commitId: string
  kind: ExactHistoryChange['kind']
  parentCommitId: string | null
  path: string
  beforeEntry: GitTreeEntry | null
}

type LiteralOccurrence = {
  byteEnd: number
  byteStart: number
  codeUnitEnd: number
  codeUnitStart: number
}

type DecodedLiteralSource = {
  source: string
  sourceHash: string
}

const FULL_GIT_OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function compareNullableCodeUnits(left: string | null, right: string | null): number {
  if (left === right) return 0
  if (left === null) return -1
  if (right === null) return 1
  return compareCodeUnits(left, right)
}

function sortedUnique(values: Iterable<string>): string[] {
  return [...new Set(values)].sort(compareCodeUnits)
}

function isWellFormedUtf16(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index)
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false
      index += 1
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return false
    }
  }
  return true
}

function hasForbiddenRepositoryPathCodeUnit(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index)
    if (codeUnit === 0x5c || codeUnit <= 0x1f || codeUnit === 0x7f) return true
  }
  return false
}

function issue(
  code: ExactHistoryScanIssueCode,
  kind: ExactHistoryScanIssue['kind'],
  message: string,
  fields: Partial<Pick<
    ExactHistoryScanIssue,
    'commitId' | 'parentCommitId' | 'path' | 'queryId' | 'value'
  >> = {},
): ExactHistoryScanIssue {
  return {
    code,
    commitId: fields.commitId || null,
    kind,
    message,
    parentCommitId: fields.parentCommitId || null,
    path: fields.path || null,
    queryId: fields.queryId || null,
    value: fields.value || null,
  }
}

function compareIssues(left: ExactHistoryScanIssue, right: ExactHistoryScanIssue): number {
  return compareCodeUnits(left.code, right.code)
    || compareNullableCodeUnits(left.commitId, right.commitId)
    || compareNullableCodeUnits(left.parentCommitId, right.parentCommitId)
    || compareNullableCodeUnits(left.path, right.path)
    || compareNullableCodeUnits(left.queryId, right.queryId)
    || compareNullableCodeUnits(left.value, right.value)
    || compareCodeUnits(left.message, right.message)
}

function failure(issues: ExactHistoryScanIssue[]): ExactHistoryScanResult {
  return { issues: issues.sort(compareIssues), ok: false, result: null }
}

function validateBudgets(budgets: ExactHistoryScanBudgets): ExactHistoryScanIssue[] {
  const issues: ExactHistoryScanIssue[] = []
  for (const name of EXACT_HISTORY_SCAN_BUDGET_NAMES) {
    const value = budgets[name]
    if (!Number.isSafeInteger(value) || value < 0) {
      issues.push(issue(
        'history-scan.budget-invalid',
        'invalid-input',
        `Historical scan budget must be a non-negative safe integer: ${name}`,
        { value: `${name}=${String(value)}` },
      ))
    }
  }
  return issues
}

function budgetExhaustedIssue(
  code: Extract<ExactHistoryScanIssueCode, `${string}-budget-exhausted`>,
  kind: ExactHistoryScanIssue['kind'],
  resource: string,
  limit: number,
  required: number | bigint,
  fields: Partial<Pick<
    ExactHistoryScanIssue,
    'commitId' | 'parentCommitId' | 'path' | 'queryId'
  >> = {},
): ExactHistoryScanIssue {
  return issue(
    code,
    kind,
    `Historical scan ${resource} budget exhausted: required ${String(required)}, limit ${limit}.`,
    { ...fields, value: `required=${String(required)};limit=${limit}` },
  )
}

function isRepositoryRelativePathScope(value: string): boolean {
  if (
    value.length === 0
    || value.startsWith('/')
    || value.endsWith('/')
    || hasForbiddenRepositoryPathCodeUnit(value)
    || !isWellFormedUtf16(value)
  ) return false
  const segments = value.split('/')
  return !segments.some(segment => segment === '' || segment === '.' || segment === '..')
}

function normalizeInput(
  input: ExactHistoryTouchset,
  budgets: ExactHistoryScanBudgets,
): NormalizedInput {
  const issues: ExactHistoryScanIssue[] = []
  const inputRecord = input as unknown as Record<string, unknown>
  const id = inputRecord?.id
  if (typeof id !== 'string' || id.trim().length === 0) {
    issues.push(issue(
      'history-scan.touchset-id-empty',
      'invalid-input',
      'Historical touchset id must be a non-empty string.',
    ))
  } else if (!isWellFormedUtf16(id)) {
    issues.push(issue(
      'history-scan.touchset-id-invalid-unicode',
      'invalid-input',
      'Historical touchset id contains an unpaired UTF-16 surrogate.',
      { value: id },
    ))
  }

  const fromCommit = inputRecord?.fromCommit
  if (typeof fromCommit !== 'string' || !FULL_GIT_OBJECT_ID.test(fromCommit)) {
    issues.push(issue(
      'history-scan.from-commit-invalid',
      'invalid-input',
      'Historical touchset fromCommit must be a full lowercase Git commit object id.',
      { value: typeof fromCommit === 'string' ? fromCommit : null },
    ))
  }
  const throughCommit = inputRecord?.throughCommit
  if (typeof throughCommit !== 'string' || !FULL_GIT_OBJECT_ID.test(throughCommit)) {
    issues.push(issue(
      'history-scan.through-commit-invalid',
      'invalid-input',
      'Historical touchset throughCommit must be a full lowercase Git commit object id.',
      { value: typeof throughCommit === 'string' ? throughCommit : null },
    ))
  }
  if (
    typeof fromCommit === 'string'
    && typeof throughCommit === 'string'
    && FULL_GIT_OBJECT_ID.test(fromCommit)
    && FULL_GIT_OBJECT_ID.test(throughCommit)
    && fromCommit.length !== throughCommit.length
  ) {
    issues.push(issue(
      'history-scan.hash-format-mismatch',
      'invalid-input',
      'Historical range endpoints must use the same Git object hash format.',
    ))
  }

  const rawPathScopes = inputRecord?.pathScopes
  const pathScopes: string[] = []
  if (!Array.isArray(rawPathScopes)) {
    issues.push(issue(
      'history-scan.path-scopes-invalid',
      'invalid-input',
      'Historical touchset pathScopes must be an array.',
    ))
  } else if (rawPathScopes.length === 0) {
    issues.push(issue(
      'history-scan.path-scopes-empty',
      'invalid-input',
      'Historical touchset must declare at least one path scope.',
    ))
  } else if (rawPathScopes.length > budgets.maxPathScopes) {
    issues.push(budgetExhaustedIssue(
      'history-scan.path-scope-budget-exhausted',
      'invalid-input',
      'path-scope count',
      budgets.maxPathScopes,
      rawPathScopes.length,
    ))
  } else {
    for (const pathScope of rawPathScopes) {
      if (typeof pathScope !== 'string' || pathScope.length === 0) {
        issues.push(issue(
          'history-scan.path-scope-empty',
          'invalid-input',
          'Historical touchset contains an empty path scope.',
        ))
      } else if (!isRepositoryRelativePathScope(pathScope)) {
        issues.push(issue(
          'history-scan.path-scope-invalid',
          'invalid-input',
          `Historical touchset path scope is not a canonical repository-relative path: ${pathScope}`,
          { value: pathScope },
        ))
      } else {
        pathScopes.push(pathScope)
      }
    }
  }

  const rawQueries = inputRecord?.queries
  const queries: ExactHistoryQuery[] = []
  if (!Array.isArray(rawQueries)) {
    issues.push(issue(
      'history-scan.queries-invalid',
      'invalid-input',
      'Historical touchset queries must be an array.',
    ))
  } else if (rawQueries.length === 0) {
    issues.push(issue(
      'history-scan.queries-empty',
      'invalid-input',
      'Historical touchset must declare at least one query.',
    ))
  } else if (rawQueries.length > budgets.maxQueries) {
    issues.push(budgetExhaustedIssue(
      'history-scan.query-budget-exhausted',
      'invalid-input',
      'query count',
      budgets.maxQueries,
      rawQueries.length,
    ))
  } else {
    const queryIdCounts = new Map<string, number>()
    for (const rawQuery of rawQueries) {
      if (!rawQuery || typeof rawQuery !== 'object' || Array.isArray(rawQuery)) continue
      const queryId = (rawQuery as Record<string, unknown>).id
      if (typeof queryId === 'string' && queryId.length > 0) {
        queryIdCounts.set(queryId, (queryIdCounts.get(queryId) || 0) + 1)
      }
    }
    const duplicateQueryIds = new Set(
      [...queryIdCounts].filter(([, count]) => count > 1).map(([queryId]) => queryId),
    )
    for (const queryId of [...duplicateQueryIds].sort(compareCodeUnits)) {
      issues.push(issue(
        'history-scan.query-id-duplicate',
        'invalid-input',
        `Historical touchset query id is duplicated: ${queryId}`,
        { queryId },
      ))
    }

    for (const rawQuery of rawQueries) {
      if (!rawQuery || typeof rawQuery !== 'object' || Array.isArray(rawQuery)) {
        issues.push(issue(
          'history-scan.query-invalid',
          'invalid-input',
          'Historical touchset query must be an object.',
        ))
        continue
      }
      const queryRecord = rawQuery as Record<string, unknown>
      const queryId = queryRecord.id
      let valid = true
      if (typeof queryId !== 'string' || queryId.trim().length === 0) {
        issues.push(issue(
          'history-scan.query-id-empty',
          'invalid-input',
          'Historical touchset query id must be a non-empty string.',
        ))
        valid = false
      } else if (!isWellFormedUtf16(queryId)) {
        issues.push(issue(
          'history-scan.query-id-invalid-unicode',
          'invalid-input',
          'Historical touchset query id contains an unpaired UTF-16 surrogate.',
          { queryId },
        ))
        valid = false
      } else if (duplicateQueryIds.has(queryId)) {
        valid = false
      }

      const profile = queryRecord.profile
      if (profile !== COMMIT_MESSAGE_LITERAL_PROFILE && profile !== CHANGED_BLOB_LITERAL_PROFILE) {
        issues.push(issue(
          'history-scan.query-profile-unsupported',
          'invalid-input',
          `Historical touchset query uses unsupported profile: ${String(profile)}`,
          {
            queryId: typeof queryId === 'string' ? queryId : null,
            value: String(profile),
          },
        ))
        valid = false
      }

      const literal = queryRecord.literal
      if (typeof literal !== 'string' || literal.length === 0) {
        issues.push(issue(
          'history-scan.query-literal-empty',
          'invalid-input',
          'Historical touchset query literal must be a non-empty string.',
          { queryId: typeof queryId === 'string' ? queryId : null },
        ))
        valid = false
      } else if (!isWellFormedUtf16(literal)) {
        issues.push(issue(
          'history-scan.query-literal-invalid-unicode',
          'invalid-input',
          'Historical touchset query literal contains an unpaired UTF-16 surrogate.',
          { queryId: typeof queryId === 'string' ? queryId : null, value: literal },
        ))
        valid = false
      }

      if (valid) {
        queries.push({
          id: queryId as string,
          literal: literal as string,
          profile: profile as ExactHistoryQueryProfile,
        })
      }
    }
  }

  if (issues.length > 0) return { issues, touchset: null }
  return {
    issues: [],
    touchset: {
      fromCommit: fromCommit as string,
      id: id as string,
      pathScopes: sortedUnique(pathScopes),
      queries: queries.sort((left, right) => (
        compareCodeUnits(left.id, right.id)
        || compareCodeUnits(left.profile, right.profile)
        || compareCodeUnits(left.literal, right.literal)
      )),
      throughCommit: throughCommit as string,
    },
  }
}

function commitFailureIssue(
  commitId: string,
  reason: VerifiedGitCommitReadFailure,
): ExactHistoryScanIssue {
  if (reason === 'invalid-message-utf8') {
    return issue(
      'history-scan.commit-message-invalid-utf8',
      'unresolved-source',
      `Git commit message is not valid UTF-8: ${commitId}`,
      { commitId },
    )
  }
  if (reason === 'object-id-mismatch') {
    return issue(
      'history-scan.commit-identity-mismatch',
      'unresolved-history',
      `Raw Git commit bytes do not match the requested object id: ${commitId}`,
      { commitId },
    )
  }
  if (reason === 'malformed-object') {
    return issue(
      'history-scan.commit-malformed',
      'unresolved-history',
      `Git commit object is malformed: ${commitId}`,
      { commitId },
    )
  }
  return issue(
    'history-scan.commit-unavailable',
    'unresolved-history',
    `Git commit object is unavailable: ${commitId}`,
    { commitId, value: reason },
  )
}

function readGitObjectSize(
  cwd: string,
  objectId: string,
  objectType: 'commit',
): number | null {
  try {
    const output = execFileSync('git', [
      '--no-replace-objects',
      '--literal-pathspecs',
      'cat-file',
      '--batch-check=%(objectname) %(objecttype) %(objectsize)',
    ], {
      cwd,
      encoding: 'buffer',
      input: Buffer.from(`${objectId}\n`),
      maxBuffer: 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const source = decodeUtf8Bytes(output, 'Git object size output')
    const match = /^([0-9a-f]{40}|[0-9a-f]{64}) (commit) (0|[1-9][0-9]*)\n$/.exec(source)
    if (!match || match[1] !== objectId || match[2] !== objectType) return null
    const byteLength = Number(match[3])
    return Number.isSafeInteger(byteLength) && byteLength >= 0 ? byteLength : null
  } catch {
    return null
  }
}

function loadCompleteAncestry(
  cwd: string,
  throughCommit: string,
  budgets: ExactHistoryScanBudgets,
): {
  commitBytes: bigint
  commits: Map<string, VerifiedGitCommitMetadata>
  issues: ExactHistoryScanIssue[]
} {
  const commits = new Map<string, VerifiedGitCommitMetadata>()
  const issues: ExactHistoryScanIssue[] = []
  const pending = [throughCommit]
  const scheduled = new Set(pending)
  let cursor = 0
  let commitBytes = 0n
  let inspectedCommitCount = 0
  while (cursor < pending.length) {
    const commitId = pending[cursor]
    cursor += 1
    if (!commitId) continue
    if (inspectedCommitCount >= budgets.maxAncestryCommits) {
      issues.push(budgetExhaustedIssue(
        'history-scan.ancestry-commit-budget-exhausted',
        'unresolved-history',
        'ancestry commit count',
        budgets.maxAncestryCommits,
        inspectedCommitCount + 1,
        { commitId },
      ))
      break
    }
    inspectedCommitCount += 1
    const byteLength = readGitObjectSize(cwd, commitId, 'commit')
    if (byteLength === null) {
      issues.push(commitFailureIssue(commitId, 'object-unavailable'))
      continue
    }
    const requiredCommitBytes = commitBytes + BigInt(byteLength)
    if (requiredCommitBytes > BigInt(budgets.maxCommitBytes)) {
      issues.push(budgetExhaustedIssue(
        'history-scan.commit-byte-budget-exhausted',
        'unresolved-history',
        'aggregate raw commit-object byte count',
        budgets.maxCommitBytes,
        requiredCommitBytes,
        { commitId },
      ))
      break
    }
    commitBytes = requiredCommitBytes
    const state = inspectVerifiedGitCommitMetadata(cwd, commitId)
    if (state.status !== 'present') {
      issues.push(commitFailureIssue(commitId, state.reason))
      continue
    }
    commits.set(commitId, state.metadata)
    for (const parentId of [...state.metadata.parentIds].sort(compareCodeUnits)) {
      if (!scheduled.has(parentId)) {
        scheduled.add(parentId)
        pending.push(parentId)
      }
    }
  }
  return { commitBytes, commits, issues }
}

function collectAncestors(
  starts: Iterable<string>,
  commits: ReadonlyMap<string, VerifiedGitCommitMetadata>,
): Set<string> {
  const ancestors = new Set<string>()
  const pending = sortedUnique(starts)
  const scheduled = new Set(pending)
  while (pending.length > 0) {
    const commitId = pending.pop()
    if (!commitId) continue
    ancestors.add(commitId)
    for (const parentId of commits.get(commitId)?.parentIds || []) {
      if (!scheduled.has(parentId)) {
        scheduled.add(parentId)
        pending.push(parentId)
      }
    }
  }
  return ancestors
}

function recordMatchingPathScopes(
  relativePath: string,
  pathScopes: ReadonlySet<string>,
  resolvedPathScopes: Set<string>,
): boolean {
  let matched = false
  let prefixEnd = relativePath.indexOf('/')
  while (prefixEnd >= 0) {
    const prefix = relativePath.slice(0, prefixEnd)
    if (pathScopes.has(prefix)) {
      matched = true
      resolvedPathScopes.add(prefix)
    }
    prefixEnd = relativePath.indexOf('/', prefixEnd + 1)
  }
  if (pathScopes.has(relativePath)) {
    matched = true
    resolvedPathScopes.add(relativePath)
  }
  return matched
}

function treeEntryChanged(before: GitTreeEntry | null, after: GitTreeEntry | null): boolean {
  if (!before || !after) return before !== after
  return before.mode !== after.mode
    || before.objectId !== after.objectId
    || before.objectType !== after.objectType
}

function comparePendingChanges(left: PendingChange, right: PendingChange): number {
  return compareCodeUnits(left.commitId, right.commitId)
    || compareNullableCodeUnits(left.parentCommitId, right.parentCommitId)
    || compareCodeUnits(left.path, right.path)
    || compareCodeUnits(left.kind, right.kind)
}

function utf8Length(codePoint: number): number {
  if (codePoint <= 0x7f) return 1
  if (codePoint <= 0x7ff) return 2
  if (codePoint <= 0xffff) return 3
  return 4
}

function* iterateLiteralOccurrences(
  source: string,
  literal: string,
): Generator<LiteralOccurrence> {
  const literalByteLength = Buffer.byteLength(literal, 'utf8')
  let byteCursor = 0
  let codeUnitCursor = 0
  let codeUnitStart = source.indexOf(literal)
  while (codeUnitStart >= 0) {
    while (codeUnitCursor < codeUnitStart) {
      const codePoint = source.codePointAt(codeUnitCursor)
      if (codePoint === undefined) break
      byteCursor += utf8Length(codePoint)
      codeUnitCursor += codePoint > 0xffff ? 2 : 1
    }
    if (codeUnitCursor !== codeUnitStart) {
      throw new Error('Literal match did not align to a UTF-8 code point boundary')
    }
    const codeUnitEnd = codeUnitStart + literal.length
    const byteStart = byteCursor
    const byteEnd = byteStart + literalByteLength
    yield { byteEnd, byteStart, codeUnitEnd, codeUnitStart }
    codeUnitStart = source.indexOf(literal, codeUnitStart + 1)
  }
}

function readGitBlobObjectSizes(
  cwd: string,
  objectIds: readonly string[],
): Map<string, number> | null {
  if (objectIds.length === 0) return new Map()
  try {
    const output = execFileSync('git', [
      '--no-replace-objects',
      '--literal-pathspecs',
      'cat-file',
      '--batch-check=%(objectname) %(objecttype) %(objectsize)',
    ], {
      cwd,
      encoding: 'buffer',
      input: Buffer.from(`${objectIds.join('\n')}\n`),
      maxBuffer: 32 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const source = decodeUtf8Bytes(output, 'Git blob size batch output')
    if (!source.endsWith('\n')) return null
    const records = source.slice(0, -1).split('\n')
    if (records.length !== objectIds.length) return null

    const sizes = new Map<string, number>()
    for (let index = 0; index < objectIds.length; index += 1) {
      const requestedObjectId = objectIds[index]
      const record = records[index]
      const match = /^([0-9a-f]{40}|[0-9a-f]{64}) blob ([0-9]+)$/.exec(record || '')
      if (!requestedObjectId || !match || match[1] !== requestedObjectId) return null
      const byteLength = Number(match[2])
      if (!Number.isSafeInteger(byteLength) || byteLength < 0) return null
      sizes.set(requestedObjectId, byteLength)
    }
    return sizes
  } catch {
    return null
  }
}

function compareChanges(left: ExactHistoryChange, right: ExactHistoryChange): number {
  return compareCodeUnits(left.afterCommitId, right.afterCommitId)
    || compareCodeUnits(left.path, right.path)
    || compareNullableCodeUnits(left.beforeCommitId, right.beforeCommitId)
    || compareCodeUnits(left.kind, right.kind)
}

function compareQueryHits(left: ExactHistoryQueryHit, right: ExactHistoryQueryHit): number {
  return compareCodeUnits(left.commitId, right.commitId)
    || compareNullableCodeUnits(left.path, right.path)
    || compareNullableCodeUnits(left.parentCommitId, right.parentCommitId)
    || compareCodeUnits(left.queryId, right.queryId)
    || compareCodeUnits(left.side, right.side)
    || left.byteStart - right.byteStart
    || left.byteEnd - right.byteEnd
    || compareCodeUnits(left.rawSourceHash, right.rawSourceHash)
}

function materializeBlobState(
  commitId: string,
  entry: GitTreeEntry,
  blobs: ReadonlyMap<string, Buffer>,
): ExactHistoryBlobState {
  const bytes = blobs.get(entry.objectId)
  if (!bytes) throw new Error(`Verified blob is missing from materialization map: ${entry.objectId}`)
  return {
    byteLength: bytes.length,
    commitId,
    mode: entry.mode,
    objectId: entry.objectId,
    rawSourceHash: sha256Bytes(bytes),
  }
}

export function scanExactGitHistory(
  cwd: string,
  input: ExactHistoryTouchset,
  budgetOverrides: ExactHistoryScanBudgetOverrides = {},
): ExactHistoryScanResult {
  const budgets: ExactHistoryScanBudgets = {
    ...DEFAULT_EXACT_HISTORY_SCAN_BUDGETS,
    ...budgetOverrides,
  }
  const budgetIssues = validateBudgets(budgets)
  if (budgetIssues.length > 0) return failure(budgetIssues)

  const normalized = normalizeInput(input, budgets)
  if (!normalized.touchset) return failure(normalized.issues)
  const touchset = normalized.touchset

  const ancestry = loadCompleteAncestry(cwd, touchset.throughCommit, budgets)
  if (ancestry.issues.length > 0) return failure(ancestry.issues)

  let fromMetadata = ancestry.commits.get(touchset.fromCommit) || null
  if (!fromMetadata) {
    if (ancestry.commits.size >= budgets.maxAncestryCommits) {
      return failure([budgetExhaustedIssue(
        'history-scan.ancestry-commit-budget-exhausted',
        'unresolved-history',
        'ancestry commit count',
        budgets.maxAncestryCommits,
        ancestry.commits.size + 1,
        { commitId: touchset.fromCommit },
      )])
    }
    const byteLength = readGitObjectSize(cwd, touchset.fromCommit, 'commit')
    if (byteLength === null) {
      return failure([commitFailureIssue(touchset.fromCommit, 'object-unavailable')])
    }
    const requiredCommitBytes = ancestry.commitBytes + BigInt(byteLength)
    if (requiredCommitBytes > BigInt(budgets.maxCommitBytes)) {
      return failure([budgetExhaustedIssue(
        'history-scan.commit-byte-budget-exhausted',
        'unresolved-history',
        'aggregate raw commit-object byte count',
        budgets.maxCommitBytes,
        requiredCommitBytes,
        { commitId: touchset.fromCommit },
      )])
    }
    const state = inspectVerifiedGitCommitMetadata(cwd, touchset.fromCommit)
    if (state.status !== 'present') return failure([commitFailureIssue(touchset.fromCommit, state.reason)])
    fromMetadata = state.metadata
  }
  if (!ancestry.commits.has(touchset.fromCommit)) {
    return failure([issue(
      'history-scan.non-ancestor-range',
      'unresolved-history',
      `Historical fromCommit is not an ancestor of throughCommit: ${touchset.fromCommit}..${touchset.throughCommit}`,
      { commitId: touchset.throughCommit, value: touchset.fromCommit },
    )])
  }

  const excludedAncestors = collectAncestors(fromMetadata.parentIds, ancestry.commits)
  const rangeCommitIds = [...ancestry.commits.keys()]
    .filter(commitId => !excludedAncestors.has(commitId))
    .sort(compareCodeUnits)
  const requiredTreeCommitIds = new Set(rangeCommitIds)
  for (const commitId of rangeCommitIds) {
    for (const parentId of ancestry.commits.get(commitId)?.parentIds || []) {
      requiredTreeCommitIds.add(parentId)
    }
  }

  const treeEntriesByCommit = new Map<string, Map<string, GitTreeEntry>>()
  const treeIssues: ExactHistoryScanIssue[] = []
  const pathScopeSet = new Set(touchset.pathScopes)
  const resolvedPathScopes = new Set<string>()
  const requiredBlobIds = new Set<string>()
  let treeEntryCount = 0
  for (const commitId of [...requiredTreeCommitIds].sort(compareCodeUnits)) {
    const treeState = listGitCommitTreeEntriesWithBudget(
      cwd,
      commitId,
      budgets.maxTreeEntries - treeEntryCount,
    )
    if (treeState.status === 'budget-exhausted') {
      return failure([budgetExhaustedIssue(
        'history-scan.tree-entry-budget-exhausted',
        'unresolved-history',
        'recursive raw tree-entry count',
        budgets.maxTreeEntries,
        treeEntryCount + treeState.requiredEntryCount,
        { commitId },
      )])
    }
    if (treeState.status !== 'present') {
      treeIssues.push(issue(
        'history-scan.tree-unavailable',
        'unresolved-history',
        `Git tree is unavailable for historical commit: ${commitId}`,
        { commitId },
      ))
      continue
    }
    treeEntryCount += treeState.walkedEntryCount
    const entries = new Map<string, GitTreeEntry>()
    const seenPaths = new Set<string>()
    for (const entry of treeState.entries) {
      if (seenPaths.has(entry.relativePath)) {
        treeIssues.push(issue(
          'history-scan.tree-entry-duplicate',
          'unresolved-history',
          `Git tree contains a duplicate recursive path: ${entry.relativePath}`,
          { commitId, path: entry.relativePath },
        ))
        continue
      }
      seenPaths.add(entry.relativePath)

      if (recordMatchingPathScopes(entry.relativePath, pathScopeSet, resolvedPathScopes)) {
        entries.set(entry.relativePath, entry)
        if (entry.objectType === 'blob' && !requiredBlobIds.has(entry.objectId)) {
          if (requiredBlobIds.size >= budgets.maxBlobObjects) {
            return failure([budgetExhaustedIssue(
              'history-scan.blob-object-budget-exhausted',
              'unresolved-source',
              'unique in-scope blob-object count',
              budgets.maxBlobObjects,
              requiredBlobIds.size + 1,
              { commitId, path: entry.relativePath },
            )])
          }
          requiredBlobIds.add(entry.objectId)
        }
      }
    }
    treeEntriesByCommit.set(commitId, entries)
  }
  if (treeIssues.length > 0) return failure(treeIssues)

  const unresolvedPathScopes = touchset.pathScopes.filter(pathScope => (
    !resolvedPathScopes.has(pathScope)
  ))
  if (unresolvedPathScopes.length > 0) {
    return failure(unresolvedPathScopes.map(pathScope => issue(
      'history-scan.path-scope-unresolved',
      'unresolved-source',
      `Historical path scope does not cover any before/after tree entry in the exact range: ${pathScope}`,
      { path: pathScope, value: pathScope },
    )))
  }

  const pendingChanges: PendingChange[] = []
  const changeIssues: ExactHistoryScanIssue[] = []
  let comparedPathCount = 0
  for (const commitId of rangeCommitIds) {
    const metadata = ancestry.commits.get(commitId)
    const afterEntries = treeEntriesByCommit.get(commitId)
    if (!metadata || !afterEntries) {
      return failure([issue(
        'history-scan.tree-unavailable',
        'unresolved-history',
        `Verified historical commit tree was lost during scan: ${commitId}`,
        { commitId },
      )])
    }
    const parentIds: Array<string | null> = metadata.parentIds.length > 0
      ? metadata.parentIds
      : [null]
    for (const parentCommitId of parentIds) {
      const beforeEntries = parentCommitId
        ? treeEntriesByCommit.get(parentCommitId)
        : new Map<string, GitTreeEntry>()
      if (!beforeEntries) {
        changeIssues.push(issue(
          'history-scan.tree-unavailable',
          'unresolved-history',
          `Direct parent tree is unavailable: ${parentCommitId}`,
          { commitId, parentCommitId },
        ))
        continue
      }
      const paths = sortedUnique([...beforeEntries.keys(), ...afterEntries.keys()])
      if (paths.length > budgets.maxComparedPaths - comparedPathCount) {
        return failure([budgetExhaustedIssue(
          'history-scan.compared-path-budget-exhausted',
          'unresolved-history',
          'commit-parent compared-path count',
          budgets.maxComparedPaths,
          comparedPathCount + paths.length,
          { commitId, parentCommitId },
        )])
      }
      comparedPathCount += paths.length
      for (const relativePath of paths) {
        const beforeEntry = beforeEntries.get(relativePath) || null
        const afterEntry = afterEntries.get(relativePath) || null
        if (!treeEntryChanged(beforeEntry, afterEntry)) continue
        if (beforeEntry?.objectType === 'commit' || afterEntry?.objectType === 'commit') {
          changeIssues.push(issue(
            'history-scan.gitlink-changed',
            'unresolved-source',
            `Changed in-scope Gitlink cannot be scanned as an exact blob: ${relativePath}`,
            { commitId, parentCommitId, path: relativePath },
          ))
          continue
        }
        if (pendingChanges.length >= budgets.maxChanges) {
          return failure([budgetExhaustedIssue(
            'history-scan.change-budget-exhausted',
            'unresolved-history',
            'in-scope commit-parent change count',
            budgets.maxChanges,
            pendingChanges.length + 1,
            { commitId, parentCommitId, path: relativePath },
          )])
        }
        pendingChanges.push({
          afterEntry,
          beforeEntry,
          commitId,
          kind: beforeEntry ? (afterEntry ? 'modify' : 'delete') : 'add',
          parentCommitId,
          path: relativePath,
        })
      }
    }
  }
  if (changeIssues.length > 0) return failure(changeIssues)

  const changedParentIdsByCommit = new Map<string, Set<string | null>>()
  const changedBlobIds = new Set<string>()
  for (const pendingChange of pendingChanges) {
    let changedParentIds = changedParentIdsByCommit.get(pendingChange.commitId)
    if (!changedParentIds) {
      changedParentIds = new Set<string | null>()
      changedParentIdsByCommit.set(pendingChange.commitId, changedParentIds)
    }
    changedParentIds.add(pendingChange.parentCommitId)
    if (pendingChange.beforeEntry && pendingChange.parentCommitId) {
      changedBlobIds.add(pendingChange.beforeEntry.objectId)
    }
    if (pendingChange.afterEntry) changedBlobIds.add(pendingChange.afterEntry.objectId)
  }
  const commitMessageQueries = touchset.queries.filter(
    query => query.profile === COMMIT_MESSAGE_LITERAL_PROFILE,
  )
  const blobQueries = touchset.queries.filter(
    query => query.profile === CHANGED_BLOB_LITERAL_PROFILE,
  )

  const sortedRequiredBlobIds = [...requiredBlobIds].sort(compareCodeUnits)
  const blobSizes = readGitBlobObjectSizes(cwd, sortedRequiredBlobIds)
  if (!blobSizes) {
    return failure([issue(
      'history-scan.blobs-unavailable',
      'unresolved-source',
      'One or more in-scope Git blobs are missing, malformed, or not blobs.',
      { value: String(requiredBlobIds.size) },
    )])
  }
  let requiredBlobBytes = 0n
  for (const objectId of sortedRequiredBlobIds) {
    const byteLength = blobSizes.get(objectId)
    if (byteLength === undefined) {
      return failure([issue(
        'history-scan.blobs-unavailable',
        'unresolved-source',
        `Verified blob size disappeared during historical scan: ${objectId}`,
        { value: objectId },
      )])
    }
    requiredBlobBytes += BigInt(byteLength)
  }
  if (requiredBlobBytes > BigInt(budgets.maxBlobBytes)) {
    return failure([budgetExhaustedIssue(
      'history-scan.blob-byte-budget-exhausted',
      'unresolved-source',
      'unique in-scope blob byte count',
      budgets.maxBlobBytes,
      requiredBlobBytes,
    )])
  }

  // Match the occurrence-cache work model before any blob bytes are materialized or decoded.
  let requiredSearchBytes = 0n
  if (commitMessageQueries.length > 0) {
    const queryCount = BigInt(commitMessageQueries.length)
    for (const commitId of rangeCommitIds) {
      if (!changedParentIdsByCommit.has(commitId)) continue
      const metadata = ancestry.commits.get(commitId)
      if (!metadata) {
        return failure([issue(
          'history-scan.commit-unavailable',
          'unresolved-history',
          `Verified historical commit disappeared before search preflight: ${commitId}`,
          { commitId },
        )])
      }
      requiredSearchBytes += BigInt(metadata.messageBytes.length) * queryCount
    }
  }
  if (blobQueries.length > 0) {
    const queryCount = BigInt(blobQueries.length)
    for (const objectId of [...changedBlobIds].sort(compareCodeUnits)) {
      const byteLength = blobSizes.get(objectId)
      if (byteLength === undefined) {
        return failure([issue(
          'history-scan.blobs-unavailable',
          'unresolved-source',
          `Changed blob size disappeared before search preflight: ${objectId}`,
          { value: objectId },
        )])
      }
      requiredSearchBytes += BigInt(byteLength) * queryCount
    }
  }
  if (requiredSearchBytes > BigInt(budgets.maxSearchBytes)) {
    return failure([budgetExhaustedIssue(
      'history-scan.search-byte-budget-exhausted',
      'unresolved-source',
      'aggregate literal-search source byte count',
      budgets.maxSearchBytes,
      requiredSearchBytes,
    )])
  }

  const blobs = readGitBlobObjects(cwd, sortedRequiredBlobIds)
  if (!blobs) {
    return failure([issue(
      'history-scan.blobs-unavailable',
      'unresolved-source',
      'One or more in-scope Git blobs are missing, malformed, or fail object-id verification.',
      { value: String(requiredBlobIds.size) },
    )])
  }

  const changes = pendingChanges.sort(comparePendingChanges).map(change => ({
    after: change.afterEntry
      ? materializeBlobState(change.commitId, change.afterEntry, blobs)
      : null,
    afterCommitId: change.commitId,
    before: change.beforeEntry && change.parentCommitId
      ? materializeBlobState(change.parentCommitId, change.beforeEntry, blobs)
      : null,
    beforeCommitId: change.parentCommitId,
    kind: change.kind,
    path: change.path,
  })).sort(compareChanges)

  const queryHits: ExactHistoryQueryHit[] = []
  const hitCounts = new Map(touchset.queries.map(query => [query.id, 0]))
  const appendQueryHit = (hit: ExactHistoryQueryHit): ExactHistoryScanIssue | null => {
    if (queryHits.length >= budgets.maxHits) {
      return budgetExhaustedIssue(
        'history-scan.hit-budget-exhausted',
        'unresolved-source',
        'exact query-hit count',
        budgets.maxHits,
        queryHits.length + 1,
        {
          commitId: hit.commitId,
          parentCommitId: hit.parentCommitId,
          path: hit.path,
          queryId: hit.queryId,
        },
      )
    }
    queryHits.push(hit)
    hitCounts.set(hit.queryId, (hitCounts.get(hit.queryId) || 0) + 1)
    return null
  }

  for (const commitId of rangeCommitIds) {
    const metadata = ancestry.commits.get(commitId)
    const changedParentIds = changedParentIdsByCommit.get(commitId)
    if (!metadata || !changedParentIds || commitMessageQueries.length === 0) continue
    const rawSourceHash = sha256Bytes(metadata.messageBytes)
    const sortedChangedParentIds = [...changedParentIds].sort(compareNullableCodeUnits)
    for (const query of commitMessageQueries) {
      for (const occurrence of iterateLiteralOccurrences(
        metadata.message,
        query.literal,
      )) {
        for (const parentCommitId of sortedChangedParentIds) {
          const hitIssue = appendQueryHit({
            ...occurrence,
            commitId,
            literal: query.literal,
            parentCommitId,
            path: null,
            profile: query.profile,
            queryId: query.id,
            rawSourceHash,
            side: 'commit-message',
          })
          if (hitIssue) return failure([hitIssue])
        }
      }
    }
  }

  const decodedBlobCache = new Map<string, DecodedLiteralSource | null>()
  const blobOccurrenceCache = new Map<string, Map<string, LiteralOccurrence[]>>()
  const sourceIssues: ExactHistoryScanIssue[] = []
  for (const pendingChange of pendingChanges) {
    const sides = [
      {
        commitId: pendingChange.parentCommitId,
        entry: pendingChange.beforeEntry,
        side: 'before' as const,
      },
      {
        commitId: pendingChange.commitId,
        entry: pendingChange.afterEntry,
        side: 'after' as const,
      },
    ]
    for (const sourceSide of sides) {
      if (!sourceSide.commitId || !sourceSide.entry || blobQueries.length === 0) continue
      let decoded = decodedBlobCache.get(sourceSide.entry.objectId)
      if (decoded === undefined) {
        const sourceBytes = blobs.get(sourceSide.entry.objectId)
        if (!sourceBytes) {
          decoded = null
        } else {
          try {
            const source = decodeUtf8Bytes(
              sourceBytes,
              `Historical blob ${sourceSide.entry.objectId}`,
            )
            decoded = {
              source,
              sourceHash: sha256Bytes(sourceBytes),
            }
          } catch {
            decoded = null
          }
        }
        decodedBlobCache.set(sourceSide.entry.objectId, decoded)
      }
      if (!decoded) {
        const invalidBytes = blobs.get(sourceSide.entry.objectId)
        sourceIssues.push(issue(
          'history-scan.changed-blob-invalid-utf8',
          'unresolved-source',
          `Changed Git blob is not valid UTF-8: ${pendingChange.path}`,
          {
            commitId: pendingChange.commitId,
            parentCommitId: pendingChange.parentCommitId,
            path: pendingChange.path,
            value: invalidBytes ? sha256Bytes(invalidBytes) : sourceSide.entry.objectId,
          },
        ))
        continue
      }
      for (const query of blobQueries) {
        let queryOccurrences = blobOccurrenceCache.get(sourceSide.entry.objectId)
        if (!queryOccurrences) {
          queryOccurrences = new Map<string, LiteralOccurrence[]>()
          blobOccurrenceCache.set(sourceSide.entry.objectId, queryOccurrences)
        }
        const cachedOccurrences = queryOccurrences.get(query.id)
        const appendOccurrence = (occurrence: LiteralOccurrence): ExactHistoryScanIssue | null => (
          appendQueryHit({
            ...occurrence,
            commitId: pendingChange.commitId,
            literal: query.literal,
            parentCommitId: pendingChange.parentCommitId,
            path: pendingChange.path,
            profile: query.profile,
            queryId: query.id,
            rawSourceHash: decoded.sourceHash,
            side: sourceSide.side,
          })
        )
        if (cachedOccurrences) {
          for (const occurrence of cachedOccurrences) {
            const hitIssue = appendOccurrence(occurrence)
            if (hitIssue) return failure([hitIssue])
          }
          continue
        }
        const sourceBytes = blobs.get(sourceSide.entry.objectId)
        if (!sourceBytes) {
          return failure([issue(
            'history-scan.blobs-unavailable',
            'unresolved-source',
            `Verified blob disappeared before literal search: ${sourceSide.entry.objectId}`,
            { value: sourceSide.entry.objectId },
          )])
        }
        const occurrences: LiteralOccurrence[] = []
        for (const occurrence of iterateLiteralOccurrences(decoded.source, query.literal)) {
          occurrences.push(occurrence)
          const hitIssue = appendOccurrence(occurrence)
          if (hitIssue) return failure([hitIssue])
        }
        queryOccurrences.set(query.id, occurrences)
      }
    }
  }
  if (sourceIssues.length > 0) return failure(sourceIssues)

  const zeroHitIssues = touchset.queries
    .filter(query => (hitCounts.get(query.id) || 0) === 0)
    .map(query => issue(
      'history-scan.query-zero-hits',
      'no-match',
      `Historical query produced zero exact literal matches: ${query.id}`,
      { queryId: query.id, value: query.literal },
    ))
  if (zeroHitIssues.length > 0) return failure(zeroHitIssues)

  const commits = rangeCommitIds.map(commitId => {
    const metadata = ancestry.commits.get(commitId)
    if (!metadata) throw new Error(`Verified range commit disappeared: ${commitId}`)
    return {
      commitId,
      messageRawSourceHash: sha256Bytes(metadata.messageBytes),
      parentCommitIds: [...metadata.parentIds].sort(compareCodeUnits),
      rawObjectHash: metadata.rawObjectHash,
      treeId: metadata.treeId,
    }
  })

  return {
    issues: [],
    ok: true,
    result: {
      changes,
      commits,
      queryHits: queryHits.sort(compareQueryHits),
      touchset,
    },
  }
}
