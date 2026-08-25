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
  type LocalClosureCandidate,
  type LocalClosureDiscoveredNode,
  type LocalClosureEdge,
  type LocalClosureFinding,
  type LocalClosureFindingGroup,
  type LocalClosureManifestEntry,
  type LocalClosureNodeRef,
  type ValidationIssue,
} from './types.ts'
import { inspectSourceLocator, normalizeSourceLocatorKind } from './source-locator.ts'

const LOCAL_CLOSURE_SCHEMA_FILE = 'local-closure-report.schema.json'
const LOCAL_CLOSURE_SCHEMA_ID = 'https://omniflow.local/schemas/cat-catch/local-closure-report.schema.json'
const LOCAL_CLOSURE_GENERATOR_VERSION = 'candidate-local-closure-v1'
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
  | 'discoveredNodes'
  | 'edges'
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

function nullableString(value: unknown, label: string): string | null {
  if (value === null) return null
  if (typeof value === 'string') return value
  throw new Error(`${label} must be a string or null`)
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

function normalizedLocatorKind(locator: JsonObject): string | null {
  const symbol = nullableString(locator.symbol, 'locator.symbol')
  if (symbol === null) return null
  return getString(locator.locatorKind) || 'declaration'
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

export function createLocalClosureSchemaProjectionBlocker(
  historicalCandidateCount: number,
  tombstoneCount: number,
  externalProcessEndpointCount = 0,
): LocalClosureFinding {
  const lostFields = ['locatorKind']
  if (historicalCandidateCount > 0) lostFields.push('historicalCandidates.lastKnownCommit')
  if (tombstoneCount > 0) {
    lostFields.push('retiredTombstones.capabilityId/cutoverUnitId/provenanceRefs')
  }
  if (externalProcessEndpointCount > 0) {
    lostFields.push('external-process virtual endpoint attribution/sourceHash')
  }
  return finding(
    'closure.schema-projection-incomplete',
    'schema.local-closure-projection',
    `The current local-closure schema cannot encode ${lostFields.join(', ')}; exact inventory remains authoritative and this candidate cannot satisfy closure completion.`,
  )
}

function projectionBlockers(
  inputs: ExactClosureInputs,
  historicalCandidateCount: number,
  tombstoneCount: number,
  externalProcessEndpointCount: number,
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
    createLocalClosureSchemaProjectionBlocker(
      historicalCandidateCount,
      tombstoneCount,
      externalProcessEndpointCount,
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
  const externalProcessEndpointCount = dynamicDeclarations.filter(declaration => (
    declaration.kind === 'process-handoff'
  )).length
  const blockers = projectionBlockers(
    inputs,
    historicalDeclarations.length,
    tombstones.length,
    externalProcessEndpointCount,
  )
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
  const bootstrapRoots: LocalClosureNodeRef[] = []
  const discoveredById = new Map<string, LocalClosureDiscoveredNode>()
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
    const path = requireString(node, 'path', 'inventoryNode')
    const symbol = nullableString(node.symbol, 'inventoryNode.symbol')
    const manifestEntry = inputs.manifestByPath.get(path)
    if (!manifestEntry || !verifiedCurrentNodeIds.has(nodeId)) {
      blockers.push(finding(
        'closure.bootstrap-root-source-unavailable',
        rootId,
        `Bootstrap root source hash and locator are not both verified at the exact commit: ${path}${symbol ? `#${symbol}` : ''}.`,
      ))
      continue
    }
    bootstrapRoots.push({ nodeId, path, symbol })
    discoveredById.set(nodeId, {
      capabilityId: nullableString(node.capabilityId, 'inventoryNode.capabilityId'),
      cutoverUnitId: nullableString(node.cutoverUnitId, 'inventoryNode.cutoverUnitId'),
      inventoryEntryId: nodeId,
      nodeId,
      ownerRole: nullableString(node.ownerRole, 'inventoryNode.ownerRole'),
      path,
      reachability: 'reachable',
      sourceHash: manifestEntry.contentHash,
      symbol,
    })
    if (node.classification === 'legacy' && node.ownerRole === 'production-owner') {
      findings.reachableLegacyProductionOwners.push(finding(
        'closure.reachable-legacy-production-owner',
        nodeId,
        `Legacy production owner is a declared bootstrap root: ${path}${symbol ? `#${symbol}` : ''}.`,
      ))
    }
  }
  const discoveredNodes = [...discoveredById.values()].sort((left, right) => compareCodeUnits(left.nodeId, right.nodeId))
  bootstrapRoots.sort((left, right) => compareCodeUnits(left.nodeId, right.nodeId))

  for (const node of currentNodes) {
    const nodeId = requireString(node, 'id', 'inventoryNode')
    if (discoveredById.has(nodeId)) continue
    const path = requireString(node, 'path', 'inventoryNode')
    const symbol = nullableString(node.symbol, 'inventoryNode.symbol')
    blockers.push(finding(
      'closure.current-node-reachability-undetermined',
      nodeId,
      `Inventory current node is mapped but intentionally omitted from discoveredNodes until complete closure traversal proves reachability: ${path}${symbol ? `#${symbol}` : ''}.`,
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
  ): { nodeId: string; unresolvedReason: string | null } => {
    const path = requireString(locator, 'path', `${edgeId}.${side}`)
    const symbol = nullableString(locator.symbol, `${edgeId}.${side}.symbol`)
    if (side === 'target' && kind === 'process-handoff' && path.startsWith('external-process/') && symbol === null) {
      return { nodeId: externalProcessNodeId(path), unresolvedReason: null }
    }
    const matches = currentByLocator.get(locatorKey(locator)) || []
    if (matches.length === 1) {
      const nodeId = requireString(matches[0] || {}, 'id', `${edgeId}.${side}`)
      if (!verifiedCurrentNodeIds.has(nodeId)) {
        return {
          nodeId,
          unresolvedReason: `${side} locator resolves to an inventory node whose exact-commit source hash or locator is unverified`,
        }
      }
      return {
        nodeId,
        unresolvedReason: null,
      }
    }
    return {
      nodeId: `unresolved-${side}.${edgeId}`,
      unresolvedReason: `${side} locator resolved to ${matches.length} inventory current nodes`,
    }
  }

  const declaredDynamicEdges: LocalClosureEdge[] = []
  const unresolvedDynamicEdges: CandidateLocalClosureReport['unresolvedDynamicEdges'] = []
  for (const declaration of dynamicDeclarations) {
    const edgeId = requireString(declaration, 'id', 'dynamicEdge')
    const kind = requireString(declaration, 'kind', edgeId)
    const source = asObject(declaration.source, `${edgeId}.source`)
    const target = asObject(declaration.target, `${edgeId}.target`)
    const sourceEndpoint = resolveEndpoint(edgeId, 'source', source, kind)
    const targetEndpoint = resolveEndpoint(edgeId, 'target', target, kind)
    const reasons = [sourceEndpoint.unresolvedReason, targetEndpoint.unresolvedReason].filter(Boolean)
    if (reasons.length > 0) {
      const reason = reasons.join('; ')
      unresolvedDynamicEdges.push({
        edgeId,
        kind,
        reason,
        sourceNodeId: sourceEndpoint.nodeId,
      })
      findings.unresolvedEdges.push(finding(
        'closure.declared-dynamic-edge-unresolved',
        edgeId,
        reason,
      ))
      continue
    }
    const sourcePath = requireString(source, 'path', `${edgeId}.source`)
    const declaredSourceHash = requireString(declaration, 'sourceHash', edgeId)
    const actualSourceHash = sourceHashAtPath(inputs, sourcePath)
    if (!actualSourceHash) {
      const reason = `source path is absent from the exact commit blob manifest: ${sourcePath}`
      unresolvedDynamicEdges.push({
        edgeId,
        kind,
        reason,
        sourceNodeId: sourceEndpoint.nodeId,
      })
      findings.unresolvedEdges.push(finding(
        'closure.declared-dynamic-edge-source-missing',
        edgeId,
        reason,
      ))
      blockers.push(finding(
        'closure.dynamic-edge-source-blob-missing',
        edgeId,
        `Declared dynamic edge source blob is unavailable: ${sourcePath}.`,
      ))
      continue
    }
    if (actualSourceHash !== declaredSourceHash) {
      const reason = `declared source hash does not match the exact commit blob: ${sourcePath}`
      unresolvedDynamicEdges.push({
        edgeId,
        kind,
        reason,
        sourceNodeId: sourceEndpoint.nodeId,
      })
      findings.unresolvedEdges.push(finding(
        'closure.declared-dynamic-edge-source-hash-mismatch',
        edgeId,
        reason,
      ))
      blockers.push(finding(
        'closure.dynamic-edge-source-hash-mismatch',
        edgeId,
        `Declared dynamic edge source hash does not match exact commit blob ${sourcePath}.`,
      ))
      continue
    }
    declaredDynamicEdges.push({
      edgeId,
      fromNodeId: sourceEndpoint.nodeId,
      kind,
      provenance: 'declared-dynamic',
      sourceHash: actualSourceHash,
      toNodeId: targetEndpoint.nodeId,
    })
  }
  declaredDynamicEdges.sort((left, right) => compareCodeUnits(left.edgeId, right.edgeId))
  unresolvedDynamicEdges.sort((left, right) => compareCodeUnits(left.edgeId, right.edgeId))

  const historicalCandidates: LocalClosureCandidate[] = historicalDeclarations.map(candidate => {
    const resolution = candidate.resolution === null
      ? null
      : asObject(candidate.resolution, 'historicalCandidate.resolution')
    return {
      candidateId: requireString(candidate, 'id', 'historicalCandidate'),
      path: requireString(candidate, 'path', 'historicalCandidate'),
      resolutionKind: resolution
        ? requireString(resolution, 'kind', 'historicalCandidate.resolution') as LocalClosureCandidate['resolutionKind']
        : 'unresolved',
      resolutionRefId: resolution
        ? requireString(resolution, 'refId', 'historicalCandidate.resolution')
        : null,
      sourceHash: requireString(candidate, 'sourceHash', 'historicalCandidate'),
      symbol: nullableString(candidate.symbol, 'historicalCandidate.symbol'),
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
      decisionHash: sha256Bytes(stableJson(decision)),
      decisionId: requireString(decision, 'decisionId', 'approvedExclusion.decision'),
      exclusionId,
    }]
  }).sort((left, right) => compareCodeUnits(left.exclusionId, right.exclusionId))
  const retiredTombstones = tombstones.map(tombstone => ({
    deletedSourceHash: requireString(tombstone, 'deletedSourceHash', 'retiredTombstone'),
    deletionCommit: requireString(tombstone, 'deletionCommit', 'retiredTombstone'),
    deletionEvidenceRef: asObject(tombstone.deletionEvidenceRef, 'retiredTombstone.deletionEvidenceRef'),
    inventoryEntryId: requireString(tombstone, 'id', 'retiredTombstone'),
    path: requireString(tombstone, 'path', 'retiredTombstone'),
    symbol: nullableString(tombstone.symbol, 'retiredTombstone.symbol'),
  }))

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
    discoveredNodes,
    edges: [],
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
    ['discoveredNodes', report.discoveredNodes, expectedProjection.discoveredNodes],
    ['edges', report.edges, expectedProjection.edges],
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
    ['bootstrapRoots.nodeId', report.bootstrapRoots.map(root => root.nodeId)],
    ['bootstrapRoots.locator', report.bootstrapRoots.map(root => stableJson([root.path, root.symbol]))],
    ['discoveredNodes.nodeId', report.discoveredNodes.map(node => node.nodeId)],
    ['discoveredNodes.locator', report.discoveredNodes.map(node => stableJson([node.path, node.symbol]))],
    ['declaredDynamicEdges.edgeId', report.declaredDynamicEdges.map(edge => edge.edgeId)],
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
  for (const root of report.bootstrapRoots) {
    if (!discoveredIds.has(root.nodeId)) {
      issues.push(semanticMismatch('bootstrapRoots', `Bootstrap root does not reference a discovered node: ${root.nodeId}`))
    }
  }
  if (report.discoveredNodes.some(node => node.reachability !== 'reachable')) {
    issues.push(semanticMismatch(
      'discoveredNodes',
      'This partial candidate may only emit directly proven reachable bootstrap roots; it must not claim unreachable nodes',
    ))
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
    schemaVersion: 1,
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
  return [
    ...validateContractDocument(prepared.inputs.contracts, LOCAL_CLOSURE_SCHEMA_FILE, report),
    ...validateCandidateSemantics(report, prepared.inputs),
  ]
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
