import { decodeUtf8Bytes, sha256Bytes } from './json.ts'

export const EXACT_SEMANTIC_MATCH_PROFILE = 'utf8-literal-case-sensitive-v1' as const

export type ExactSemanticScanBudgets = Readonly<{
  maxHits: number
  maxInputBytes: number
  maxPaths: number
  maxPatterns: number
  maxRules: number
  maxSearchWork: number
}>

export type ExactSemanticScanBudgetOverrides = Partial<ExactSemanticScanBudgets>

export const DEFAULT_EXACT_SEMANTIC_SCAN_BUDGETS: ExactSemanticScanBudgets = Object.freeze({
  maxHits: 100_000,
  maxInputBytes: 256 * 1024 * 1024,
  maxPaths: 10_000,
  maxPatterns: 4_096,
  maxRules: 256,
  maxSearchWork: 512 * 1024 * 1024,
})

const EXACT_SEMANTIC_SCAN_BUDGET_KEYS = [
  'maxHits',
  'maxInputBytes',
  'maxPaths',
  'maxPatterns',
  'maxRules',
  'maxSearchWork',
] as const satisfies readonly (keyof ExactSemanticScanBudgets)[]

export type ExactSemanticResultKind = 'audit-reference' | 'candidate' | 'generated-mirror'

export type ExactSemanticScanRule = {
  excludedPaths: string[]
  id: string
  includedExtensions: string[]
  matchProfile: string
  pathScopes: string[]
  patternGroups: string[][]
  resultKind: string
}

export type ExactSemanticMatch = {
  byteEnd: number
  byteStart: number
  codeUnitEnd: number
  codeUnitStart: number
  groupIndex: number
  path: string
  pattern: string
  resultKind: ExactSemanticResultKind
  ruleId: string
  sourceHash: string
}

export type ExactSemanticScanDiagnosticCode =
  | 'semantic-scan.blob-path-invalid'
  | 'semantic-scan.budget-invalid'
  | 'semantic-scan.excluded-path-approval-required'
  | 'semantic-scan.excluded-path-duplicate'
  | 'semantic-scan.excluded-path-empty'
  | 'semantic-scan.excluded-path-invalid'
  | 'semantic-scan.excluded-paths-invalid'
  | 'semantic-scan.included-extension-duplicate'
  | 'semantic-scan.included-extension-invalid'
  | 'semantic-scan.included-extensions-empty'
  | 'semantic-scan.included-extensions-invalid'
  | 'semantic-scan.match-profile-unsupported'
  | 'semantic-scan.no-rules'
  | 'semantic-scan.hit-budget-exhausted'
  | 'semantic-scan.input-byte-budget-exhausted'
  | 'semantic-scan.path-budget-exhausted'
  | 'semantic-scan.path-scope-duplicate'
  | 'semantic-scan.path-scope-empty'
  | 'semantic-scan.path-scope-invalid'
  | 'semantic-scan.path-scopes-empty'
  | 'semantic-scan.path-scopes-invalid'
  | 'semantic-scan.pattern-group-empty'
  | 'semantic-scan.pattern-group-invalid'
  | 'semantic-scan.pattern-groups-empty'
  | 'semantic-scan.pattern-groups-invalid'
  | 'semantic-scan.pattern-empty'
  | 'semantic-scan.pattern-budget-exhausted'
  | 'semantic-scan.pattern-duplicate'
  | 'semantic-scan.pattern-invalid-unicode'
  | 'semantic-scan.patterns-legacy-unsupported'
  | 'semantic-scan.result-kind-unsupported'
  | 'semantic-scan.rule-id-duplicate'
  | 'semantic-scan.rule-id-empty'
  | 'semantic-scan.rule-budget-exhausted'
  | 'semantic-scan.scope-unresolved'
  | 'semantic-scan.search-work-budget-exhausted'
  | 'semantic-scan.source-invalid-utf8'

export type ExactSemanticScanDiagnostic = {
  code: ExactSemanticScanDiagnosticCode
  kind: 'approval-required' | 'invalid-input' | 'unresolved-source'
  message: string
  path: string | null
  ruleId: string | null
  value: string | null
}

export type ExactSemanticScanResult = {
  complete: boolean
  matches: ExactSemanticMatch[]
  unresolved: ExactSemanticScanDiagnostic[]
  visited: {
    paths: string[]
    ruleIds: string[]
  }
}

type NormalizedRule = {
  excludedPaths: string[]
  id: string
  includedExtensions: string[]
  pathScopes: string[]
  patternGroups: string[][]
  resultKind: ExactSemanticResultKind
}

type DecodedBlob = {
  sourceHash: string
} & ({
  byteOffsets: number[]
  source: string
  status: 'decoded'
} | {
  status: 'invalid-utf8'
})

type ExactSemanticScanPlan = {
  rule: NormalizedRule
  selectedPaths: string[]
}

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

function duplicateStrings(values: readonly unknown[]): string[] {
  const duplicates = new Set<string>()
  const seen = new Set<string>()
  for (const value of values) {
    if (typeof value !== 'string') continue
    if (seen.has(value)) duplicates.add(value)
    seen.add(value)
  }
  return [...duplicates].sort(compareCodeUnits)
}

function containsControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index)
    if (codeUnit <= 0x1f || codeUnit === 0x7f) return true
  }
  return false
}

function isCanonicalRepositoryRelativePath(value: string): boolean {
  if (
    value.length === 0
    || value.startsWith('/')
    || value.endsWith('/')
    || value.includes('\\')
    || /^[A-Za-z]:\//.test(value)
    || containsControlCharacter(value)
    || !isWellFormedUtf16(value)
  ) return false
  const segments = value.split('/')
  return segments.every(segment => segment.length > 0 && segment !== '.' && segment !== '..')
}

function matchesPathBoundary(path: string, boundary: string): boolean {
  return path === boundary || path.startsWith(`${boundary}/`)
}

function hasIncludedExtension(path: string, extensions: readonly string[]): boolean {
  return extensions.some(extension => path.endsWith(extension))
}

function isCanonicalIncludedExtension(value: string): boolean {
  return /^\.[A-Za-z0-9]+(?:\.[A-Za-z0-9]+)*$/.test(value)
}

function isExactSemanticResultKind(value: unknown): value is ExactSemanticResultKind {
  return value === 'candidate' || value === 'audit-reference' || value === 'generated-mirror'
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

function utf8Length(codePoint: number): number {
  if (codePoint <= 0x7f) return 1
  if (codePoint <= 0x7ff) return 2
  if (codePoint <= 0xffff) return 3
  return 4
}

function buildUtf8ByteOffsets(source: string): number[] {
  const offsets = new Array<number>(source.length + 1)
  let byteOffset = 0
  let codeUnitOffset = 0
  offsets[0] = 0
  while (codeUnitOffset < source.length) {
    const codePoint = source.codePointAt(codeUnitOffset)
    if (codePoint === undefined) break
    const codeUnitLength = codePoint > 0xffff ? 2 : 1
    byteOffset += utf8Length(codePoint)
    codeUnitOffset += codeUnitLength
    offsets[codeUnitOffset] = byteOffset
  }
  return offsets
}

function diagnostic(
  code: ExactSemanticScanDiagnosticCode,
  kind: ExactSemanticScanDiagnostic['kind'],
  message: string,
  ruleId: string | null,
  path: string | null = null,
  value: string | null = null,
): ExactSemanticScanDiagnostic {
  return { code, kind, message, path, ruleId, value }
}

function finalizeResult(
  matches: ExactSemanticMatch[],
  unresolved: ExactSemanticScanDiagnostic[],
  visitedPaths: ReadonlySet<string> = new Set(),
  visitedRuleIds: ReadonlySet<string> = new Set(),
): ExactSemanticScanResult {
  matches.sort(compareMatches)
  unresolved.sort(compareDiagnostics)
  return {
    complete: unresolved.length === 0,
    matches,
    unresolved,
    visited: {
      paths: [...visitedPaths].sort(compareCodeUnits),
      ruleIds: [...visitedRuleIds].sort(compareCodeUnits),
    },
  }
}

function invalidBudgetDiagnostic(
  key: keyof ExactSemanticScanBudgets,
  value: unknown,
): ExactSemanticScanDiagnostic {
  return diagnostic(
    'semantic-scan.budget-invalid',
    'invalid-input',
    `Exact semantic scan budget ${key} must be a non-negative safe integer.`,
    null,
    null,
    `${key}=${String(value)}`,
  )
}

function exhaustedBudgetDiagnostic(
  code: Extract<ExactSemanticScanDiagnosticCode,
    | 'semantic-scan.hit-budget-exhausted'
    | 'semantic-scan.input-byte-budget-exhausted'
    | 'semantic-scan.path-budget-exhausted'
    | 'semantic-scan.pattern-budget-exhausted'
    | 'semantic-scan.rule-budget-exhausted'
    | 'semantic-scan.search-work-budget-exhausted'>,
  label: string,
  limit: number,
  required: bigint | number,
): ExactSemanticScanDiagnostic {
  return diagnostic(
    code,
    'unresolved-source',
    `Exact semantic scan ${label} budget exhausted: limit ${limit}, requires at least ${String(required)}.`,
    null,
    null,
    `limit=${limit};required=${String(required)}`,
  )
}

function validateBudgets(budgets: ExactSemanticScanBudgets): ExactSemanticScanDiagnostic[] {
  return EXACT_SEMANTIC_SCAN_BUDGET_KEYS
    .filter(key => !Number.isSafeInteger(budgets[key]) || budgets[key] < 0)
    .map(key => invalidBudgetDiagnostic(key, budgets[key]))
}

function countPatternsThroughLimit(
  rules: readonly ExactSemanticScanRule[],
  maxPatterns: number,
): number | null {
  let patternCount = 0
  for (const rule of rules) {
    if (!Array.isArray(rule.patternGroups)) continue
    for (const group of rule.patternGroups) {
      if (!Array.isArray(group)) continue
      if (group.length > maxPatterns - patternCount) return null
      patternCount += group.length
    }
  }
  return patternCount
}

function normalizeRule(
  rule: ExactSemanticScanRule,
  duplicateRuleIds: ReadonlySet<string>,
  unresolved: ExactSemanticScanDiagnostic[],
): NormalizedRule | null {
  if (typeof rule.id !== 'string' || rule.id.length === 0) {
    unresolved.push(diagnostic(
      'semantic-scan.rule-id-empty',
      'invalid-input',
      'Semantic scan rule id must be a non-empty string.',
      null,
    ))
    return null
  }
  const ruleId = rule.id
  if (duplicateRuleIds.has(ruleId)) return null

  let valid = true
  if (rule.matchProfile !== EXACT_SEMANTIC_MATCH_PROFILE) {
    unresolved.push(diagnostic(
      'semantic-scan.match-profile-unsupported',
      'invalid-input',
      `Semantic scan rule ${ruleId} uses unsupported match profile ${String(rule.matchProfile)}.`,
      ruleId,
      null,
      String(rule.matchProfile),
    ))
    valid = false
  }
  const resultKind = isExactSemanticResultKind(rule.resultKind) ? rule.resultKind : null
  if (!resultKind) {
    unresolved.push(diagnostic(
      'semantic-scan.result-kind-unsupported',
      'invalid-input',
      `Semantic scan rule ${ruleId} uses an unsupported result kind.`,
      ruleId,
      null,
      String(rule.resultKind),
    ))
    valid = false
  }

  if (!Array.isArray(rule.pathScopes)) {
    unresolved.push(diagnostic(
      'semantic-scan.path-scopes-invalid',
      'invalid-input',
      `Semantic scan rule ${ruleId} pathScopes must be an array.`,
      ruleId,
    ))
    valid = false
  } else if (rule.pathScopes.length === 0) {
    unresolved.push(diagnostic(
      'semantic-scan.path-scopes-empty',
      'invalid-input',
      `Semantic scan rule ${ruleId} must declare at least one path scope.`,
      ruleId,
    ))
    valid = false
  } else {
    for (const scope of rule.pathScopes) {
      if (typeof scope !== 'string' || scope.length === 0) {
        unresolved.push(diagnostic(
          'semantic-scan.path-scope-empty',
          'invalid-input',
          `Semantic scan rule ${ruleId} contains an empty path scope.`,
          ruleId,
        ))
        valid = false
      } else if (!isCanonicalRepositoryRelativePath(scope)) {
        unresolved.push(diagnostic(
          'semantic-scan.path-scope-invalid',
          'invalid-input',
          `Semantic scan rule ${ruleId} contains a non-canonical repository-relative path scope.`,
          ruleId,
          null,
          scope,
        ))
        valid = false
      }
    }
    for (const scope of duplicateStrings(rule.pathScopes)) {
      unresolved.push(diagnostic(
        'semantic-scan.path-scope-duplicate',
        'invalid-input',
        `Semantic scan rule ${ruleId} contains a duplicate path scope.`,
        ruleId,
        null,
        scope,
      ))
      valid = false
    }
  }

  if (Object.prototype.hasOwnProperty.call(rule, 'patterns')) {
    unresolved.push(diagnostic(
      'semantic-scan.patterns-legacy-unsupported',
      'invalid-input',
      `Semantic scan rule ${ruleId} uses the unsupported legacy patterns field.`,
      ruleId,
    ))
    valid = false
  }

  if (!Array.isArray(rule.patternGroups)) {
    unresolved.push(diagnostic(
      'semantic-scan.pattern-groups-invalid',
      'invalid-input',
      `Semantic scan rule ${ruleId} patternGroups must be an array.`,
      ruleId,
    ))
    valid = false
  } else if (rule.patternGroups.length === 0) {
    unresolved.push(diagnostic(
      'semantic-scan.pattern-groups-empty',
      'invalid-input',
      `Semantic scan rule ${ruleId} must declare at least one pattern group.`,
      ruleId,
    ))
    valid = false
  } else {
    const flattenedPatterns: unknown[] = []
    for (const [groupIndex, group] of rule.patternGroups.entries()) {
      if (!Array.isArray(group)) {
        unresolved.push(diagnostic(
          'semantic-scan.pattern-group-invalid',
          'invalid-input',
          `Semantic scan rule ${ruleId} pattern group ${groupIndex} must be an array.`,
          ruleId,
          null,
          String(groupIndex),
        ))
        valid = false
        continue
      }
      if (group.length === 0) {
        unresolved.push(diagnostic(
          'semantic-scan.pattern-group-empty',
          'invalid-input',
          `Semantic scan rule ${ruleId} pattern group ${groupIndex} must not be empty.`,
          ruleId,
          null,
          String(groupIndex),
        ))
        valid = false
        continue
      }
      for (const pattern of group) {
        flattenedPatterns.push(pattern)
        if (typeof pattern !== 'string' || pattern.length === 0) {
          unresolved.push(diagnostic(
            'semantic-scan.pattern-empty',
            'invalid-input',
            `Semantic scan rule ${ruleId} contains an empty literal pattern.`,
            ruleId,
            null,
            String(groupIndex),
          ))
          valid = false
        } else if (!isWellFormedUtf16(pattern)) {
          unresolved.push(diagnostic(
            'semantic-scan.pattern-invalid-unicode',
            'invalid-input',
            `Semantic scan rule ${ruleId} contains a pattern with an unpaired UTF-16 surrogate.`,
            ruleId,
            null,
            pattern,
          ))
          valid = false
        }
      }
    }
    for (const pattern of duplicateStrings(flattenedPatterns)) {
      unresolved.push(diagnostic(
        'semantic-scan.pattern-duplicate',
        'invalid-input',
        `Semantic scan rule ${ruleId} contains a duplicate literal pattern.`,
        ruleId,
        null,
        pattern,
      ))
      valid = false
    }
  }

  if (!Array.isArray(rule.includedExtensions)) {
    unresolved.push(diagnostic(
      'semantic-scan.included-extensions-invalid',
      'invalid-input',
      `Semantic scan rule ${ruleId} includedExtensions must be an array.`,
      ruleId,
    ))
    valid = false
  } else if (rule.includedExtensions.length === 0) {
    unresolved.push(diagnostic(
      'semantic-scan.included-extensions-empty',
      'invalid-input',
      `Semantic scan rule ${ruleId} must declare at least one included extension.`,
      ruleId,
    ))
    valid = false
  } else {
    for (const extension of rule.includedExtensions) {
      if (typeof extension !== 'string' || !isCanonicalIncludedExtension(extension)) {
        unresolved.push(diagnostic(
          'semantic-scan.included-extension-invalid',
          'invalid-input',
          `Semantic scan rule ${ruleId} contains an invalid included extension.`,
          ruleId,
          null,
          typeof extension === 'string' ? extension : String(extension),
        ))
        valid = false
      }
    }
    for (const extension of duplicateStrings(rule.includedExtensions)) {
      unresolved.push(diagnostic(
        'semantic-scan.included-extension-duplicate',
        'invalid-input',
        `Semantic scan rule ${ruleId} contains a duplicate included extension.`,
        ruleId,
        null,
        extension,
      ))
      valid = false
    }
  }

  if (!Array.isArray(rule.excludedPaths)) {
    unresolved.push(diagnostic(
      'semantic-scan.excluded-paths-invalid',
      'invalid-input',
      `Semantic scan rule ${ruleId} excludedPaths must be an array.`,
      ruleId,
    ))
    valid = false
  } else {
    for (const excludedPath of rule.excludedPaths) {
      if (typeof excludedPath !== 'string' || excludedPath.length === 0) {
        unresolved.push(diagnostic(
          'semantic-scan.excluded-path-empty',
          'invalid-input',
          `Semantic scan rule ${ruleId} contains an empty excluded path.`,
          ruleId,
        ))
        valid = false
      } else if (!isCanonicalRepositoryRelativePath(excludedPath)) {
        unresolved.push(diagnostic(
          'semantic-scan.excluded-path-invalid',
          'invalid-input',
          `Semantic scan rule ${ruleId} contains a non-canonical repository-relative excluded path.`,
          ruleId,
          null,
          excludedPath,
        ))
        valid = false
      }
    }
    for (const excludedPath of duplicateStrings(rule.excludedPaths)) {
      unresolved.push(diagnostic(
        'semantic-scan.excluded-path-duplicate',
        'invalid-input',
        `Semantic scan rule ${ruleId} contains a duplicate excluded path.`,
        ruleId,
        null,
        excludedPath,
      ))
      valid = false
    }
  }

  if (!valid || !resultKind) return null
  return {
    excludedPaths: sortedUnique(rule.excludedPaths),
    id: ruleId,
    includedExtensions: sortedUnique(rule.includedExtensions),
    pathScopes: sortedUnique(rule.pathScopes),
    patternGroups: rule.patternGroups.map(group => sortedUnique(group)),
    resultKind,
  }
}

function compareMatches(left: ExactSemanticMatch, right: ExactSemanticMatch): number {
  return compareCodeUnits(left.path, right.path)
    || left.codeUnitStart - right.codeUnitStart
    || left.codeUnitEnd - right.codeUnitEnd
    || compareCodeUnits(left.ruleId, right.ruleId)
    || left.groupIndex - right.groupIndex
    || compareCodeUnits(left.pattern, right.pattern)
    || compareCodeUnits(left.resultKind, right.resultKind)
    || compareCodeUnits(left.sourceHash, right.sourceHash)
}

function compareDiagnostics(
  left: ExactSemanticScanDiagnostic,
  right: ExactSemanticScanDiagnostic,
): number {
  return compareCodeUnits(left.code, right.code)
    || compareNullableCodeUnits(left.ruleId, right.ruleId)
    || compareNullableCodeUnits(left.path, right.path)
    || compareNullableCodeUnits(left.value, right.value)
    || compareCodeUnits(left.kind, right.kind)
    || compareCodeUnits(left.message, right.message)
}

export function scanExactSemanticBlobs(
  blobsByPath: ReadonlyMap<string, Uint8Array>,
  rules: readonly ExactSemanticScanRule[],
  budgetOverrides: ExactSemanticScanBudgetOverrides = {},
): ExactSemanticScanResult {
  const budgets: ExactSemanticScanBudgets = {
    ...DEFAULT_EXACT_SEMANTIC_SCAN_BUDGETS,
    ...budgetOverrides,
  }
  const budgetIssues = validateBudgets(budgets)
  if (budgetIssues.length > 0) return finalizeResult([], budgetIssues)

  const cardinalityIssues: ExactSemanticScanDiagnostic[] = []
  if (blobsByPath.size > budgets.maxPaths) {
    cardinalityIssues.push(exhaustedBudgetDiagnostic(
      'semantic-scan.path-budget-exhausted',
      'blob path count',
      budgets.maxPaths,
      budgets.maxPaths + 1,
    ))
  }
  if (rules.length > budgets.maxRules) {
    cardinalityIssues.push(exhaustedBudgetDiagnostic(
      'semantic-scan.rule-budget-exhausted',
      'rule count',
      budgets.maxRules,
      budgets.maxRules + 1,
    ))
  }
  if (cardinalityIssues.length > 0) return finalizeResult([], cardinalityIssues)

  const rawBlobPaths = [...blobsByPath.keys()]
  const invalidBlobPaths = rawBlobPaths
    .filter(path => typeof path !== 'string' || !isCanonicalRepositoryRelativePath(path))
    .map(path => diagnostic(
      'semantic-scan.blob-path-invalid',
      'invalid-input',
      'Semantic scan blob map contains a non-canonical repository-relative path.',
      null,
      typeof path === 'string' ? path : null,
      String(path),
    ))
  if (invalidBlobPaths.length > 0) return finalizeResult([], invalidBlobPaths)

  const blobPaths = rawBlobPaths.sort(compareCodeUnits)
  let inputBytes = 0n
  for (const path of blobPaths) {
    const bytes = blobsByPath.get(path)
    if (!bytes) continue
    inputBytes += BigInt(bytes.byteLength)
    if (inputBytes > BigInt(budgets.maxInputBytes)) {
      return finalizeResult([], [exhaustedBudgetDiagnostic(
        'semantic-scan.input-byte-budget-exhausted',
        'aggregate input byte count',
        budgets.maxInputBytes,
        inputBytes,
      )])
    }
  }

  const patternCount = countPatternsThroughLimit(rules, budgets.maxPatterns)
  if (patternCount === null) {
    return finalizeResult([], [exhaustedBudgetDiagnostic(
      'semantic-scan.pattern-budget-exhausted',
      'literal pattern count',
      budgets.maxPatterns,
      budgets.maxPatterns + 1,
    )])
  }

  const matches: ExactSemanticMatch[] = []
  const unresolved: ExactSemanticScanDiagnostic[] = []
  const visitedPaths = new Set<string>()
  const visitedRuleIds = new Set<string>()
  const decodedBlobs = new Map<string, DecodedBlob>()

  if (rules.length === 0) {
    unresolved.push(diagnostic(
      'semantic-scan.no-rules',
      'invalid-input',
      'At least one exact semantic scan rule is required.',
      null,
    ))
  }

  const ruleIdCounts = new Map<string, number>()
  for (const rule of rules) {
    if (typeof rule.id !== 'string' || rule.id.length === 0) continue
    ruleIdCounts.set(rule.id, (ruleIdCounts.get(rule.id) ?? 0) + 1)
  }
  const duplicateRuleIds = new Set([...ruleIdCounts]
    .filter(([, count]) => count > 1)
    .map(([ruleId]) => ruleId))
  for (const ruleId of [...duplicateRuleIds].sort(compareCodeUnits)) {
    unresolved.push(diagnostic(
      'semantic-scan.rule-id-duplicate',
      'invalid-input',
      `Semantic scan rule id is duplicated: ${ruleId}.`,
      ruleId,
      null,
      ruleId,
    ))
  }

  const normalizedRules = rules
    .map(rule => normalizeRule(rule, duplicateRuleIds, unresolved))
    .filter((rule): rule is NormalizedRule => rule !== null)
    .sort((left, right) => compareCodeUnits(left.id, right.id))

  const scanPlans: ExactSemanticScanPlan[] = []
  const planningDiagnostics: ExactSemanticScanDiagnostic[] = []
  let searchWork = 0n
  for (const rule of normalizedRules) {
    for (const excludedPath of rule.excludedPaths) {
      planningDiagnostics.push(diagnostic(
        'semantic-scan.excluded-path-approval-required',
        'approval-required',
        `Semantic scan rule ${rule.id} excludes ${excludedPath}; completeness requires explicit approval.`,
        rule.id,
        excludedPath,
        excludedPath,
      ))
    }

    const resolvedScopes = new Set<string>()
    const selectedPaths: string[] = []
    const rulePatternCount = rule.patternGroups
      .reduce((count, group) => count + group.length, 0)
    const selectorWorkPerPath = 1
      + rule.includedExtensions.length
      + rule.pathScopes.length
      + rule.excludedPaths.length
    for (const path of blobPaths) {
      searchWork += BigInt(selectorWorkPerPath)
      if (searchWork > BigInt(budgets.maxSearchWork)) {
        return finalizeResult([], [
          ...unresolved,
          exhaustedBudgetDiagnostic(
            'semantic-scan.search-work-budget-exhausted',
            'path-selection and literal-search work',
            budgets.maxSearchWork,
            searchWork,
          ),
        ])
      }

      if (!hasIncludedExtension(path, rule.includedExtensions)) continue
      const matchingScopes = rule.pathScopes
        .filter(scope => matchesPathBoundary(path, scope))
      for (const scope of matchingScopes) resolvedScopes.add(scope)
      if (matchingScopes.length === 0) continue
      if (rule.excludedPaths.some(excludedPath => matchesPathBoundary(path, excludedPath))) {
        continue
      }

      const bytes = blobsByPath.get(path)
      const literalSearchWork = BigInt(bytes?.byteLength || 0) * BigInt(rulePatternCount)
      searchWork += literalSearchWork
      if (searchWork > BigInt(budgets.maxSearchWork)) {
        return finalizeResult([], [
          ...unresolved,
          exhaustedBudgetDiagnostic(
            'semantic-scan.search-work-budget-exhausted',
            'path-selection and literal-search work',
            budgets.maxSearchWork,
            searchWork,
          ),
        ])
      }
      selectedPaths.push(path)
    }

    for (const scope of rule.pathScopes) {
      if (!resolvedScopes.has(scope)) {
        planningDiagnostics.push(diagnostic(
          'semantic-scan.scope-unresolved',
          'unresolved-source',
          `Semantic scan rule ${rule.id} scope resolved to no included blobs: ${scope}.`,
          rule.id,
          null,
          scope,
        ))
      }
    }
    scanPlans.push({ rule, selectedPaths })
  }
  unresolved.push(...planningDiagnostics)

  let hitCount = 0
  for (const { rule, selectedPaths } of scanPlans) {
    visitedRuleIds.add(rule.id)
    for (const path of selectedPaths) {
      visitedPaths.add(path)
      let decoded = decodedBlobs.get(path)
      if (!decoded) {
        const bytes = blobsByPath.get(path)
        if (!bytes) continue
        const sourceHash = sha256Bytes(Buffer.from(bytes))
        try {
          const source = decodeUtf8Bytes(bytes, path)
          decoded = {
            byteOffsets: buildUtf8ByteOffsets(source),
            source,
            sourceHash,
            status: 'decoded',
          }
        } catch {
          decoded = { sourceHash, status: 'invalid-utf8' }
        }
        decodedBlobs.set(path, decoded)
      }

      if (decoded.status === 'invalid-utf8') {
        unresolved.push(diagnostic(
          'semantic-scan.source-invalid-utf8',
          'unresolved-source',
          `Semantic scan rule ${rule.id} cannot scan invalid UTF-8 source: ${path}.`,
          rule.id,
          path,
          decoded.sourceHash,
        ))
        continue
      }

      const matchesByGroup: ExactSemanticMatch[][] = []
      for (const [groupIndex, patterns] of rule.patternGroups.entries()) {
        const groupMatches: ExactSemanticMatch[] = []
        for (const pattern of patterns) {
          let codeUnitStart = decoded.source.indexOf(pattern)
          while (codeUnitStart >= 0) {
            if (hitCount >= budgets.maxHits) {
              return finalizeResult([], [
                ...unresolved,
                exhaustedBudgetDiagnostic(
                  'semantic-scan.hit-budget-exhausted',
                  'literal hit count',
                  budgets.maxHits,
                  budgets.maxHits + 1,
                ),
              ], visitedPaths, visitedRuleIds)
            }
            hitCount += 1
            const codeUnitEnd = codeUnitStart + pattern.length
            const byteStart = decoded.byteOffsets[codeUnitStart]
            const byteEnd = decoded.byteOffsets[codeUnitEnd]
            if (byteStart === undefined || byteEnd === undefined) {
              throw new Error(`Semantic scan produced a non-UTF-8-boundary match in ${path}`)
            }
            groupMatches.push({
              byteEnd,
              byteStart,
              codeUnitEnd,
              codeUnitStart,
              groupIndex,
              path,
              pattern,
              resultKind: rule.resultKind,
              ruleId: rule.id,
              sourceHash: decoded.sourceHash,
            })
            codeUnitStart = decoded.source.indexOf(pattern, codeUnitStart + 1)
          }
        }
        matchesByGroup.push(groupMatches)
      }
      if (matchesByGroup.some(groupMatches => groupMatches.length === 0)) continue
      for (const groupMatches of matchesByGroup) matches.push(...groupMatches)
    }
  }

  return finalizeResult(matches, unresolved, visitedPaths, visitedRuleIds)
}
