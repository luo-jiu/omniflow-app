import {
  getGitAncestryState,
  gitCommitTouchesPath,
  readGitCommitParents,
  readGitPathAtCommit,
  tryResolveGitCommit,
} from './git-input.ts'
import { decodeUtf8Bytes, getString, getStringArray, isJsonObject, sha256Bytes } from './json.ts'
import { inspectSourceLocator, normalizeSourceLocatorKind } from './source-locator.ts'
import { createIssue, type JsonObject, type ValidationIssue } from './types.ts'

const EXACT_COMMIT_PATTERN = /^[0-9a-f]{40}$/
const CANONICAL_REPOSITORY_PATH_PATTERN = /^(?!(?:.*\/)?\.{1,2}(?:\/|$))(?!.*\/\/)(?!\/)(?!.*\\).+$/
const EXTERNAL_PROCESS_TARGET_PATTERN = /^external-process\/[a-z0-9][a-z0-9._-]*$/

type LocatedObject = {
  index: number
  path: string
  value: JsonObject
}

type ExactClosureDocuments = {
  capabilityLedger: JsonObject
  inventory: JsonObject
}

type Locator = {
  locatorKind: string | null
  path: string
  symbol: string | null
}

export type ExactCommitClosureInvariantValidationResult = {
  canGenerateReport: boolean
  exactCommit: string | null
  issues: ValidationIssue[]
}

function error(code: string, message: string, issuePath?: string): ValidationIssue {
  return createIssue('error', code, message, issuePath)
}

function isCanonicalRepositoryPath(relativePath: string): boolean {
  return CANONICAL_REPOSITORY_PATH_PATTERN.test(relativePath)
    && ![...relativePath].some(character => {
      const codePoint = character.codePointAt(0) ?? 0
      return codePoint <= 0x1f || codePoint === 0x7f
    })
}

function readExactJsonObject(
  repositoryRoot: string,
  commit: string,
  relativePath: string,
  issues: ValidationIssue[],
): JsonObject | null {
  const state = readGitPathAtCommit(repositoryRoot, commit, relativePath)
  if (state.status !== 'present') {
    issues.push(error(
      state.status === 'absent'
        ? 'exact-closure-contract-missing'
        : 'exact-closure-contract-unavailable',
      `Exact-commit contract is ${state.status}: ${relativePath}`,
      relativePath,
    ))
    return null
  }

  let source: string
  try {
    source = decodeUtf8Bytes(state.bytes, `${commit}:${relativePath}`)
  } catch (cause) {
    issues.push(error(
      'exact-closure-contract-encoding-invalid',
      cause instanceof Error ? cause.message : String(cause),
      relativePath,
    ))
    return null
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(source)
  } catch (cause) {
    issues.push(error(
      'exact-closure-contract-json-invalid',
      `Exact-commit contract is not valid JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
      relativePath,
    ))
    return null
  }
  if (!isJsonObject(parsed)) {
    issues.push(error(
      'exact-closure-contract-root-invalid',
      'Exact-commit contract must contain a JSON object',
      relativePath,
    ))
    return null
  }
  return parsed
}

function readObjectArray(
  document: JsonObject,
  property: string,
  documentPath: string,
  issues: ValidationIssue[],
): LocatedObject[] {
  const value = document[property]
  if (!Array.isArray(value)) {
    issues.push(error(
      'exact-closure-collection-invalid',
      `${documentPath}.${property} must be an array`,
      `${documentPath}.${property}`,
    ))
    return []
  }
  return value.flatMap((item, index) => {
    const itemPath = `${documentPath}.${property}[${index}]`
    if (isJsonObject(item)) return [{ index, path: itemPath, value: item }]
    issues.push(error(
      'exact-closure-record-invalid',
      `${itemPath} must be an object`,
      itemPath,
    ))
    return []
  })
}

function indexByStringField(
  records: LocatedObject[],
  field: string,
  label: string,
  issues: ValidationIssue[],
): Map<string, LocatedObject[]> {
  const index = new Map<string, LocatedObject[]>()
  for (const record of records) {
    const id = getString(record.value[field])
    if (!id) {
      issues.push(error(
        'exact-closure-id-invalid',
        `${label} ${field} must be a non-empty string`,
        `${record.path}.${field}`,
      ))
      continue
    }
    const matches = index.get(id) || []
    matches.push(record)
    index.set(id, matches)
    if (matches.length === 2) {
      issues.push(error(
        'exact-closure-duplicate-id',
        `Duplicate ${label} ${field}: ${id}`,
        `${record.path}.${field}`,
      ))
    }
  }
  return index
}

function normalizeLocator(
  value: JsonObject,
  issuePath: string,
  issues: ValidationIssue[],
): Locator | null {
  const relativePath = getString(value.path)
  if (!relativePath || !isCanonicalRepositoryPath(relativePath)) {
    issues.push(error(
      'exact-closure-locator-path-invalid',
      `Locator path must be canonical and repository-relative: ${relativePath || 'missing'}`,
      `${issuePath}.path`,
    ))
    return null
  }
  const symbol = value.symbol === null ? null : getString(value.symbol)
  if (symbol === null && value.symbol !== null) {
    issues.push(error(
      'exact-closure-locator-symbol-invalid',
      'Locator symbol must be a non-empty string or null',
      `${issuePath}.symbol`,
    ))
    return null
  }
  if (symbol === null) {
    if (value.locatorKind !== undefined) {
      issues.push(error(
        'exact-closure-locator-kind-without-symbol',
        'locatorKind is forbidden when symbol is null',
        `${issuePath}.locatorKind`,
      ))
      return null
    }
    return { locatorKind: null, path: relativePath, symbol: null }
  }
  const locatorKind = normalizeSourceLocatorKind(value.locatorKind)
  if (!locatorKind) {
    issues.push(error(
      'exact-closure-locator-kind-invalid',
      `Unknown locatorKind: ${String(value.locatorKind)}`,
      `${issuePath}.locatorKind`,
    ))
    return null
  }
  return { locatorKind, path: relativePath, symbol }
}

function locatorKey(locator: Locator): string {
  return JSON.stringify([locator.path, locator.symbol, locator.locatorKind])
}

function externalProcessNodeId(relativePath: string): string {
  return `external-process.${relativePath.slice('external-process/'.length)}`
}

function inspectExactLocatorAtCommit(
  repositoryRoot: string,
  commit: string,
  locator: Locator,
): 'absent' | 'matched' | 'unverifiable' {
  const state = readGitPathAtCommit(repositoryRoot, commit, locator.path)
  if (state.status === 'absent') return 'absent'
  if (state.status !== 'present') return 'unverifiable'
  if (locator.symbol === null) return 'matched'
  if (locator.locatorKind === null) return 'unverifiable'
  try {
    const source = decodeUtf8Bytes(state.bytes, `${commit}:${locator.path}`)
    const result = inspectSourceLocator(
      source,
      locator.path,
      locator.symbol,
      locator.locatorKind as 'declaration' | 'member' | 'runtime-literal',
    )
    if (result.status === 'matched') return 'matched'
    if (result.status === 'missing') return 'absent'
    return 'unverifiable'
  } catch {
    return 'unverifiable'
  }
}

function ownerRefKey(relativePath: string, symbol: string): string {
  return `${relativePath}#${symbol}`
}

function parseOwnerRef(ownerRef: string): { path: string; symbol: string } | null {
  const separatorIndex = ownerRef.lastIndexOf('#')
  if (separatorIndex <= 0 || separatorIndex === ownerRef.length - 1) return null
  const relativePath = ownerRef.slice(0, separatorIndex)
  const symbol = ownerRef.slice(separatorIndex + 1)
  return isCanonicalRepositoryPath(relativePath) ? { path: relativePath, symbol } : null
}

function indexLocators(
  records: LocatedObject[],
  label: string,
  issues: ValidationIssue[],
): {
  byKey: Map<string, LocatedObject[]>
  normalized: Map<LocatedObject, Locator>
} {
  const byKey = new Map<string, LocatedObject[]>()
  const normalized = new Map<LocatedObject, Locator>()
  for (const record of records) {
    const locator = normalizeLocator(record.value, record.path, issues)
    if (!locator) continue
    normalized.set(record, locator)
    const key = locatorKey(locator)
    const matches = byKey.get(key) || []
    matches.push(record)
    byKey.set(key, matches)
    if (matches.length === 2) {
      issues.push(error(
        'exact-closure-duplicate-locator',
        `Duplicate ${label} locator: ${locator.path}#${locator.symbol || '<path>'}`,
        record.path,
      ))
    }
  }
  return { byKey, normalized }
}

function oneRecord(
  index: Map<string, LocatedObject[]>,
  id: string | null,
): LocatedObject | null {
  if (!id) return null
  const matches = index.get(id) || []
  return matches.length === 1 ? matches[0] || null : null
}

function validateExactClosureDocuments(
  repositoryRoot: string,
  commit: string,
  documents: ExactClosureDocuments,
): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const ledgerPath = 'capability-ledger.json'
  const inventoryPath = 'legacy-inventory.json'

  const cutoverUnits = readObjectArray(
    documents.capabilityLedger,
    'cutoverUnits',
    ledgerPath,
    issues,
  )
  const capabilities = readObjectArray(
    documents.capabilityLedger,
    'capabilities',
    ledgerPath,
    issues,
  )
  const cutoverUnitsById = indexByStringField(cutoverUnits, 'id', 'cutover unit', issues)
  const capabilitiesById = indexByStringField(capabilities, 'id', 'capability', issues)

  const entries = readObjectArray(documents.inventory, 'entries', inventoryPath, issues)
  const roots = readObjectArray(documents.inventory, 'bootstrapRoots', inventoryPath, issues)
  const semanticRules = readObjectArray(documents.inventory, 'semanticScanRules', inventoryPath, issues)
  const historicalTouchsets = readObjectArray(documents.inventory, 'historicalTouchsets', inventoryPath, issues)
  const historicalCandidates = readObjectArray(documents.inventory, 'historicalCandidates', inventoryPath, issues)
  const dynamicEdges = readObjectArray(documents.inventory, 'declaredDynamicEdges', inventoryPath, issues)
  const approvedExclusions = readObjectArray(documents.inventory, 'approvedExclusions', inventoryPath, issues)

  const entriesById = indexByStringField(entries, 'id', 'inventory entry', issues)
  indexByStringField(roots, 'id', 'bootstrap root', issues)
  indexByStringField(semanticRules, 'id', 'semantic scan rule', issues)
  indexByStringField(historicalTouchsets, 'id', 'historical touchset', issues)
  indexByStringField(historicalCandidates, 'id', 'historical candidate', issues)
  indexByStringField(dynamicEdges, 'id', 'declared dynamic edge', issues)
  const approvedExclusionsById = indexByStringField(
    approvedExclusions,
    'id',
    'approved exclusion',
    issues,
  )

  const entryLocators = indexLocators(entries, 'inventory', issues)
  const currentNodes = entries.filter(record => record.value.entryType === 'current-node')
  const currentNodeLocators = {
    byKey: new Map<string, LocatedObject[]>(),
    normalized: new Map<LocatedObject, Locator>(),
  }
  for (const record of currentNodes) {
    const locator = entryLocators.normalized.get(record)
    if (!locator) continue
    currentNodeLocators.normalized.set(record, locator)
    const key = locatorKey(locator)
    const matches = currentNodeLocators.byKey.get(key) || []
    matches.push(record)
    currentNodeLocators.byKey.set(key, matches)
  }
  const exclusionLocators = indexLocators(approvedExclusions, 'approved exclusion', issues)
  const rootLocators = indexLocators(roots, 'bootstrap root', issues)

  for (const [key, exclusions] of exclusionLocators.byKey) {
    const currentMatches = currentNodeLocators.byKey.get(key) || []
    if (currentMatches.length === 0) continue
    const exclusion = exclusions.find(record => record.value.candidateKind === 'current')
    if (!exclusion) continue
    issues.push(error(
      'exact-closure-current-exclusion-locator-conflict',
      'A locator cannot be both a current inventory node and an approved exclusion',
      exclusion.path,
    ))
  }

  const currentNodesByOwnerRef = new Map<string, LocatedObject[]>()
  for (const record of currentNodes) {
    const locator = currentNodeLocators.normalized.get(record)
    if (!locator?.symbol) continue
    const key = ownerRefKey(locator.path, locator.symbol)
    const matches = currentNodesByOwnerRef.get(key) || []
    matches.push(record)
    currentNodesByOwnerRef.set(key, matches)
  }

  const fixturesByCapability = new Map<string, Set<string>>()
  const fixtureCapabilities = new Map<string, Set<string>>()
  for (const capability of capabilities) {
    const capabilityId = getString(capability.value.id)
    const cutoverUnitId = getString(capability.value.cutoverUnitId)
    if (cutoverUnitId && (cutoverUnitsById.get(cutoverUnitId) || []).length !== 1) {
      issues.push(error(
        'exact-closure-capability-cutover-ref-invalid',
        `Capability cutoverUnitId must resolve exactly once: ${cutoverUnitId}`,
        `${capability.path}.cutoverUnitId`,
      ))
    }
    if (!capabilityId) continue
    const fixtureIds = new Set(getStringArray(capability.value.fixtures))
    fixturesByCapability.set(capabilityId, fixtureIds)
    for (const fixtureId of fixtureIds) {
      const owners = fixtureCapabilities.get(fixtureId) || new Set<string>()
      owners.add(capabilityId)
      fixtureCapabilities.set(fixtureId, owners)
    }

    const ownerRefs = isJsonObject(capability.value.ownerRefs) ? capability.value.ownerRefs : null
    for (const [ownerIndex, ownerRef] of getStringArray(ownerRefs?.legacy).entries()) {
      const ownerPath = `${capability.path}.ownerRefs.legacy[${ownerIndex}]`
      const parsed = parseOwnerRef(ownerRef)
      if (!parsed) {
        issues.push(error(
          'exact-closure-legacy-owner-ref-invalid',
          `Legacy owner ref must use a canonical path#symbol locator: ${ownerRef}`,
          ownerPath,
        ))
        continue
      }
      const matches = currentNodesByOwnerRef.get(ownerRefKey(parsed.path, parsed.symbol)) || []
      if (matches.length !== 1) {
        issues.push(error(
          matches.length === 0
            ? 'exact-closure-legacy-owner-ref-unresolved'
            : 'exact-closure-legacy-owner-ref-ambiguous',
          `Legacy owner ref must resolve to exactly one current inventory entry: ${ownerRef}`,
          ownerPath,
        ))
        continue
      }
      const node = matches[0]?.value
      if (node?.capabilityId !== capabilityId) {
        issues.push(error(
          'exact-closure-legacy-owner-capability-mismatch',
          `Legacy owner ${ownerRef} is attributed to ${String(node?.capabilityId)}, not ${capabilityId}`,
          ownerPath,
        ))
      }
      if (node?.cutoverUnitId !== cutoverUnitId) {
        issues.push(error(
          'exact-closure-legacy-owner-cutover-mismatch',
          `Legacy owner ${ownerRef} is attributed to ${String(node?.cutoverUnitId)}, not ${cutoverUnitId}`,
          ownerPath,
        ))
      }
    }
  }

  for (const entry of entries) {
    const capabilityId = getString(entry.value.capabilityId)
    const cutoverUnitId = getString(entry.value.cutoverUnitId)
    const capability = oneRecord(capabilitiesById, capabilityId)
    if (capabilityId && !capability) {
      issues.push(error(
        'exact-closure-inventory-capability-ref-invalid',
        `Inventory capabilityId must resolve exactly once: ${capabilityId}`,
        `${entry.path}.capabilityId`,
      ))
    }
    if (cutoverUnitId && (cutoverUnitsById.get(cutoverUnitId) || []).length !== 1) {
      issues.push(error(
        'exact-closure-inventory-cutover-ref-invalid',
        `Inventory cutoverUnitId must resolve exactly once: ${cutoverUnitId}`,
        `${entry.path}.cutoverUnitId`,
      ))
    }
    if (capability && cutoverUnitId && capability.value.cutoverUnitId !== cutoverUnitId) {
      issues.push(error(
        'exact-closure-inventory-capability-cutover-mismatch',
        `Capability ${capabilityId} belongs to ${String(capability.value.cutoverUnitId)}, not ${cutoverUnitId}`,
        `${entry.path}.cutoverUnitId`,
      ))
    }
  }

  const tombstones = entries.filter(record => record.value.entryType === 'retired-tombstone')
  for (const tombstone of tombstones) {
    const locator = entryLocators.normalized.get(tombstone)
    const deletionCommit = getString(tombstone.value.deletionCommit)
    const deletedSourceHash = getString(tombstone.value.deletedSourceHash)
    if (!locator) continue
    const exactDeletionCommit = deletionCommit && EXACT_COMMIT_PATTERN.test(deletionCommit)
      ? tryResolveGitCommit(repositoryRoot, deletionCommit)
      : null
    if (!deletionCommit || exactDeletionCommit !== deletionCommit) {
      issues.push(error(
        'exact-closure-tombstone-deletion-commit-invalid',
        'Tombstone deletionCommit must identify an available lowercase 40-character commit object',
        `${tombstone.path}.deletionCommit`,
      ))
      continue
    }
    if (!deletedSourceHash) continue

    const ancestry = getGitAncestryState(repositoryRoot, deletionCommit, commit)
    if (ancestry !== 'ancestor') {
      issues.push(error(
        ancestry === 'not-ancestor'
          ? 'exact-closure-tombstone-deletion-after-input'
          : 'exact-closure-tombstone-deletion-commit-unavailable',
        `Tombstone deletionCommit must be available and ancestral to the selected commit: ${deletionCommit}`,
        `${tombstone.path}.deletionCommit`,
      ))
      continue
    }
    if (!gitCommitTouchesPath(repositoryRoot, deletionCommit, locator.path)) {
      issues.push(error(
        'exact-closure-tombstone-deletion-path-unproven',
        `Tombstone deletionCommit does not touch ${locator.path}`,
        `${tombstone.path}.deletionCommit`,
      ))
    }

    const deletionState = inspectExactLocatorAtCommit(repositoryRoot, deletionCommit, locator)
    if (deletionState !== 'absent') {
      issues.push(error(
        deletionState === 'matched'
          ? 'exact-closure-tombstone-locator-not-deleted'
          : 'exact-closure-tombstone-deletion-state-unverifiable',
        `Tombstone locator must be provably absent at its deletion commit: ${locator.path}#${locator.symbol || '<path>'}`,
        `${tombstone.path}.deletionCommit`,
      ))
    }

    const selectedState = inspectExactLocatorAtCommit(repositoryRoot, commit, locator)
    if (selectedState !== 'absent') {
      issues.push(error(
        selectedState === 'matched'
          ? 'exact-closure-tombstone-locator-current'
          : 'exact-closure-tombstone-current-state-unverifiable',
        `Tombstone locator must remain provably absent at the selected commit: ${locator.path}#${locator.symbol || '<path>'}`,
        tombstone.path,
      ))
    }

    const parents = readGitCommitParents(repositoryRoot, deletionCommit)
    if (!parents || parents.length === 0) {
      issues.push(error(
        'exact-closure-tombstone-parent-history-unavailable',
        `Tombstone deletion commit must have readable parent history: ${deletionCommit}`,
        `${tombstone.path}.deletionCommit`,
      ))
      continue
    }
    let deletedSourceMatched = false
    let parentStateUnverifiable = false
    for (const parent of parents) {
      const parentState = readGitPathAtCommit(repositoryRoot, parent, locator.path)
      if (parentState.status === 'unavailable') {
        parentStateUnverifiable = true
        continue
      }
      if (
        parentState.status === 'present'
        && sha256Bytes(parentState.bytes) === deletedSourceHash
        && inspectExactLocatorAtCommit(repositoryRoot, parent, locator) === 'matched'
      ) {
        deletedSourceMatched = true
        break
      }
    }
    if (!deletedSourceMatched) {
      issues.push(error(
        parentStateUnverifiable
          ? 'exact-closure-tombstone-deleted-source-unavailable'
          : 'exact-closure-tombstone-deleted-source-mismatch',
        `No deletion parent contains the declared source bytes and locator: ${locator.path}#${locator.symbol || '<path>'}`,
        `${tombstone.path}.deletedSourceHash`,
      ))
    }
  }

  for (const root of roots) {
    const locator = rootLocators.normalized.get(root)
    if (!locator) continue
    const key = locatorKey(locator)
    const matches = [
      ...(currentNodeLocators.byKey.get(key) || []),
      ...(exclusionLocators.byKey.get(key) || []).filter(record => record.value.candidateKind === 'current'),
    ]
    if (matches.length !== 1) {
      issues.push(error(
        'exact-closure-bootstrap-root-ref-invalid',
        `Bootstrap root locator must resolve exactly once: ${locator.path}#${locator.symbol || '<path>'}`,
        root.path,
      ))
    }
  }

  for (const candidate of historicalCandidates) {
    const lastKnownCommit = getString(candidate.value.lastKnownCommit)
    const candidateLocator = normalizeLocator(candidate.value, candidate.path, issues)
    const exactLastKnownCommit = lastKnownCommit && EXACT_COMMIT_PATTERN.test(lastKnownCommit)
      ? tryResolveGitCommit(repositoryRoot, lastKnownCommit)
      : null
    if (!lastKnownCommit || exactLastKnownCommit !== lastKnownCommit) {
      issues.push(error(
        'exact-closure-historical-commit-invalid',
        'Historical lastKnownCommit must identify an available lowercase 40-character commit object',
        `${candidate.path}.lastKnownCommit`,
      ))
    } else {
      const ancestry = getGitAncestryState(repositoryRoot, lastKnownCommit, commit)
      if (ancestry !== 'ancestor') {
        issues.push(error(
          ancestry === 'not-ancestor'
            ? 'exact-closure-historical-commit-after-input'
            : 'exact-closure-historical-commit-unavailable',
          `Historical lastKnownCommit must be available and ancestral to the selected commit: ${lastKnownCommit}`,
          `${candidate.path}.lastKnownCommit`,
        ))
      } else if (candidateLocator) {
        const sourceState = readGitPathAtCommit(
          repositoryRoot,
          lastKnownCommit,
          candidateLocator.path,
        )
        if (sourceState.status !== 'present') {
          issues.push(error(
            sourceState.status === 'absent'
              ? 'exact-closure-historical-source-missing'
              : 'exact-closure-historical-source-unavailable',
            `Historical source is ${sourceState.status} at ${lastKnownCommit}: ${candidateLocator.path}`,
            candidate.path,
          ))
        } else {
          const declaredSourceHash = getString(candidate.value.sourceHash)
          if (declaredSourceHash && sha256Bytes(sourceState.bytes) !== declaredSourceHash) {
            issues.push(error(
              'exact-closure-historical-source-hash-mismatch',
              `Historical source hash does not match ${lastKnownCommit}:${candidateLocator.path}`,
              `${candidate.path}.sourceHash`,
            ))
          }
          if (candidateLocator.symbol && candidateLocator.locatorKind) {
            try {
              const source = decodeUtf8Bytes(
                sourceState.bytes,
                `${lastKnownCommit}:${candidateLocator.path}`,
              )
              const result = inspectSourceLocator(
                source,
                candidateLocator.path,
                candidateLocator.symbol,
                candidateLocator.locatorKind as 'declaration' | 'member' | 'runtime-literal',
              )
              if (result.status !== 'matched') {
                issues.push(error(
                  'exact-closure-historical-source-locator-unverified',
                  `Historical source locator is ${result.status}: ${candidateLocator.path}#${candidateLocator.symbol}`,
                  `${candidate.path}.symbol`,
                ))
              }
            } catch (cause) {
              issues.push(error(
                'exact-closure-historical-source-encoding-invalid',
                cause instanceof Error ? cause.message : String(cause),
                candidate.path,
              ))
            }
          }
        }
      }
    }
    if (candidate.value.resolution === null) continue
    if (!isJsonObject(candidate.value.resolution)) {
      issues.push(error(
        'exact-closure-historical-resolution-invalid',
        'Historical resolution must be an object or null',
        `${candidate.path}.resolution`,
      ))
      continue
    }
    const kind = getString(candidate.value.resolution.kind)
    const refId = getString(candidate.value.resolution.refId)
    const target = kind === 'approved-exclusion'
      ? oneRecord(approvedExclusionsById, refId)
      : oneRecord(entriesById, refId)
    const targetKindMatches = kind === 'approved-exclusion'
      ? target?.value.candidateKind === 'historical'
      : target?.value.entryType === kind
    if (!target || !targetKindMatches) {
      issues.push(error(
        'exact-closure-historical-resolution-ref-invalid',
        `Historical resolution must reference exactly one ${kind || 'known record kind'}: ${refId || 'missing'}`,
        `${candidate.path}.resolution`,
      ))
      continue
    }
    const targetLocator = kind === 'approved-exclusion'
      ? exclusionLocators.normalized.get(target)
      : normalizeLocator(target.value, target.path, issues)
    if (
      candidateLocator
      && targetLocator
      && locatorKey(candidateLocator) !== locatorKey(targetLocator)
    ) {
      issues.push(error(
        'exact-closure-historical-resolution-locator-mismatch',
        `Historical resolution points to a different typed locator: ${refId}`,
        `${candidate.path}.resolution`,
      ))
    }
  }

  const seenDynamicSemantics = new Map<string, string>()
  for (const edge of dynamicEdges) {
    const edgeId = getString(edge.value.id) || String(edge.index)
    const kind = getString(edge.value.kind)
    const source = isJsonObject(edge.value.source) ? edge.value.source : null
    const target = isJsonObject(edge.value.target) ? edge.value.target : null
    const sourceLocator = source ? normalizeLocator(source, `${edge.path}.source`, issues) : null
    const targetLocator = target ? normalizeLocator(target, `${edge.path}.target`, issues) : null
    if (!source || !sourceLocator) {
      issues.push(error(
        'exact-closure-dynamic-source-ref-invalid',
        `Dynamic edge source locator is invalid: ${edgeId}`,
        `${edge.path}.source`,
      ))
      continue
    }
    if (!target || !targetLocator) {
      issues.push(error(
        'exact-closure-dynamic-target-ref-invalid',
        `Dynamic edge target locator is invalid: ${edgeId}`,
        `${edge.path}.target`,
      ))
      continue
    }
    if (kind) {
      const semanticKey = JSON.stringify([kind, locatorKey(sourceLocator), locatorKey(targetLocator)])
      const existing = seenDynamicSemantics.get(semanticKey)
      if (existing) {
        issues.push(error(
          'exact-closure-duplicate-dynamic-edge',
          `Dynamic edge duplicates ${existing}: ${edgeId}`,
          edge.path,
        ))
      } else {
        seenDynamicSemantics.set(semanticKey, edgeId)
      }
    }

    const sourceMatches = currentNodeLocators.byKey.get(locatorKey(sourceLocator)) || []
    if (sourceMatches.length !== 1) {
      issues.push(error(
        'exact-closure-dynamic-source-ref-invalid',
        `Dynamic source must resolve to exactly one current inventory node: ${edgeId}`,
        `${edge.path}.source`,
      ))
    }
    const externalProcessTarget = kind === 'process-handoff'
      && targetLocator.symbol === null
      && EXTERNAL_PROCESS_TARGET_PATTERN.test(targetLocator.path)
    if (kind === 'process-handoff' && !externalProcessTarget) {
      issues.push(error(
        'exact-closure-process-target-invalid',
        'process-handoff must target symbol-free external-process/<identifier>',
        `${edge.path}.target`,
      ))
    }
    if (kind !== 'process-handoff' && targetLocator.path.startsWith('external-process/')) {
      issues.push(error(
        'exact-closure-external-process-kind-mismatch',
        'Only process-handoff may target the external-process namespace',
        `${edge.path}.target`,
      ))
    }
    if (externalProcessTarget) {
      const virtualNodeId = externalProcessNodeId(targetLocator.path)
      const conflictingNode = currentNodes.find(record => getString(record.value.id) === virtualNodeId)
      if (conflictingNode) {
        issues.push(error(
          'exact-closure-external-process-node-id-conflict',
          `External process virtual node id conflicts with a current inventory node: ${virtualNodeId}`,
          `${edge.path}.target`,
        ))
      }
    }
    const targetMatches = externalProcessTarget
      ? []
      : currentNodeLocators.byKey.get(locatorKey(targetLocator)) || []
    if (!externalProcessTarget && targetMatches.length !== 1) {
      issues.push(error(
        'exact-closure-dynamic-target-ref-invalid',
        `Dynamic target must resolve to exactly one current inventory node: ${edgeId}`,
        `${edge.path}.target`,
      ))
    }

    const declaredSourceHash = getString(edge.value.sourceHash)
    const sourceNodeHash = sourceMatches.length === 1
      ? getString(sourceMatches[0]?.value.sourceHash)
      : null
    if (declaredSourceHash && sourceNodeHash && declaredSourceHash !== sourceNodeHash) {
      issues.push(error(
        'exact-closure-dynamic-source-hash-ref-mismatch',
        `Dynamic edge sourceHash differs from its inventory node: ${edgeId}`,
        `${edge.path}.sourceHash`,
      ))
    }

    const fixtureId = getString(edge.value.fixtureId)
    const globallyAttributed = fixtureId ? fixtureCapabilities.get(fixtureId) : null
    if (!fixtureId || !globallyAttributed || globallyAttributed.size === 0) {
      issues.push(error(
        'exact-closure-dynamic-fixture-ref-invalid',
        `Dynamic edge fixture is not declared by any capability: ${fixtureId || 'missing'}`,
        `${edge.path}.fixtureId`,
      ))
      continue
    }
    const endpointCapabilities = new Set<string>()
    for (const [endpointName, matches] of [
      ['source', sourceMatches],
      ['target', targetMatches],
    ] as const) {
      if (matches.length !== 1) continue
      const match = matches[0]
      if (!match) continue
      const capabilityId = getString(match.value.capabilityId)
      if (!capabilityId || (capabilitiesById.get(capabilityId) || []).length !== 1) {
        issues.push(error(
          'exact-closure-dynamic-endpoint-capability-ref-invalid',
          `Dynamic ${endpointName} must map to exactly one declared capability: ${edgeId}`,
          `${edge.path}.${endpointName}`,
        ))
        continue
      }
      endpointCapabilities.add(capabilityId)
    }
    for (const capabilityId of endpointCapabilities) {
      if (fixturesByCapability.get(capabilityId)?.has(fixtureId)) continue
      issues.push(error(
        'exact-closure-dynamic-fixture-capability-mismatch',
        `Fixture ${fixtureId} is not declared by endpoint capability ${capabilityId}`,
        `${edge.path}.fixtureId`,
      ))
    }
  }

  return issues
}

/**
 * Validates only declarations read from the selected commit. It intentionally
 * does not read worktree files, HEAD, or report-index data.
 */
export function validateExactCommitClosureInvariants(
  repositoryRoot: string,
  selectedCommit: string,
): ExactCommitClosureInvariantValidationResult {
  const issues: ValidationIssue[] = []
  if (!EXACT_COMMIT_PATTERN.test(selectedCommit)) {
    issues.push(error(
      'exact-closure-commit-not-exact',
      'Selected closure input must be a lowercase 40-character commit id',
      selectedCommit,
    ))
    return { canGenerateReport: false, exactCommit: null, issues }
  }
  const exactCommit = tryResolveGitCommit(repositoryRoot, selectedCommit)
  if (exactCommit !== selectedCommit) {
    issues.push(error(
      'exact-closure-commit-unavailable',
      'Selected closure input does not resolve to the exact commit object',
      selectedCommit,
    ))
    return { canGenerateReport: false, exactCommit: null, issues }
  }

  const capabilityLedger = readExactJsonObject(
    repositoryRoot,
    exactCommit,
    'docs/cat-catch/capability-ledger.json',
    issues,
  )
  const inventory = readExactJsonObject(
    repositoryRoot,
    exactCommit,
    'docs/cat-catch/legacy-inventory.json',
    issues,
  )
  if (capabilityLedger && inventory) {
    issues.push(...validateExactClosureDocuments(
      repositoryRoot,
      exactCommit,
      { capabilityLedger, inventory },
    ))
  }
  return {
    canGenerateReport: issues.length === 0,
    exactCommit,
    issues,
  }
}
