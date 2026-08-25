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

export type LocalClosureNodeRef = {
  nodeId: string
  path: string
  symbol: string | null
}

export type LocalClosureDiscoveredNode = LocalClosureNodeRef & {
  capabilityId: string | null
  cutoverUnitId: string | null
  inventoryEntryId: string | null
  ownerRole: string | null
  reachability: 'reachable' | 'unreachable'
  sourceHash: string
}

export type LocalClosureEdge = {
  edgeId: string
  fromNodeId: string
  kind: string
  provenance: 'static' | 'declared-dynamic' | 'runtime-fixture' | 'historical'
  sourceHash: string
  toNodeId: string
}

export type LocalClosureCandidate = {
  candidateId: string
  path: string
  resolutionKind: 'current-node' | 'approved-exclusion' | 'retired-tombstone' | 'unresolved'
  resolutionRefId: string | null
  sourceHash: string
  symbol: string | null
}

export type CandidateLocalClosureReport = JsonObject & {
  $schema: string
  approvedExclusions: JsonObject[]
  blockers: LocalClosureFinding[]
  bootstrapRoots: LocalClosureNodeRef[]
  counts: Record<LocalClosureFindingGroup, number>
  declaredDynamicEdges: LocalClosureEdge[]
  discoveredNodes: LocalClosureDiscoveredNode[]
  discoveryRulesVersion: string
  edges: LocalClosureEdge[]
  evidenceInputCommit: string
  evidenceInputTreeHash: string
  findings: Record<LocalClosureFindingGroup, LocalClosureFinding[]>
  generatedAt: string
  historicalCandidates: LocalClosureCandidate[]
  inputHashes: Record<string, string>
  reportId: string
  retiredTombstones: JsonObject[]
  schemaVersion: 1
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
  unresolvedDynamicEdges: Array<{
    edgeId: string
    kind: string
    reason: string
    sourceNodeId: string
  }>
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
