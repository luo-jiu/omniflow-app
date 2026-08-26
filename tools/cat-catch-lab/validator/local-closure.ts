import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  hashGitCommitInputs,
  hashValidatorSourceManifest,
  hashValidatorSourceHashEntries,
  listGitCommitTreeEntries,
  readGitBlobObjects,
  tryResolveGitCommit,
} from './git-input.ts'
import { validateExactCommitClosureInvariants } from './exact-closure-invariants.ts'
import { decodeUtf8Bytes, getString, isJsonObject, sha256Bytes } from './json.ts'
import {
  loadAndValidateLocalClosureContractsAtCommit,
  validateContractDocument,
} from './schema-registry.ts'
import {
  createIssue,
  type CandidateLocalClosureGenerationResult,
  type CandidateLocalClosureReport,
  type JsonObject,
  type LoadedContracts,
  type LocalClosureBootstrapRoot,
  type LocalClosureCandidate,
  type LocalClosureDiscoveredNode,
  type LocalClosureDiscoveryCoverage,
  type LocalClosureEdge,
  type LocalClosureExternalProcessAttribution,
  type LocalClosureExternalProcessEndpoint,
  type LocalClosureFinding,
  type LocalClosureFindingGroup,
  type LocalClosureHistoricalDiscoveryEvidence,
  type LocalClosureLocator,
  type LocalClosureLocatorKind,
  type LocalClosureManifestEntry,
  type ValidationIssue,
} from './types.ts'
import { inspectSourceLocator, normalizeSourceLocatorKind } from './source-locator.ts'

const LOCAL_CLOSURE_SCHEMA_FILE = 'local-closure-report.schema.json'
const LOCAL_CLOSURE_SCHEMA_ID = 'https://omniflow.local/schemas/cat-catch/local-closure-report.schema.json'
const LOCAL_CLOSURE_GENERATOR_VERSION = 'candidate-local-closure-v2'
const REPORT_INDEX_PATH = 'docs/cat-catch/report-index'
const EXECUTING_APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const FINDING_GROUPS: LocalClosureFindingGroup[] = [
  'reachableLegacyProductionOwners',
  'deadLegacySymbols',
  'unmappedInScopeNodes',
  'multipleOwnerPaths',
  'activeLegacyGuidanceRefs',
  'unresolvedEdges',
  'auditRefs',
]

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

type ExactClosureInputs = {
  blobByPath: Map<string, Buffer>
  commit: string
  contracts: LoadedContracts
  executingValidatorSourceManifestHash: string
  expectedInputHashes: {
    capabilityLedger: string
    discoveryRules: string
    legacyInventory: string
    schemaBundle: string
    validatorTrustPolicy: string
  }
  inputCommitValidatorSourceManifestHash: string
  inventory: JsonObject
  manifestByPath: Map<string, LocalClosureManifestEntry>
  sourceManifest: CandidateLocalClosureReport['sourceManifest']
  treeHash: string
}

type PreparedClosureInputs = {
  inputs: ExactClosureInputs | null
  issues: ValidationIssue[]
}

type InventoryProjection = Pick<CandidateLocalClosureReport,
  | 'approvedExclusions'
  | 'blockers'
  | 'bootstrapRoots'
  | 'counts'
  | 'declaredDynamicEdges'
  | 'discoveryCoverage'
  | 'discoveredNodes'
  | 'edges'
  | 'externalProcessEndpoints'
  | 'findings'
  | 'historicalCandidates'
  | 'retiredTombstones'
  | 'semanticCandidates'
  | 'unresolvedDynamicEdges'
>

function asObject(value: unknown, label: string): JsonObject {
  if (!isJsonObject(value)) throw new Error(`${label} must be an object`)
  return value
}

function asObjectArray(value: unknown, label: string): JsonObject[] {
  if (!Array.isArray(value) || !value.every(isJsonObject)) {
    throw new Error(`${label} must be an object array`)
  }
  return value
}

function requireString(object: JsonObject, property: string, label: string): string {
  const value = getString(object[property])
  if (value === null) throw new Error(`${label}.${property} must be a string`)
  return value
}

function requireSafeInteger(
  object: JsonObject,
  property: string,
  label: string,
  minimum = 0,
): number {
  const value = object[property]
  if (!Number.isSafeInteger(value) || Number(value) < minimum) {
    throw new Error(`${label}.${property} must be a safe integer >= ${minimum}`)
  }
  return Number(value)
}

function nullableString(value: unknown, label: string): string | null {
  if (value === null) return null
  if (typeof value === 'string') return value
  throw new Error(`${label} must be a string or null`)
}

function projectHistoricalDiscoveryEvidence(
  candidate: JsonObject,
): LocalClosureHistoricalDiscoveryEvidence {
  const evidence = asObject(candidate.discoveryEvidence, 'historicalCandidate.discoveryEvidence')
  const kind = requireString(evidence, 'kind', 'historicalCandidate.discoveryEvidence')
  const queryId = requireString(evidence, 'queryId', 'historicalCandidate.discoveryEvidence')
  const queryHit = asObject(
    evidence.queryHit,
    'historicalCandidate.discoveryEvidence.queryHit',
  )
  const hitLabel = 'historicalCandidate.discoveryEvidence.queryHit'
  const commonHit = {
    byteEnd: requireSafeInteger(queryHit, 'byteEnd', hitLabel, 1),
    byteStart: requireSafeInteger(queryHit, 'byteStart', hitLabel),
    commitId: requireString(queryHit, 'commitId', hitLabel),
    parentCommitId: nullableString(queryHit.parentCommitId, `${hitLabel}.parentCommitId`),
    rawSourceHash: requireString(queryHit, 'rawSourceHash', hitLabel),
  }
  if (kind === 'changed-blob-query-hit') {
    const side = requireString(queryHit, 'side', hitLabel)
    if (side !== 'before' && side !== 'after') {
      throw new Error(`${hitLabel}.side must be before or after`)
    }
    return {
      kind,
      queryId,
      queryHit: {
        ...commonHit,
        path: requireString(queryHit, 'path', hitLabel),
        side,
      },
    }
  }
  if (kind === 'commit-message-query-hit-with-path-change') {
    if (queryHit.path !== null || queryHit.side !== 'commit-message') {
      throw new Error(`${hitLabel} must identify a commit-message occurrence`)
    }
    const candidateSource = asObject(
      evidence.candidateSource,
      'historicalCandidate.discoveryEvidence.candidateSource',
    )
    const sourceLabel = 'historicalCandidate.discoveryEvidence.candidateSource'
    const sourceSide = requireString(candidateSource, 'side', sourceLabel)
    if (sourceSide !== 'before' && sourceSide !== 'after') {
      throw new Error(`${sourceLabel}.side must be before or after`)
    }
    return {
      candidateSource: {
        changeCommitId: requireString(candidateSource, 'changeCommitId', sourceLabel),
        parentCommitId: nullableString(
          candidateSource.parentCommitId,
          `${sourceLabel}.parentCommitId`,
        ),
        side: sourceSide,
      },
      kind,
      queryId,
      queryHit: {
        ...commonHit,
        path: null,
        side: 'commit-message',
      },
    }
  }
  throw new Error(`historicalCandidate.discoveryEvidence.kind is unsupported: ${kind}`)
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (isJsonObject(value)) {
    return `{${Object.keys(value).sort().map(key => (
      `${JSON.stringify(key)}:${stableJson(value[key])}`
    )).join(',')}}`
  }
  const encoded = JSON.stringify(value)
  if (encoded === undefined) throw new Error('Unsupported value in stable JSON input')
  return encoded
}

export function serializeCandidateLocalClosureCanonicalBytes(
  report: CandidateLocalClosureReport,
): Buffer {
  return Buffer.from(stableJson(report), 'utf8')
}

function isReportIndexPath(relativePath: string): boolean {
  return relativePath === REPORT_INDEX_PATH || relativePath.startsWith(`${REPORT_INDEX_PATH}/`)
}

function isSupportedManifestMode(mode: string): mode is LocalClosureManifestEntry['mode'] {
  return mode === '100644' || mode === '100755' || mode === '120000'
}

export function hashLocalClosureSourceManifestContent(
  sourceManifest: Omit<CandidateLocalClosureReport['sourceManifest'], 'manifestHash'>,
): string {
  const entries = [...sourceManifest.entries]
    .sort((left, right) => compareCodeUnits(left.path, right.path))
  const exclusions = [...sourceManifest.exclusions]
    .sort((left, right) => compareCodeUnits(left.pathPattern, right.pathPattern))
  const hashInput = {
    entries: entries.map(entry => [
      entry.path,
      entry.mode,
      entry.byteLength,
      entry.contentHash,
    ]),
    exclusions: exclusions.map(exclusion => [
      exclusion.pathPattern,
      exclusion.reason,
      [...exclusion.sourceInputRefs].sort(),
    ]),
  }
  return sha256Bytes(stableJson(hashInput))
}

function isValidatorSourcePath(relativePath: string): boolean {
  if (
    relativePath.startsWith('tools/cat-catch-lab/validator/')
    && relativePath.endsWith('.ts')
  ) return true
  if (
    relativePath.startsWith('docs/cat-catch/')
    && relativePath.endsWith('.schema.json')
  ) return true
  return relativePath === 'package.json'
    || relativePath === 'package-lock.json'
    || relativePath === 'tsconfig.cat-catch-tools.json'
}

function createValidatorSourceManifestHash(entries: LocalClosureManifestEntry[]): string {
  return hashValidatorSourceHashEntries(entries
    .filter(entry => isValidatorSourcePath(entry.path))
    .map(entry => ({ contentHash: entry.contentHash, relativePath: entry.path })))
}

function createSchemaBundleHash(contracts: LoadedContracts): string {
  const schemaHashes = [...contracts.schemas.keys()].sort().map(schemaFile => {
    const hash = contracts.inputHashes[schemaFile]
    if (!hash) throw new Error(`Schema input hash is missing: ${schemaFile}`)
    return [schemaFile, hash]
  })
  return sha256Bytes(stableJson(schemaHashes))
}

function createExactSourceManifest(
  appRoot: string,
  commit: string,
): {
  blobByPath: Map<string, Buffer>
  manifestByPath: Map<string, LocalClosureManifestEntry>
  sourceManifest: CandidateLocalClosureReport['sourceManifest'] | null
  treeHash: string | null
  issues: ValidationIssue[]
} {
  const issues: ValidationIssue[] = []
  const treeState = listGitCommitTreeEntries(appRoot, commit)
  if (treeState.status !== 'present') {
    issues.push(createIssue(
      'error',
      'local-closure-tree-unavailable',
      'The exact commit tree is unavailable',
      commit,
    ))
    return {
      blobByPath: new Map(),
      issues,
      manifestByPath: new Map(),
      sourceManifest: null,
      treeHash: null,
    }
  }

  const gitlinks = treeState.entries.filter(entry => entry.objectType === 'commit')
  for (const gitlink of gitlinks) {
    issues.push(createIssue(
      'error',
      'local-closure-gitlink-unsupported',
      'Gitlinks cannot be represented by the current local-closure source manifest schema',
      gitlink.relativePath,
    ))
  }
  const includedBlobs = treeState.entries
    .filter(entry => entry.objectType === 'blob' && !isReportIndexPath(entry.relativePath))
    .sort((left, right) => compareCodeUnits(left.relativePath, right.relativePath))
  for (const entry of includedBlobs) {
    if (isSupportedManifestMode(entry.mode)) continue
    issues.push(createIssue(
      'error',
      'local-closure-blob-mode-unsupported',
      `Tracked blob mode cannot be represented by the local-closure schema: ${entry.mode}`,
      entry.relativePath,
    ))
  }
  if (issues.length > 0) {
    return {
      blobByPath: new Map(),
      issues,
      manifestByPath: new Map(),
      sourceManifest: null,
      treeHash: null,
    }
  }

  const blobs = readGitBlobObjects(appRoot, includedBlobs.map(entry => entry.objectId))
  if (!blobs) {
    issues.push(createIssue(
      'error',
      'local-closure-blob-unavailable',
      'One or more tracked blobs are unavailable at the exact commit',
      commit,
    ))
    return {
      blobByPath: new Map(),
      issues,
      manifestByPath: new Map(),
      sourceManifest: null,
      treeHash: null,
    }
  }

  const entries: LocalClosureManifestEntry[] = []
  const blobByPath = new Map<string, Buffer>()
  for (const treeEntry of includedBlobs) {
    const bytes = blobs.get(treeEntry.objectId)
    if (!bytes || !isSupportedManifestMode(treeEntry.mode)) {
      issues.push(createIssue(
        'error',
        'local-closure-blob-unavailable',
        'Tracked blob bytes are unavailable at the exact commit',
        treeEntry.relativePath,
      ))
      continue
    }
    entries.push({
      byteLength: bytes.length,
      contentHash: sha256Bytes(bytes),
      mode: treeEntry.mode,
      path: treeEntry.relativePath,
    })
    blobByPath.set(treeEntry.relativePath, bytes)
  }
  if (issues.length > 0) {
    return {
      blobByPath: new Map(),
      issues,
      manifestByPath: new Map(),
      sourceManifest: null,
      treeHash: null,
    }
  }

  const exclusions = [{
    pathPattern: `${REPORT_INDEX_PATH}/**`,
    reason: 'Derived report-index artifacts are excluded to prevent evidence hash recursion.',
    sourceInputRefs: ['docs/cat-catch-full-migration-execution-plan.md#4.5'],
  }]
  const sourceManifestWithoutHash = { entries, exclusions }
  const sourceManifest = {
    ...sourceManifestWithoutHash,
    manifestHash: hashLocalClosureSourceManifestContent(sourceManifestWithoutHash),
  }
  const treeHash = hashGitCommitInputs(appRoot, commit)
  if (!treeHash) {
    issues.push(createIssue(
      'error',
      'local-closure-tree-hash-unavailable',
      'The exact commit input tree hash is unavailable',
      commit,
    ))
  }
  return {
    blobByPath,
    issues,
    manifestByPath: new Map(entries.map(entry => [entry.path, entry])),
    sourceManifest,
    treeHash,
  }
}

function prepareExactClosureInputs(appRoot: string, commit: string): PreparedClosureInputs {
  const contractResult = loadAndValidateLocalClosureContractsAtCommit(appRoot, commit)
  if (contractResult.issues.length > 0) {
    return { inputs: null, issues: contractResult.issues }
  }
  const exactCommit = tryResolveGitCommit(appRoot, commit)
  if (!exactCommit || exactCommit !== commit.toLowerCase()) {
    return {
      inputs: null,
      issues: [createIssue(
        'error',
        'contract-commit-unavailable',
        'Contract snapshot commit is unavailable or does not identify an exact commit object',
        commit,
      )],
    }
  }

  const invariantResult = validateExactCommitClosureInvariants(appRoot, exactCommit)
  if (!invariantResult.canGenerateReport) {
    return { inputs: null, issues: invariantResult.issues }
  }

  const sourceSnapshot = createExactSourceManifest(appRoot, exactCommit)
  if (!sourceSnapshot.sourceManifest || !sourceSnapshot.treeHash || sourceSnapshot.issues.length > 0) {
    return { inputs: null, issues: sourceSnapshot.issues }
  }
  const inventory = contractResult.contracts.documents.get('legacy-inventory.json')
  const trustPolicy = contractResult.contracts.documents.get('validator-trust-policy.json')
  if (!inventory || !trustPolicy) {
    return {
      inputs: null,
      issues: [createIssue(
        'error',
        'local-closure-contract-input-missing',
        'The exact commit inventory or validator trust policy is missing',
      )],
    }
  }

  try {
    const capabilityLedger = contractResult.contracts.inputHashes['capability-ledger.json']
    const legacyInventory = contractResult.contracts.inputHashes['legacy-inventory.json']
    const validatorTrustPolicy = contractResult.contracts.inputHashes['validator-trust-policy.json']
    if (!capabilityLedger || !legacyInventory || !validatorTrustPolicy) {
      throw new Error('Required exact-commit declaration hashes are missing')
    }
    const expectedInputHashes = {
      capabilityLedger,
      discoveryRules: legacyInventory,
      legacyInventory,
      schemaBundle: createSchemaBundleHash(contractResult.contracts),
      validatorTrustPolicy,
    }
    return {
      issues: [],
      inputs: {
        blobByPath: sourceSnapshot.blobByPath,
        commit: exactCommit,
        contracts: contractResult.contracts,
        executingValidatorSourceManifestHash: hashValidatorSourceManifest(EXECUTING_APP_ROOT),
        expectedInputHashes,
        inputCommitValidatorSourceManifestHash: createValidatorSourceManifestHash(
          sourceSnapshot.sourceManifest.entries,
        ),
        inventory,
        manifestByPath: sourceSnapshot.manifestByPath,
        sourceManifest: sourceSnapshot.sourceManifest,
        treeHash: sourceSnapshot.treeHash,
      },
    }
  } catch (error) {
    return {
      inputs: null,
      issues: [createIssue(
        'error',
        'local-closure-input-hash-failed',
        error instanceof Error ? error.message : String(error),
      )],
    }
  }
}

function normalizedLocatorKind(locator: JsonObject): LocalClosureLocatorKind | null {
  const symbol = nullableString(locator.symbol, 'locator.symbol')
  if (symbol === null) return null
  return normalizeSourceLocatorKind(locator.locatorKind) || 'declaration'
}

function projectLocator(locator: JsonObject, label: string): LocalClosureLocator {
  return {
    locatorKind: normalizedLocatorKind(locator),
    path: requireString(locator, 'path', label),
    symbol: nullableString(locator.symbol, `${label}.symbol`),
  }
}

function locatorKey(locator: JsonObject): string {
  return stableJson([
    requireString(locator, 'path', 'locator'),
    nullableString(locator.symbol, 'locator.symbol'),
    normalizedLocatorKind(locator),
  ])
}

function sourceHashAtPath(inputs: ExactClosureInputs, path: string): string | null {
  return inputs.manifestByPath.get(path)?.contentHash || null
}

function externalProcessNodeId(path: string): string {
  return `external-process.${path.slice('external-process/'.length).replace(/[^A-Za-z0-9._:-]/g, '.')}`
}

function finding(code: string, refId: string, message: string): LocalClosureFinding {
  return { code, message, refId }
}

function createEmptyFindings(): Record<LocalClosureFindingGroup, LocalClosureFinding[]> {
  return {
    activeLegacyGuidanceRefs: [],
    auditRefs: [],
    deadLegacySymbols: [],
    multipleOwnerPaths: [],
    reachableLegacyProductionOwners: [],
    unmappedInScopeNodes: [],
    unresolvedEdges: [],
  }
}

function projectionBlockers(
  inputs: ExactClosureInputs,
): LocalClosureFinding[] {
  const blockers = [
    finding(
      'closure.candidate-untrusted',
      'validator.candidate-untrusted',
      'This report was generated by an untrusted local candidate runner and is non-promotable.',
    ),
    finding(
      'closure.discovery-engine-unimplemented',
      'discovery.static-reverse-semantic',
      'AST static/import/call discovery, reverse dependency traversal, semantic scans, and the complete least-fixed-point closure are not implemented; only bootstrap roots have proven reachability.',
    ),
  ]
  if (
    inputs.executingValidatorSourceManifestHash
    !== inputs.inputCommitValidatorSourceManifestHash
  ) {
    blockers.push(finding(
      'closure.validator-bundle-not-at-input-commit',
      'validator.executing-bundle',
      `Executing validator bundle ${inputs.executingValidatorSourceManifestHash} differs from input-commit validator bundle ${inputs.inputCommitValidatorSourceManifestHash}; this candidate is non-promotable.`,
    ))
  }
  return blockers
}

function verifyCurrentNodeAtExactCommit(
  inputs: ExactClosureInputs,
  node: JsonObject,
  blockers: LocalClosureFinding[],
): boolean {
  const nodeId = requireString(node, 'id', 'inventoryNode')
  const nodePath = requireString(node, 'path', 'inventoryNode')
  const declaredSourceHash = requireString(node, 'sourceHash', 'inventoryNode')
  const manifestEntry = inputs.manifestByPath.get(nodePath)
  if (!manifestEntry) {
    blockers.push(finding(
      'closure.inventory-source-blob-missing',
      nodeId,
      `Inventory current node path is absent from the exact commit blob manifest: ${nodePath}.`,
    ))
    return false
  }

  let verified = true
  if (manifestEntry.contentHash !== declaredSourceHash) {
    blockers.push(finding(
      'closure.inventory-source-hash-mismatch',
      nodeId,
      `Inventory source hash does not match the exact commit blob for ${nodePath}.`,
    ))
    verified = false
  }

  const symbol = nullableString(node.symbol, 'inventoryNode.symbol')
  if (symbol === null) return verified
  const locatorKind = normalizeSourceLocatorKind(node.locatorKind)
  if (!locatorKind) {
    blockers.push(finding(
      'closure.inventory-locator-kind-invalid',
      nodeId,
      `Inventory current node locator kind is invalid: ${String(node.locatorKind)}.`,
    ))
    return false
  }
  const bytes = inputs.blobByPath.get(nodePath)
  if (!bytes) {
    blockers.push(finding(
      'closure.inventory-source-blob-missing',
      nodeId,
      `Inventory current node bytes are unavailable at the exact commit: ${nodePath}.`,
    ))
    return false
  }

  let source: string
  try {
    source = decodeUtf8Bytes(bytes, nodePath)
  } catch (error) {
    blockers.push(finding(
      'closure.inventory-source-encoding-invalid',
      nodeId,
      error instanceof Error ? error.message : String(error),
    ))
    return false
  }
  const locator = inspectSourceLocator(source, nodePath, symbol, locatorKind)
  if (locator.status === 'missing') {
    blockers.push(finding(
      'closure.inventory-source-locator-missing',
      nodeId,
      `Inventory symbol is absent from the exact commit blob: ${nodePath}#${symbol}.`,
    ))
    return false
  }
  if (locator.status === 'ambiguous') {
    blockers.push(finding(
      'closure.inventory-source-locator-ambiguous',
      nodeId,
      `Inventory symbol has ${locator.matchCount} logical matches in the exact commit blob: ${nodePath}#${symbol}.`,
    ))
    return false
  }
  if (locator.status === 'parse-error' || locator.status === 'unsupported-language') {
    blockers.push(finding(
      'closure.inventory-source-locator-unverifiable',
      nodeId,
      `Inventory symbol cannot be verified in the exact commit blob (${locator.status}): ${nodePath}#${symbol}.`,
    ))
    return false
  }
  return verified
}

function projectInventory(inputs: ExactClosureInputs): InventoryProjection {
  const inventoryEntries = asObjectArray(inputs.inventory.entries, 'legacyInventory.entries')
  const currentNodes = inventoryEntries.filter(entry => entry.entryType === 'current-node')
  const tombstones = inventoryEntries.filter(entry => entry.entryType === 'retired-tombstone')
  const bootstrapDeclarations = asObjectArray(inputs.inventory.bootstrapRoots, 'legacyInventory.bootstrapRoots')
  const dynamicDeclarations = asObjectArray(inputs.inventory.declaredDynamicEdges, 'legacyInventory.declaredDynamicEdges')
  const historicalDeclarations = asObjectArray(inputs.inventory.historicalCandidates, 'legacyInventory.historicalCandidates')
  const exclusionDeclarations = asObjectArray(inputs.inventory.approvedExclusions, 'legacyInventory.approvedExclusions')
  const ledger = inputs.contracts.documents.get('capability-ledger.json')
  if (!ledger) throw new Error('Exact-commit capability ledger is unavailable')
  const capabilityDeclarations = asObjectArray(ledger.capabilities, 'capabilityLedger.capabilities')
  const cutoverDeclarations = asObjectArray(ledger.cutoverUnits, 'capabilityLedger.cutoverUnits')
  const capabilityCutoverById = new Map(capabilityDeclarations.map(capability => [
    requireString(capability, 'id', 'capability'),
    requireString(capability, 'cutoverUnitId', 'capability'),
  ]))
  const cutoverUnitIds = new Set(cutoverDeclarations.map(unit => requireString(unit, 'id', 'cutoverUnit')))
  const currentByLocator = new Map<string, JsonObject[]>()
  for (const node of currentNodes) {
    const key = locatorKey(node)
    currentByLocator.set(key, [...(currentByLocator.get(key) || []), node])
  }

  const findings = createEmptyFindings()
  const blockers = projectionBlockers(inputs)
  const verifiedCurrentNodeIds = new Set<string>()
  for (const node of currentNodes) {
    const nodeId = requireString(node, 'id', 'inventoryNode')
    const capabilityId = nullableString(node.capabilityId, 'inventoryNode.capabilityId')
    const cutoverUnitId = nullableString(node.cutoverUnitId, 'inventoryNode.cutoverUnitId')
    const mappingProblems: string[] = []
    if (!capabilityId) mappingProblems.push('capabilityId is null')
    else if (!capabilityCutoverById.has(capabilityId)) mappingProblems.push(`capabilityId is unknown: ${capabilityId}`)
    if (!cutoverUnitId) mappingProblems.push('cutoverUnitId is null')
    else if (!cutoverUnitIds.has(cutoverUnitId)) mappingProblems.push(`cutoverUnitId is unknown: ${cutoverUnitId}`)
    const capabilityCutoverUnitId = capabilityId ? capabilityCutoverById.get(capabilityId) : null
    if (
      capabilityCutoverUnitId
      && cutoverUnitId
      && capabilityCutoverUnitId !== cutoverUnitId
    ) {
      mappingProblems.push(
        `capability ${capabilityId} belongs to ${capabilityCutoverUnitId}, not ${cutoverUnitId}`,
      )
    }
    if (mappingProblems.length > 0) {
      const message = `Inventory current node is not mapped to a valid capability/cutover pair: ${mappingProblems.join('; ')}.`
      findings.unmappedInScopeNodes.push(finding(
        'closure.inventory-node-unmapped',
        nodeId,
        message,
      ))
      blockers.push(finding(
        'closure.inventory-node-unmapped',
        nodeId,
        message,
      ))
    }
    if (verifyCurrentNodeAtExactCommit(inputs, node, blockers)) verifiedCurrentNodeIds.add(nodeId)
  }

  const bootstrapRoots: LocalClosureBootstrapRoot[] = []
  const discoveredById = new Map<string, LocalClosureDiscoveredNode>()
  for (const node of currentNodes) {
    const nodeId = requireString(node, 'id', 'inventoryNode')
    if (!verifiedCurrentNodeIds.has(nodeId)) continue
    const locator = projectLocator(node, 'inventoryNode')
    const manifestEntry = inputs.manifestByPath.get(locator.path)
    if (!manifestEntry) continue
    discoveredById.set(nodeId, {
      capabilityId: nullableString(node.capabilityId, 'inventoryNode.capabilityId'),
      classification: requireString(
        node,
        'classification',
        'inventoryNode',
      ) as LocalClosureDiscoveredNode['classification'],
      cutoverUnitId: nullableString(node.cutoverUnitId, 'inventoryNode.cutoverUnitId'),
      inventoryEntryId: nodeId,
      ...locator,
      nodeId,
      ownerRole: nullableString(node.ownerRole, 'inventoryNode.ownerRole'),
      provenanceRefs: Array.isArray(node.provenanceRefs)
        ? node.provenanceRefs.filter((ref): ref is string => typeof ref === 'string').sort(compareCodeUnits)
        : [],
      reachability: 'unknown',
      sourceHash: manifestEntry.contentHash,
    })
  }

  for (const root of bootstrapDeclarations) {
    const rootId = requireString(root, 'id', 'bootstrapRoot')
    const matches = currentByLocator.get(locatorKey(root)) || []
    if (matches.length !== 1) {
      blockers.push(finding(
        'closure.bootstrap-root-resolution-failed',
        rootId,
        `Bootstrap root must resolve to exactly one exact-commit inventory current node; resolved ${matches.length}.`,
      ))
      continue
    }
    const node = matches[0] || {}
    const nodeId = requireString(node, 'id', 'inventoryNode')
    const locator = projectLocator(node, 'inventoryNode')
    const discoveredNode = discoveredById.get(nodeId)
    if (!discoveredNode) {
      blockers.push(finding(
        'closure.bootstrap-root-source-unavailable',
        rootId,
        `Bootstrap root source hash and locator are not both verified at the exact commit: ${locator.path}${locator.symbol ? `#${locator.symbol}` : ''}.`,
      ))
      continue
    }
    bootstrapRoots.push({
      category: requireString(root, 'category', 'bootstrapRoot'),
      ...locator,
      nodeId,
      rootId,
      traversal: requireString(root, 'traversal', 'bootstrapRoot') as LocalClosureBootstrapRoot['traversal'],
    })
    discoveredNode.reachability = 'reachable'
    if (node.classification === 'legacy' && node.ownerRole === 'production-owner') {
      findings.reachableLegacyProductionOwners.push(finding(
        'closure.reachable-legacy-production-owner',
        nodeId,
        `Legacy production owner is a declared bootstrap root: ${locator.path}${locator.symbol ? `#${locator.symbol}` : ''}.`,
      ))
    }
  }
  const discoveredNodes = [...discoveredById.values()].sort((left, right) => compareCodeUnits(left.nodeId, right.nodeId))
  bootstrapRoots.sort((left, right) => compareCodeUnits(left.rootId, right.rootId))

  for (const node of discoveredNodes) {
    if (node.reachability !== 'unknown') continue
    blockers.push(finding(
      'closure.current-node-reachability-undetermined',
      node.nodeId,
      `Inventory current node is verified but its reachability remains unknown until complete closure traversal: ${node.path}${node.symbol ? `#${node.symbol}` : ''}.`,
    ))
  }

  const provenanceRefs = [...new Set(inventoryEntries.flatMap(entry => {
    const refs = entry.provenanceRefs
    return Array.isArray(refs) ? refs.filter((ref): ref is string => typeof ref === 'string') : []
  }))].sort()
  for (const ref of provenanceRefs) {
    findings.auditRefs.push(finding(
      'closure.inventory-audit-reference',
      `audit.${sha256Bytes(ref).slice('sha256:'.length, 'sha256:'.length + 20)}`,
      `Inventory provenance reference retained as audit-only input: ${ref}`,
    ))
  }

  const resolveEndpoint = (
    edgeId: string,
    side: 'source' | 'target',
    locator: JsonObject,
    kind: string,
  ): { node: JsonObject | null; nodeId: string; unresolvedReason: string | null } => {
    const path = requireString(locator, 'path', `${edgeId}.${side}`)
    const symbol = nullableString(locator.symbol, `${edgeId}.${side}.symbol`)
    if (side === 'target' && kind === 'process-handoff' && path.startsWith('external-process/') && symbol === null) {
      return { node: null, nodeId: externalProcessNodeId(path), unresolvedReason: null }
    }
    const matches = currentByLocator.get(locatorKey(locator)) || []
    if (matches.length === 1) {
      const nodeId = requireString(matches[0] || {}, 'id', `${edgeId}.${side}`)
      if (!verifiedCurrentNodeIds.has(nodeId)) {
        return {
          node: matches[0] || null,
          nodeId,
          unresolvedReason: `${side} locator resolves to an inventory node whose exact-commit source hash or locator is unverified`,
        }
      }
      return {
        node: matches[0] || null,
        nodeId,
        unresolvedReason: null,
      }
    }
    return {
      node: null,
      nodeId: `unresolved-${side}.${edgeId}`,
      unresolvedReason: `${side} locator resolved to ${matches.length} inventory current nodes`,
    }
  }

  const declaredDynamicEdges: LocalClosureEdge[] = []
  const unresolvedDynamicEdges: CandidateLocalClosureReport['unresolvedDynamicEdges'] = []
  const externalEndpointSets = new Map<string, {
    attributions: LocalClosureExternalProcessAttribution[]
    endpoint: LocalClosureExternalProcessEndpoint
  }>()
  for (const declaration of dynamicDeclarations) {
    const edgeId = requireString(declaration, 'id', 'dynamicEdge')
    const kind = requireString(declaration, 'kind', edgeId)
    const source = asObject(declaration.source, `${edgeId}.source`)
    const target = asObject(declaration.target, `${edgeId}.target`)
    const sourceLocator = projectLocator(source, `${edgeId}.source`)
    const targetLocator = projectLocator(target, `${edgeId}.target`)
    const sourceEndpoint = resolveEndpoint(edgeId, 'source', source, kind)
    const targetEndpoint = resolveEndpoint(edgeId, 'target', target, kind)
    const resolutionRule = requireString(declaration, 'resolutionRule', edgeId)
    const fixtureId = requireString(declaration, 'fixtureId', edgeId)
    const declaredSourceHash = requireString(declaration, 'sourceHash', edgeId)
    const actualSourceHash = sourceHashAtPath(inputs, sourceLocator.path)
    const reasons = [sourceEndpoint.unresolvedReason, targetEndpoint.unresolvedReason].filter(
      (reason): reason is string => Boolean(reason),
    )
    if (!actualSourceHash) {
      reasons.push(`source path is absent from the exact commit blob manifest: ${sourceLocator.path}`)
      blockers.push(finding(
        'closure.dynamic-edge-source-blob-missing',
        edgeId,
        `Declared dynamic edge source blob is unavailable: ${sourceLocator.path}.`,
      ))
    } else if (actualSourceHash !== declaredSourceHash) {
      reasons.push(`declared source hash does not match the exact commit blob: ${sourceLocator.path}`)
      blockers.push(finding(
        'closure.dynamic-edge-source-hash-mismatch',
        edgeId,
        `Declared dynamic edge source hash does not match exact commit blob ${sourceLocator.path}.`,
      ))
    }
    const sourceCapabilityId = sourceEndpoint.node
      ? nullableString(sourceEndpoint.node.capabilityId, `${edgeId}.source.capabilityId`)
      : null
    const sourceCutoverUnitId = sourceEndpoint.node
      ? nullableString(sourceEndpoint.node.cutoverUnitId, `${edgeId}.source.cutoverUnitId`)
      : null
    const sourceDiscoveredNode = discoveredById.get(sourceEndpoint.nodeId) || null
    if (
      kind === 'process-handoff'
      && (!sourceCapabilityId || !sourceCutoverUnitId || !sourceDiscoveredNode)
    ) {
      reasons.push('process-handoff source is missing capability/cutover attribution')
    }
    if (reasons.length > 0) {
      const reason = reasons.join('; ')
      unresolvedDynamicEdges.push({
        actualSourceHash,
        declaredSourceHash,
        edgeId,
        fixtureId,
        kind,
        reason,
        resolutionRule,
        source: sourceLocator,
        sourceNodeId: sourceEndpoint.nodeId,
        target: targetLocator,
        targetNodeId: targetEndpoint.nodeId,
      })
      const findingCode = !actualSourceHash
        ? 'closure.declared-dynamic-edge-source-missing'
        : actualSourceHash !== declaredSourceHash
          ? 'closure.declared-dynamic-edge-source-hash-mismatch'
          : 'closure.declared-dynamic-edge-unresolved'
      findings.unresolvedEdges.push(finding(findingCode, edgeId, reason))
      continue
    }
    if (!actualSourceHash) throw new Error(`Verified dynamic edge source hash is missing: ${edgeId}`)
    declaredDynamicEdges.push({
      edgeId,
      fixtureId,
      fromNodeId: sourceEndpoint.nodeId,
      kind,
      provenance: 'declared-dynamic',
      resolutionRule,
      source: sourceLocator,
      sourceHash: actualSourceHash,
      target: targetLocator,
      toNodeId: targetEndpoint.nodeId,
    })
    if (kind === 'process-handoff' && sourceCapabilityId && sourceCutoverUnitId) {
      let endpointSets = externalEndpointSets.get(targetEndpoint.nodeId)
      if (!endpointSets) {
        endpointSets = {
          attributions: [],
          endpoint: {
            attributions: [],
            locatorKind: null,
            nodeId: targetEndpoint.nodeId,
            path: targetLocator.path,
            symbol: null,
          },
        }
        externalEndpointSets.set(targetEndpoint.nodeId, endpointSets)
      }
      endpointSets.attributions.push({
        capabilityId: sourceCapabilityId,
        cutoverUnitId: sourceCutoverUnitId,
        edgeId,
        sourceHash: actualSourceHash,
        sourceNodeId: sourceEndpoint.nodeId,
        sourceReachability: sourceDiscoveredNode?.reachability || 'unknown',
      })
    }
  }
  declaredDynamicEdges.sort((left, right) => compareCodeUnits(left.edgeId, right.edgeId))
  unresolvedDynamicEdges.sort((left, right) => compareCodeUnits(left.edgeId, right.edgeId))
  const externalProcessEndpoints = [...externalEndpointSets.values()].map(sets => ({
    ...sets.endpoint,
    attributions: sets.attributions.sort((left, right) => compareCodeUnits(left.edgeId, right.edgeId)),
  })).sort((left, right) => compareCodeUnits(left.nodeId, right.nodeId))

  const historicalCandidates = historicalDeclarations.map((candidate): LocalClosureCandidate => {
    const resolution = candidate.resolution === null
      ? null
      : asObject(candidate.resolution, 'historicalCandidate.resolution')
    return {
      candidateId: requireString(candidate, 'id', 'historicalCandidate'),
      candidateKind: 'historical' as const,
      discoveryEvidence: projectHistoricalDiscoveryEvidence(candidate),
      discoveryRuleIds: [],
      lastKnownCommit: requireString(candidate, 'lastKnownCommit', 'historicalCandidate'),
      ...projectLocator(candidate, 'historicalCandidate'),
      resolutionKind: resolution
        ? requireString(resolution, 'kind', 'historicalCandidate.resolution') as LocalClosureCandidate['resolutionKind']
        : 'unresolved',
      resolutionRefId: resolution
        ? requireString(resolution, 'refId', 'historicalCandidate.resolution')
        : null,
      sourceHash: requireString(candidate, 'sourceHash', 'historicalCandidate'),
      touchsetId: requireString(candidate, 'touchsetId', 'historicalCandidate'),
    }
  }).sort((left, right) => compareCodeUnits(left.candidateId, right.candidateId))

  const approvedExclusions = exclusionDeclarations.flatMap(exclusion => {
    const decision = asObject(exclusion.decision, 'approvedExclusion.decision')
    const exclusionId = requireString(exclusion, 'id', 'approvedExclusion')
    const candidateKind = requireString(exclusion, 'candidateKind', 'approvedExclusion')
    const exclusionLocatorKey = locatorKey(exclusion)
    const candidates = candidateKind === 'historical'
      ? historicalDeclarations.filter(candidate => {
        if (locatorKey(candidate) !== exclusionLocatorKey) return false
        if (candidate.resolution === null) return false
        const resolution = asObject(candidate.resolution, 'historicalCandidate.resolution')
        return resolution.kind === 'approved-exclusion' && resolution.refId === exclusionId
      })
      : []
    if (candidates.length !== 1) {
      blockers.push(finding(
        'closure.approved-exclusion-candidate-unresolved',
        exclusionId,
        `Approved ${candidateKind} exclusion must resolve back to exactly one discovered candidate; resolved ${candidates.length}.`,
      ))
      return []
    }
    return [{
      candidateId: requireString(candidates[0] || {}, 'id', 'approvedExclusion.candidate'),
      candidateKind: candidateKind as 'current' | 'historical',
      decisionHash: sha256Bytes(stableJson(decision)),
      decisionId: requireString(decision, 'decisionId', 'approvedExclusion.decision'),
      exclusionId,
      ...projectLocator(exclusion, 'approvedExclusion'),
    }]
  }).sort((left, right) => compareCodeUnits(left.exclusionId, right.exclusionId))
  const retiredTombstones = tombstones.map(tombstone => ({
    capabilityId: requireString(tombstone, 'capabilityId', 'retiredTombstone'),
    cutoverUnitId: requireString(tombstone, 'cutoverUnitId', 'retiredTombstone'),
    deletedSourceHash: requireString(tombstone, 'deletedSourceHash', 'retiredTombstone'),
    deletionCommit: requireString(tombstone, 'deletionCommit', 'retiredTombstone'),
    deletionEvidenceRef: asObject(tombstone.deletionEvidenceRef, 'retiredTombstone.deletionEvidenceRef'),
    inventoryEntryId: requireString(tombstone, 'id', 'retiredTombstone'),
    ...projectLocator(tombstone, 'retiredTombstone'),
    provenanceRefs: Array.isArray(tombstone.provenanceRefs)
      ? tombstone.provenanceRefs.filter((ref): ref is string => typeof ref === 'string').sort(compareCodeUnits)
      : [],
  }))

  const discoveryCoverage: LocalClosureDiscoveryCoverage = {
    cutoverDependencyGraph: 'pending',
    declaredDynamicEdges: 'complete',
    historicalTouchsetScan: 'pending',
    leastFixedPoint: 'pending',
    reverseDependencyGraph: 'pending',
    semanticScan: 'pending',
    staticDependencyGraph: 'pending',
  }

  for (const group of FINDING_GROUPS) {
    findings[group].sort((left, right) => compareCodeUnits(left.refId, right.refId))
  }
  const counts = Object.fromEntries(FINDING_GROUPS.map(group => [group, findings[group].length])) as Record<
    LocalClosureFindingGroup,
    number
  >
  return {
    approvedExclusions,
    blockers,
    bootstrapRoots,
    counts,
    declaredDynamicEdges,
    discoveryCoverage,
    discoveredNodes,
    edges: [],
    externalProcessEndpoints,
    findings,
    historicalCandidates,
    retiredTombstones,
    semanticCandidates: [],
    unresolvedDynamicEdges,
  }
}

function semanticMismatch(path: string, message: string): ValidationIssue {
  return createIssue('error', 'local-closure-semantic-mismatch', message, path)
}

function hasDuplicate(values: string[]): boolean {
  return new Set(values).size !== values.length
}

function validateCandidateSemantics(
  report: CandidateLocalClosureReport,
  inputs: ExactClosureInputs,
): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const expectedProjection = projectInventory(inputs)
  const expectedDiscoveryRulesVersion = requireString(
    inputs.inventory,
    'discoveryRulesVersion',
    'legacyInventory',
  )
  const exactComparisons: Array<[string, unknown, unknown]> = [
    ['reportId', report.reportId, `local-closure.candidate:${inputs.commit}`],
    ['discoveryRulesVersion', report.discoveryRulesVersion, expectedDiscoveryRulesVersion],
    ['evidenceInputCommit', report.evidenceInputCommit, inputs.commit],
    ['evidenceInputTreeHash', report.evidenceInputTreeHash, inputs.treeHash],
    ['inputHashes', report.inputHashes, inputs.expectedInputHashes],
    ['sourceManifest', report.sourceManifest, inputs.sourceManifest],
    ['bootstrapRoots', report.bootstrapRoots, expectedProjection.bootstrapRoots],
    ['discoveryCoverage', report.discoveryCoverage, expectedProjection.discoveryCoverage],
    ['discoveredNodes', report.discoveredNodes, expectedProjection.discoveredNodes],
    ['edges', report.edges, expectedProjection.edges],
    ['externalProcessEndpoints', report.externalProcessEndpoints, expectedProjection.externalProcessEndpoints],
    ['semanticCandidates', report.semanticCandidates, expectedProjection.semanticCandidates],
    ['historicalCandidates', report.historicalCandidates, expectedProjection.historicalCandidates],
    ['declaredDynamicEdges', report.declaredDynamicEdges, expectedProjection.declaredDynamicEdges],
    ['unresolvedDynamicEdges', report.unresolvedDynamicEdges, expectedProjection.unresolvedDynamicEdges],
    ['approvedExclusions', report.approvedExclusions, expectedProjection.approvedExclusions],
    ['retiredTombstones', report.retiredTombstones, expectedProjection.retiredTombstones],
    ['counts', report.counts, expectedProjection.counts],
    ['findings', report.findings, expectedProjection.findings],
    ['blockers', report.blockers, expectedProjection.blockers],
  ]
  for (const [path, actual, expected] of exactComparisons) {
    if (stableJson(actual) === stableJson(expected)) continue
    issues.push(semanticMismatch(path, `${path} is not bound to the exact-commit candidate projection`))
  }
  if (report.status !== 'blocked') {
    issues.push(semanticMismatch('status', 'Candidate local-closure reports must remain blocked'))
  }
  if (
    report.validator.trustClassification !== 'candidate-untrusted'
    || report.validator.approvalRef !== null
  ) {
    issues.push(semanticMismatch('validator', 'Candidate validator binding must remain untrusted and unapproved'))
  }
  const trustPolicyHash = inputs.expectedInputHashes.validatorTrustPolicy
  if (
    report.validator.sourceManifestHash !== inputs.executingValidatorSourceManifestHash
    || report.validator.trustPolicyHash !== trustPolicyHash
    || report.validator.validatorId !== 'cat-catch-local-closure-validator'
    || report.validator.version !== LOCAL_CLOSURE_GENERATOR_VERSION
  ) {
    issues.push(semanticMismatch('validator', 'Validator binding hashes or version do not match exact-commit inputs'))
  }

  const uniqueChecks: Array<[string, string[]]> = [
    ['bootstrapRoots.rootId', report.bootstrapRoots.map(root => root.rootId)],
    ['bootstrapRoots.nodeId', report.bootstrapRoots.map(root => root.nodeId)],
    ['bootstrapRoots.locator', report.bootstrapRoots.map(root => stableJson([root.path, root.symbol, root.locatorKind]))],
    ['discoveredNodes.nodeId', report.discoveredNodes.map(node => node.nodeId)],
    ['graphNodes.nodeId', [
      ...report.discoveredNodes.map(node => node.nodeId),
      ...report.externalProcessEndpoints.map(endpoint => endpoint.nodeId),
    ]],
    ['discoveredNodes.locator', report.discoveredNodes.map(node => stableJson([node.path, node.symbol, node.locatorKind]))],
    ['declaredDynamicEdges.edgeId', report.declaredDynamicEdges.map(edge => edge.edgeId)],
    ['externalProcessEndpoints.nodeId', report.externalProcessEndpoints.map(endpoint => endpoint.nodeId)],
    ['externalProcessEndpoints.locator', report.externalProcessEndpoints.map(endpoint => stableJson([
      endpoint.path,
      endpoint.symbol,
      endpoint.locatorKind,
    ]))],
    ['historicalCandidates.candidateId', report.historicalCandidates.map(candidate => candidate.candidateId)],
    ['approvedExclusions.exclusionId', report.approvedExclusions.map(exclusion => String(exclusion.exclusionId))],
    ['approvedExclusions.candidateId', report.approvedExclusions.map(exclusion => String(exclusion.candidateId))],
    ['blockers.code+refId', report.blockers.map(blocker => `${blocker.code}\0${blocker.refId}`)],
  ]
  for (const group of FINDING_GROUPS) {
    uniqueChecks.push([
      `findings.${group}.code+refId`,
      report.findings[group].map(item => `${item.code}\0${item.refId}`),
    ])
    if (report.counts[group] !== report.findings[group].length) {
      issues.push(semanticMismatch(
        `counts.${group}`,
        `Count must equal findings.${group}.length`,
      ))
    }
  }
  for (const [path, values] of uniqueChecks) {
    if (hasDuplicate(values)) issues.push(semanticMismatch(path, `${path} contains duplicate identities`))
  }

  const discoveredIds = new Set(report.discoveredNodes.map(node => node.nodeId))
  const rootNodeIds = new Set(report.bootstrapRoots.map(root => root.nodeId))
  for (const root of report.bootstrapRoots) {
    if (!discoveredIds.has(root.nodeId)) {
      issues.push(semanticMismatch('bootstrapRoots', `Bootstrap root does not reference a discovered node: ${root.nodeId}`))
    }
  }
  for (const node of report.discoveredNodes) {
    const expectedReachability = rootNodeIds.has(node.nodeId) ? 'reachable' : 'unknown'
    if (node.reachability !== expectedReachability) {
      issues.push(semanticMismatch(
        'discoveredNodes',
        `Partial discovery must mark roots reachable and every other verified current node unknown: ${node.nodeId}`,
      ))
    }
  }
  const candidatesById = new Map(
    [...report.semanticCandidates, ...report.historicalCandidates]
      .map(candidate => [candidate.candidateId, candidate]),
  )
  for (const exclusion of report.approvedExclusions) {
    const exclusionId = getString(exclusion.exclusionId)
    const candidateId = getString(exclusion.candidateId)
    const candidate = candidateId ? candidatesById.get(candidateId) : null
    if (
      !exclusionId
      || !candidate
      || candidate.resolutionKind !== 'approved-exclusion'
      || candidate.resolutionRefId !== exclusionId
    ) {
      issues.push(semanticMismatch(
        'approvedExclusions',
        `Approved exclusion does not resolve back to its candidate: ${exclusionId || 'unknown'}`,
      ))
    }
  }
  const reportIndexEntry = report.sourceManifest.entries.find(entry => isReportIndexPath(entry.path))
  if (reportIndexEntry) {
    issues.push(semanticMismatch('sourceManifest.entries', 'report-index paths must not enter the source manifest'))
  }
  return issues
}

function buildCandidateReport(
  inputs: ExactClosureInputs,
  generatedAt: string,
): CandidateLocalClosureReport {
  const projection = projectInventory(inputs)
  return {
    $schema: LOCAL_CLOSURE_SCHEMA_ID,
    ...projection,
    discoveryRulesVersion: requireString(inputs.inventory, 'discoveryRulesVersion', 'legacyInventory'),
    evidenceInputCommit: inputs.commit,
    evidenceInputTreeHash: inputs.treeHash,
    generatedAt,
    inputHashes: inputs.expectedInputHashes,
    reportId: `local-closure.candidate:${inputs.commit}`,
    schemaVersion: 2,
    sourceManifest: inputs.sourceManifest,
    status: 'blocked',
    validator: {
      approvalRef: null,
      sourceManifestHash: inputs.executingValidatorSourceManifestHash,
      trustClassification: 'candidate-untrusted',
      trustPolicyHash: inputs.expectedInputHashes.validatorTrustPolicy,
      validatorId: 'cat-catch-local-closure-validator',
      version: LOCAL_CLOSURE_GENERATOR_VERSION,
    },
  }
}

export function generateCandidateLocalClosureReport(
  appRoot: string,
  commit: string,
  generatedAt = new Date().toISOString(),
): CandidateLocalClosureGenerationResult {
  const prepared = prepareExactClosureInputs(appRoot, commit)
  if (!prepared.inputs) return { issues: prepared.issues, report: null }

  try {
    const report = buildCandidateReport(prepared.inputs, generatedAt)
    const schemaIssues = validateContractDocument(
      prepared.inputs.contracts,
      LOCAL_CLOSURE_SCHEMA_FILE,
      report,
    )
    const semanticIssues = validateCandidateSemantics(report, prepared.inputs)
    const issues = [...schemaIssues, ...semanticIssues]
    return issues.length > 0 ? { issues, report: null } : { issues: [], report }
  } catch (error) {
    return {
      issues: [createIssue(
        'error',
        'local-closure-generation-failed',
        error instanceof Error ? error.message : String(error),
      )],
      report: null,
    }
  }
}

export function validateCandidateLocalClosureReportAtCommit(
  appRoot: string,
  commit: string,
  report: CandidateLocalClosureReport,
): ValidationIssue[] {
  const prepared = prepareExactClosureInputs(appRoot, commit)
  if (!prepared.inputs) return prepared.issues
  const schemaIssues = validateContractDocument(
    prepared.inputs.contracts,
    LOCAL_CLOSURE_SCHEMA_FILE,
    report,
  )
  if (schemaIssues.length > 0) return schemaIssues
  try {
    return validateCandidateSemantics(report, prepared.inputs)
  } catch (error) {
    return [createIssue(
      'error',
      'local-closure-semantic-validation-failed',
      error instanceof Error ? error.message : String(error),
    )]
  }
}

export function isLocalClosureReportIndexPath(appRoot: string, outputPath: string): boolean {
  const reportIndexRoot = path.resolve(appRoot, REPORT_INDEX_PATH)
  const relativeOutput = path.relative(reportIndexRoot, path.resolve(outputPath))
  return relativeOutput === ''
    || (!relativeOutput.startsWith(`..${path.sep}`) && relativeOutput !== '..' && !path.isAbsolute(relativeOutput))
}

export function getCandidateLocalClosureExitCode(report: CandidateLocalClosureReport): number {
  return report.status === 'blocked' ? 1 : 0
}

export const candidateLocalClosureConstants = {
  generatorVersion: LOCAL_CLOSURE_GENERATOR_VERSION,
  reportIndexPath: REPORT_INDEX_PATH,
  schemaId: LOCAL_CLOSURE_SCHEMA_ID,
} as const
