export type IssueSeverity = 'error' | 'blocker' | 'warning'

export type ValidationIssue = {
  code: string
  message: string
  path?: string
  severity: IssueSeverity
}

export type JsonObject = Record<string, unknown>

export type LoadedContracts = {
  documents: Map<string, JsonObject>
  inputHashes: Record<string, string>
  schemas: Map<string, JsonObject>
}

export type ContractLoadResult = {
  contracts: LoadedContracts
  issues: ValidationIssue[]
}

export type LocalClosureFindingGroup =
  | 'reachableLegacyProductionOwners'
  | 'deadLegacySymbols'
  | 'unmappedInScopeNodes'
  | 'multipleOwnerPaths'
  | 'activeLegacyGuidanceRefs'
  | 'unresolvedEdges'
  | 'auditRefs'

export type LocalClosureFinding = {
  code: string
  message: string
  refId: string
}

export type LocalClosureManifestEntry = {
  byteLength: number
  contentHash: string
  mode: '100644' | '100755' | '120000'
  path: string
}

export type LocalClosureLocatorKind = 'declaration' | 'member' | 'runtime-literal'

export type LocalClosureLocator = {
  locatorKind: LocalClosureLocatorKind | null
  path: string
  symbol: string | null
}

export type LocalClosureNodeRef = {
  locatorKind: LocalClosureLocatorKind | null
  nodeId: string
  path: string
  symbol: string | null
}

export type LocalClosureBootstrapRoot = LocalClosureNodeRef & {
  category: string
  rootId: string
  traversal: 'both' | 'forward' | 'reverse'
}

export type LocalClosureDiscoveredNode = LocalClosureNodeRef & {
  capabilityId: string | null
  classification: 'candidate' | 'legacy' | 'omniflow-integration' | 'target'
  cutoverUnitId: string | null
  inventoryEntryId: string | null
  ownerRole: string | null
  provenanceRefs: string[]
  reachability: 'reachable' | 'unknown' | 'unreachable'
  sourceHash: string
}

export type LocalClosureDiscoveryCoverage = {
  cutoverDependencyGraph: 'complete' | 'pending'
  declaredDynamicEdges: 'complete' | 'pending'
  historicalTouchsetScan: 'complete' | 'pending'
  leastFixedPoint: 'complete' | 'pending'
  reverseDependencyGraph: 'complete' | 'pending'
  semanticScan: 'complete' | 'pending'
  staticDependencyGraph: 'complete' | 'pending'
}

export type LocalClosureEdge = {
  edgeId: string
  fixtureId: string | null
  fromNodeId: string
  kind: string
  provenance: 'static' | 'declared-dynamic' | 'runtime-fixture' | 'historical'
  resolutionRule: string | null
  source: LocalClosureLocator
  sourceHash: string
  target: LocalClosureLocator
  toNodeId: string
}

export type LocalClosureCandidate = {
  candidateId: string
  candidateKind: 'current' | 'historical'
  discoveryRuleIds: string[]
  lastKnownCommit: string | null
  locatorKind: LocalClosureLocatorKind | null
  path: string
  resolutionKind: 'current-node' | 'approved-exclusion' | 'retired-tombstone' | 'unresolved'
  resolutionRefId: string | null
  sourceHash: string
  symbol: string | null
}

export type LocalClosureExternalProcessAttribution = {
  capabilityId: string
  cutoverUnitId: string
  edgeId: string
  sourceHash: string
  sourceNodeId: string
  sourceReachability: LocalClosureDiscoveredNode['reachability']
}

export type LocalClosureExternalProcessEndpoint = LocalClosureNodeRef & {
  attributions: LocalClosureExternalProcessAttribution[]
}

export type LocalClosureApprovedExclusion = LocalClosureLocator & {
  candidateId: string
  candidateKind: 'current' | 'historical'
  decisionHash: string
  decisionId: string
  exclusionId: string
}

export type LocalClosureRetiredTombstone = LocalClosureLocator & {
  capabilityId: string
  cutoverUnitId: string
  deletedSourceHash: string
  deletionCommit: string
  deletionEvidenceRef: JsonObject
  inventoryEntryId: string
  provenanceRefs: string[]
}

export type LocalClosureUnresolvedDynamicEdge = {
  actualSourceHash: string | null
  declaredSourceHash: string
  edgeId: string
  fixtureId: string
  kind: string
  reason: string
  resolutionRule: string
  source: LocalClosureLocator
  sourceNodeId: string
  target: LocalClosureLocator
  targetNodeId: string
}

export type CandidateLocalClosureReport = JsonObject & {
  $schema: string
  approvedExclusions: LocalClosureApprovedExclusion[]
  blockers: LocalClosureFinding[]
  bootstrapRoots: LocalClosureBootstrapRoot[]
  counts: Record<LocalClosureFindingGroup, number>
  declaredDynamicEdges: LocalClosureEdge[]
  discoveryCoverage: LocalClosureDiscoveryCoverage
  discoveredNodes: LocalClosureDiscoveredNode[]
  discoveryRulesVersion: string
  edges: LocalClosureEdge[]
  evidenceInputCommit: string
  evidenceInputTreeHash: string
  externalProcessEndpoints: LocalClosureExternalProcessEndpoint[]
  findings: Record<LocalClosureFindingGroup, LocalClosureFinding[]>
  generatedAt: string
  historicalCandidates: LocalClosureCandidate[]
  inputHashes: Record<string, string>
  reportId: string
  retiredTombstones: LocalClosureRetiredTombstone[]
  schemaVersion: 2
  semanticCandidates: LocalClosureCandidate[]
  sourceManifest: {
    entries: LocalClosureManifestEntry[]
    exclusions: Array<{
      pathPattern: string
      reason: string
      sourceInputRefs: string[]
    }>
    manifestHash: string
  }
  status: 'blocked'
  unresolvedDynamicEdges: LocalClosureUnresolvedDynamicEdge[]
  validator: {
    approvalRef: null
    sourceManifestHash: string
    trustClassification: 'candidate-untrusted'
    trustPolicyHash: string
    validatorId: string
    version: string
  }
}

export type CandidateLocalClosureGenerationResult = {
  issues: ValidationIssue[]
  report: CandidateLocalClosureReport | null
}

export type ValidationContext = LoadedContracts & {
  appRoot: string
  catCatchDirectory: string
  upstreamRoot: string
}

export type CandidatePreflightReport = {
  schemaVersion: 1
  reportType: 'g0-candidate-preflight'
  promotable: false
  generatedAt: string
  validatorSourceManifestHash: string
  validatorToolchainFingerprintHash: string
  workspace: {
    appHead: string | null
    appCommitInputTreeHash: string | null
    dirtyTrackedPaths: string[]
    untrackedInputPaths: string[]
    upstreamHead: string | null
    worktreeInputHash: string
  }
  inputHashes: Record<string, string>
  structuralStatus: 'passed' | 'failed'
  g0Status: 'in-progress' | 'blocked'
  errors: ValidationIssue[]
  blockers: ValidationIssue[]
  warnings: ValidationIssue[]
}

export function createIssue(
  severity: IssueSeverity,
  code: string,
  message: string,
  path?: string,
): ValidationIssue {
  return path ? { code, message, path, severity } : { code, message, severity }
}
