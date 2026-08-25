import { fileURLToPath } from 'node:url'
import path from 'node:path'

import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { beforeAll, describe, expect, it } from 'vitest'

import { loadAndValidateContracts } from './schema-registry.ts'

type JsonObject = Record<string, unknown>

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const catCatchDirectory = path.join(appRoot, 'docs/cat-catch')
const commit = 'a'.repeat(40)
const sha256 = `sha256:${'a'.repeat(64)}`
const generatedAt = '2026-08-23T00:00:00.000Z'
const discoveryCoverageKeys = [
  'staticDependencyGraph',
  'reverseDependencyGraph',
  'semanticScan',
  'historicalTouchsetScan',
  'declaredDynamicEdges',
  'leastFixedPoint',
  'cutoverDependencyGraph',
] as const

const canonicalRiskRequirements = [
  {
    id: 'risk.production-runtime',
    whenAnySignals: ['production-runtime'],
    addRiskTags: ['production-runtime'],
    requireBeforeCutover: ['candidateIntegration'],
    requireForCompletion: ['candidateIntegration', 'activeIntegration'],
  },
  {
    id: 'risk.cross-process',
    whenAnySignals: ['cross-process'],
    addRiskTags: ['cross-process'],
    requireBeforeCutover: ['candidateIntegration'],
    requireForCompletion: ['candidateIntegration', 'activeIntegration'],
  },
  {
    id: 'risk.long-task',
    whenAnySignals: ['long-task'],
    addRiskTags: ['long-task'],
    requireBeforeCutover: ['candidateSoak'],
    requireForCompletion: ['candidateSoak', 'activeSoak'],
  },
  {
    id: 'risk.credentials',
    whenAnySignals: ['credentials'],
    addRiskTags: ['credentials', 'security-boundary'],
    requireBeforeCutover: ['candidateIntegration', 'candidateSoak'],
    requireForCompletion: ['candidateIntegration', 'candidateSoak', 'activeIntegration', 'activeSoak'],
  },
  {
    id: 'risk.security-boundary',
    whenAnySignals: ['security-boundary'],
    addRiskTags: ['security-boundary'],
    requireBeforeCutover: ['candidateIntegration', 'candidateSoak'],
    requireForCompletion: ['candidateIntegration', 'candidateSoak', 'activeIntegration', 'activeSoak'],
  },
  {
    id: 'risk.temp-file',
    whenAnySignals: ['temp-file'],
    addRiskTags: ['temp-file'],
    requireBeforeCutover: ['candidateSoak'],
    requireForCompletion: ['candidateSoak', 'activeSoak'],
  },
  {
    id: 'risk.large-media',
    whenAnySignals: ['large-media'],
    addRiskTags: ['large-media', 'long-task'],
    requireBeforeCutover: ['candidateSoak'],
    requireForCompletion: ['candidateSoak', 'activeSoak'],
  },
] as const

let declaredLegacyInventory: JsonObject
let declaredRiskPolicy: JsonObject
let validateCapabilityLedger: ValidateFunction
let validateLegacyInventory: ValidateFunction
let validateLocalClosure: ValidateFunction
let validateRiskPolicy: ValidateFunction

function asObject(value: unknown): JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Expected a JSON object')
  }
  return value as JsonObject
}

function asArray(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error('Expected a JSON array')
  return value
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

function requireValidator(ajv: Ajv2020, schemaId: string): ValidateFunction {
  const validate = ajv.getSchema(schemaId)
  if (!validate) throw new Error(`Schema validator is missing: ${schemaId}`)
  return validate
}

function expectValid(validate: ValidateFunction, value: JsonObject): void {
  expect(validate(value), JSON.stringify(validate.errors, null, 2)).toBe(true)
}

function expectInvalid(validate: ValidateFunction, value: JsonObject): void {
  expect(validate(value)).toBe(false)
}

function validatorBinding(): JsonObject {
  return {
    validatorId: 'cat-catch-validator',
    version: '1.0.0',
    sourceManifestHash: sha256,
    trustPolicyHash: sha256,
    trustClassification: 'trusted',
    approvalRef: {
      kind: 'user-decision',
      locator: 'decision://validator-bundle',
      payloadHashProfile: 'decision-payload-jcs-v1',
      contentHash: sha256,
    },
  }
}

function closureCandidate(
  candidateId: string,
  candidateKind: 'current' | 'historical',
  resolutionKind: 'current-node' | 'approved-exclusion' | 'retired-tombstone' | 'unresolved',
  resolutionRefId: string | null,
): JsonObject {
  const historical = candidateKind === 'historical'
  return {
    candidateId,
    candidateKind,
    discoveryRuleIds: historical ? [] : ['semantic.capture'],
    lastKnownCommit: historical ? commit : null,
    locatorKind: historical ? 'declaration' : null,
    path: `electron/service/${candidateId}.ts`,
    symbol: historical ? 'legacyCapture' : null,
    sourceHash: sha256,
    resolutionKind,
    resolutionRefId,
  }
}

function completeDiscoveryCoverage(): JsonObject {
  return Object.fromEntries(discoveryCoverageKeys.map(key => [key, 'complete']))
}

function unresolvedDynamicEdge(): JsonObject {
  return {
    actualSourceHash: null,
    declaredSourceHash: sha256,
    edgeId: 'edge.dynamic-unresolved',
    fixtureId: 'fixture.dynamic-unresolved',
    kind: 'dynamic-import',
    reason: 'The runtime target could not be resolved.',
    resolutionRule: 'Resolve the generated module path from the command payload.',
    source: {
      path: 'electron/service/capture.ts',
      symbol: null,
      locatorKind: null,
    },
    sourceNodeId: 'node.capture',
    target: {
      path: 'electron/service/generated-target.ts',
      symbol: null,
      locatorKind: null,
    },
    targetNodeId: 'unresolved-target.edge.dynamic-unresolved',
  }
}

function passedLocalClosure(): JsonObject {
  const findingGroups = {
    reachableLegacyProductionOwners: [],
    deadLegacySymbols: [],
    unmappedInScopeNodes: [],
    multipleOwnerPaths: [],
    activeLegacyGuidanceRefs: [],
    unresolvedEdges: [],
    auditRefs: [],
  }
  return {
    $schema: 'https://omniflow.local/schemas/cat-catch/local-closure-report.schema.json',
    schemaVersion: 2,
    reportId: 'local-closure.test',
    validator: validatorBinding(),
    generatedAt,
    evidenceInputCommit: commit,
    evidenceInputTreeHash: sha256,
    discoveryRulesVersion: '1.0.0',
    discoveryCoverage: completeDiscoveryCoverage(),
    inputHashes: {
      schemaBundle: sha256,
      capabilityLedger: sha256,
      legacyInventory: sha256,
      discoveryRules: sha256,
      validatorTrustPolicy: sha256,
    },
    sourceManifest: {
      manifestHash: sha256,
      entries: [{
        path: 'electron/service/capture.ts',
        mode: '100644',
        byteLength: 1,
        contentHash: sha256,
      }],
      exclusions: [],
    },
    bootstrapRoots: [{
      rootId: 'root.capture',
      category: 'composition-root',
      traversal: 'both',
      nodeId: 'node.capture',
      path: 'electron/service/capture.ts',
      symbol: null,
      locatorKind: null,
    }],
    discoveredNodes: [{
      nodeId: 'node.capture',
      path: 'electron/service/capture.ts',
      symbol: null,
      locatorKind: null,
      sourceHash: sha256,
      reachability: 'reachable',
      inventoryEntryId: 'inventory.capture',
      capabilityId: 'capture.test',
      classification: 'legacy',
      cutoverUnitId: 'capture.unit',
      ownerRole: 'production-owner',
      provenanceRefs: ['docs/cat-catch/migration-audit.md#capture'],
    }],
    edges: [],
    externalProcessEndpoints: [{
      nodeId: 'external-process.ffmpeg',
      path: 'external-process/ffmpeg',
      symbol: null,
      locatorKind: null,
      attributions: [{
        edgeId: 'edge.ffmpeg',
        sourceNodeId: 'node.capture',
        capabilityId: 'capture.test',
        cutoverUnitId: 'capture.unit',
        sourceHash: sha256,
        sourceReachability: 'reachable',
      }],
    }],
    semanticCandidates: [closureCandidate(
      'semantic.capture',
      'current',
      'approved-exclusion',
      'exclusion.semantic-capture',
    )],
    historicalCandidates: [closureCandidate(
      'historical.capture',
      'historical',
      'retired-tombstone',
      'inventory.retired-capture',
    )],
    declaredDynamicEdges: [{
      edgeId: 'edge.ffmpeg',
      fromNodeId: 'node.capture',
      toNodeId: 'external-process.ffmpeg',
      source: {
        path: 'electron/service/capture.ts',
        symbol: null,
        locatorKind: null,
      },
      target: {
        path: 'external-process/ffmpeg',
        symbol: null,
        locatorKind: null,
      },
      kind: 'process-handoff',
      provenance: 'declared-dynamic',
      sourceHash: sha256,
      resolutionRule: 'Spawn ffmpeg through the processing adapter.',
      fixtureId: 'fixture.ffmpeg-process',
    }],
    unresolvedDynamicEdges: [],
    approvedExclusions: [{
      exclusionId: 'exclusion.semantic-capture',
      candidateId: 'semantic.capture',
      candidateKind: 'current',
      path: 'electron/service/semantic.capture.ts',
      symbol: null,
      locatorKind: null,
      decisionId: 'decision.semantic-capture',
      decisionHash: sha256,
    }],
    retiredTombstones: [{
      inventoryEntryId: 'inventory.retired-capture',
      path: 'electron/service/historical.capture.ts',
      symbol: 'legacyCapture',
      locatorKind: 'declaration',
      deletedSourceHash: sha256,
      capabilityId: 'capture.test',
      cutoverUnitId: 'capture.unit',
      deletionCommit: commit,
      deletionEvidenceRef: {
        artifactId: 'transition.retired-capture',
        artifactSchemaId: 'https://omniflow.local/schemas/cat-catch/evidence-artifact.schema.json',
        contentHash: sha256,
      },
      provenanceRefs: ['docs/cat-catch/migration-audit.md#retired-capture'],
    }],
    counts: {
      reachableLegacyProductionOwners: 0,
      deadLegacySymbols: 0,
      unmappedInScopeNodes: 0,
      multipleOwnerPaths: 0,
      activeLegacyGuidanceRefs: 0,
      unresolvedEdges: 0,
      auditRefs: 0,
    },
    findings: findingGroups,
    status: 'passed',
    blockers: [],
  }
}

function riskRule(policy: JsonObject, id: string): JsonObject {
  const match = asArray(policy.rules)
    .map(value => asObject(value))
    .find(rule => rule.id === id)
  if (!match) throw new Error(`Risk rule is missing: ${id}`)
  return match
}

function dynamicEdge(inventory: JsonObject, id: string): JsonObject {
  const match = asArray(inventory.declaredDynamicEdges)
    .map(value => asObject(value))
    .find(edge => edge.id === id)
  if (!match) throw new Error(`Dynamic edge is missing: ${id}`)
  return match
}

function removeArrayValue(object: JsonObject, property: string, value: string): void {
  object[property] = asArray(object[property]).filter(item => item !== value)
}

function decisionRecord(): JsonObject {
  return {
    schemaVersion: 1,
    decisionId: 'decision.exclude-test',
    type: 'intentional-exclusion',
    rationale: 'The capability is outside the supported product scope.',
    userImpact: 'The excluded behavior is unavailable.',
    upstreamBehavior: 'Upstream exposes the behavior.',
    omniflowBehavior: 'OmniFlow intentionally omits the behavior.',
    fixtures: ['fixture.exclusion'],
    fixtureWaiver: null,
    approvalRef: {
      kind: 'user-decision',
      locator: 'decision://exclude-test',
      payloadHashProfile: 'decision-payload-jcs-v1',
      contentHash: sha256,
    },
    approvedAt: generatedAt,
    revisitWhen: 'Product scope changes.',
  }
}

function specifiedLedger(intentionalExclusion = false, auditedThrough: string | null = commit): JsonObject {
  return {
    $schema: './capability-ledger.schema.json',
    schemaVersion: 1,
    ledgerVersion: '2026-08-23.1',
    cutoverUnits: [{
      id: 'capture-unit',
      description: 'Capture test unit',
      atomicCutover: true,
      dependsOn: [],
      dependencyMapping: 'specified',
      dispatchBoundaryRefs: [],
    }],
    exclusionFamilies: [],
    capabilities: [{
      id: 'capture.test',
      origin: 'upstream-derived',
      boundary: 'main.capture',
      cutoverUnitId: 'capture-unit',
      additionalRiskTags: [],
      upstreamSources: [{
        path: 'js/background.js',
        anchor: 'capture handler',
        introducedBy: commit,
        blobHash: sha256,
      }],
      localContractRefs: [{
        path: 'electron/service/capture.ts',
        anchor: 'captureHandler',
        sourceHash: sha256,
      }],
      auditedThrough,
      oracleRelation: intentionalExclusion ? 'excluded' : 'exact',
      disposition: intentionalExclusion ? 'intentional-exclusion' : 'faithful-port',
      mapping: 'specified',
      requiredEvidence: intentionalExclusion
        ? { beforeCutover: [], forCompletion: [] }
        : {
            beforeCutover: ['fixture', 'behavior'],
            forCompletion: ['fixture', 'behavior'],
          },
      ownerRefs: intentionalExclusion
        ? { targetProduction: [], candidate: [], legacy: [] }
        : {
            targetProduction: ['electron/service/capture.ts#captureHandler'],
            candidate: [],
            legacy: [],
          },
      fixtures: intentionalExclusion ? ['fixture.exclusion'] : ['fixture.capture'],
      decision: intentionalExclusion ? decisionRecord() : null,
      acceptedDifferences: [],
      notes: '',
    }],
  }
}

beforeAll(() => {
  const { contracts, issues } = loadAndValidateContracts(catCatchDirectory)
  expect(issues).toEqual([])
  declaredLegacyInventory = asObject(contracts.documents.get('legacy-inventory.json'))
  declaredRiskPolicy = asObject(contracts.documents.get('risk-policy.json'))

  const ajv = new Ajv2020({ allErrors: true, strict: true, validateFormats: true })
  addFormats(ajv)
  for (const schema of contracts.schemas.values()) ajv.addSchema(schema)
  validateCapabilityLedger = requireValidator(ajv, 'https://omniflow.local/schemas/cat-catch/capability-ledger.schema.json')
  validateLegacyInventory = requireValidator(ajv, 'https://omniflow.local/schemas/cat-catch/legacy-inventory.schema.json')
  validateLocalClosure = requireValidator(ajv, 'https://omniflow.local/schemas/cat-catch/local-closure-report.schema.json')
  validateRiskPolicy = requireValidator(ajv, 'https://omniflow.local/schemas/cat-catch/risk-policy.schema.json')
})

describe('Cat Catch dynamic edge endpoint schema', () => {
  it('reserves external-process targets for symbol-free process handoffs', () => {
    expectValid(validateLegacyInventory, declaredLegacyInventory)

    const localProcessTarget = clone(declaredLegacyInventory)
    dynamicEdge(localProcessTarget, 'edge.ffmpeg-process-handoff').target = {
      path: 'electron/service/ffmpeg.ts',
      symbol: null,
    }
    expectInvalid(validateLegacyInventory, localProcessTarget)

    const symbolicProcessTarget = clone(declaredLegacyInventory)
    dynamicEdge(symbolicProcessTarget, 'edge.ffmpeg-process-handoff').target = {
      path: 'external-process/ffmpeg',
      symbol: 'ffmpeg',
    }
    expectInvalid(validateLegacyInventory, symbolicProcessTarget)

    const typedSymbolFreeTarget = clone(declaredLegacyInventory)
    dynamicEdge(typedSymbolFreeTarget, 'edge.ffmpeg-process-handoff').target = {
      path: 'external-process/ffmpeg',
      symbol: null,
      locatorKind: 'member',
    }
    expectInvalid(validateLegacyInventory, typedSymbolFreeTarget)

    for (const malformedPath of [
      'external-process/../ffmpeg',
      'external-process/.',
      'external-process/ ',
      'external-process\\ffmpeg',
      'external-process/group/ffmpeg',
    ]) {
      const malformedProcessTarget = clone(declaredLegacyInventory)
      dynamicEdge(malformedProcessTarget, 'edge.ffmpeg-process-handoff').target = {
        path: malformedPath,
        symbol: null,
      }
      expectInvalid(validateLegacyInventory, malformedProcessTarget)
    }

    const namespaceCollision = clone(declaredLegacyInventory)
    dynamicEdge(namespaceCollision, 'edge.output-path-library-handoff').target = {
      path: 'external-process/upload-manager',
      symbol: null,
    }
    expectInvalid(validateLegacyInventory, namespaceCollision)
  })

  it('rejects non-canonical repository locator aliases', () => {
    const inventory = clone(declaredLegacyInventory)
    const originalEntries = asArray(inventory.entries).map(value => asObject(value))
    const original = originalEntries[0]
    if (!original) throw new Error('Legacy inventory has no entries')
    asArray(inventory.entries).push({
      ...clone(original),
      id: 'node.alias-duplicate',
      path: `./${String(original.path)}`,
    })

    expectInvalid(validateLegacyInventory, inventory)
  })

  it('restricts typed locators to declaration, member, and runtime literals', () => {
    const inventory = clone(declaredLegacyInventory)
    const firstEntry = asObject(asArray(inventory.entries)[0])
    firstEntry.locatorKind = 'call-site'
    expectInvalid(validateLegacyInventory, inventory)
  })
})

describe('Cat Catch local closure report schema', () => {
  it('accepts a non-vacuous, lossless schemaVersion 2 passed report', () => {
    expectValid(validateLocalClosure, passedLocalClosure())
  })

  it('rejects passed reports without manifest entries, roots, or discovered nodes', () => {
    const noManifestEntries = passedLocalClosure()
    noManifestEntries.sourceManifest = { manifestHash: sha256, entries: [], exclusions: [] }
    expectInvalid(validateLocalClosure, noManifestEntries)

    const noRoots = passedLocalClosure()
    noRoots.bootstrapRoots = []
    expectInvalid(validateLocalClosure, noRoots)

    const noNodes = passedLocalClosure()
    noNodes.discoveredNodes = []
    expectInvalid(validateLocalClosure, noNodes)
  })

  it('rejects unresolved candidates and dynamic edges in passed reports', () => {
    const unresolvedSemantic = passedLocalClosure()
    unresolvedSemantic.semanticCandidates = [closureCandidate(
      'semantic.unresolved',
      'current',
      'unresolved',
      null,
    )]
    expectInvalid(validateLocalClosure, unresolvedSemantic)

    const unresolvedHistorical = passedLocalClosure()
    unresolvedHistorical.historicalCandidates = [closureCandidate(
      'historical.unresolved',
      'historical',
      'unresolved',
      null,
    )]
    expectInvalid(validateLocalClosure, unresolvedHistorical)

    const unresolvedDynamic = passedLocalClosure()
    unresolvedDynamic.unresolvedDynamicEdges = [unresolvedDynamicEdge()]
    expectInvalid(validateLocalClosure, unresolvedDynamic)
  })

  it('allows pending discovery and unknown reachability only before passed', () => {
    const blocked = passedLocalClosure()
    blocked.status = 'blocked'
    asObject(blocked.discoveryCoverage).staticDependencyGraph = 'pending'
    asObject(asArray(blocked.discoveredNodes)[0]).reachability = 'unknown'
    const blockedEndpoint = asObject(asArray(blocked.externalProcessEndpoints)[0])
    asObject(asArray(blockedEndpoint.attributions)[0]).sourceReachability = 'unknown'
    blocked.unresolvedDynamicEdges = [unresolvedDynamicEdge()]
    expectValid(validateLocalClosure, blocked)

    for (const coverageKey of discoveryCoverageKeys) {
      const pending = passedLocalClosure()
      asObject(pending.discoveryCoverage)[coverageKey] = 'pending'
      expectInvalid(validateLocalClosure, pending)
    }

    const unknownReachability = passedLocalClosure()
    asObject(asArray(unknownReachability.discoveredNodes)[0]).reachability = 'unknown'
    expectInvalid(validateLocalClosure, unknownReachability)
  })

  it('requires every stable discovery coverage dimension', () => {
    for (const coverageKey of discoveryCoverageKeys) {
      const report = passedLocalClosure()
      delete asObject(report.discoveryCoverage)[coverageKey]
      expectInvalid(validateLocalClosure, report)
    }

    const unknownCoverage = passedLocalClosure()
    asObject(unknownCoverage.discoveryCoverage).semanticScan = 'unknown'
    expectInvalid(validateLocalClosure, unknownCoverage)
  })

  it('preserves bootstrap, locator, candidate, and edge projection fields', () => {
    const projectionFields: Array<[string, (report: JsonObject) => JsonObject]> = [
      ['rootId', report => asObject(asArray(report.bootstrapRoots)[0])],
      ['category', report => asObject(asArray(report.bootstrapRoots)[0])],
      ['traversal', report => asObject(asArray(report.bootstrapRoots)[0])],
      ['locatorKind', report => asObject(asArray(report.bootstrapRoots)[0])],
      ['locatorKind', report => asObject(asArray(report.discoveredNodes)[0])],
      ['classification', report => asObject(asArray(report.discoveredNodes)[0])],
      ['provenanceRefs', report => asObject(asArray(report.discoveredNodes)[0])],
      ['source', report => asObject(asArray(report.declaredDynamicEdges)[0])],
      ['target', report => asObject(asArray(report.declaredDynamicEdges)[0])],
      ['resolutionRule', report => asObject(asArray(report.declaredDynamicEdges)[0])],
      ['fixtureId', report => asObject(asArray(report.declaredDynamicEdges)[0])],
      ['candidateKind', report => asObject(asArray(report.semanticCandidates)[0])],
      ['locatorKind', report => asObject(asArray(report.semanticCandidates)[0])],
      ['discoveryRuleIds', report => asObject(asArray(report.semanticCandidates)[0])],
      ['lastKnownCommit', report => asObject(asArray(report.semanticCandidates)[0])],
      ['candidateKind', report => asObject(asArray(report.historicalCandidates)[0])],
      ['locatorKind', report => asObject(asArray(report.historicalCandidates)[0])],
      ['discoveryRuleIds', report => asObject(asArray(report.historicalCandidates)[0])],
      ['lastKnownCommit', report => asObject(asArray(report.historicalCandidates)[0])],
    ]

    for (const [field, select] of projectionFields) {
      const report = passedLocalClosure()
      delete select(report)[field]
      expectInvalid(validateLocalClosure, report)
    }

    const wrongSemanticKind = passedLocalClosure()
    asObject(asArray(wrongSemanticKind.semanticCandidates)[0]).candidateKind = 'historical'
    expectInvalid(validateLocalClosure, wrongSemanticKind)

    const wrongHistoricalKind = passedLocalClosure()
    asObject(asArray(wrongHistoricalKind.historicalCandidates)[0]).candidateKind = 'current'
    expectInvalid(validateLocalClosure, wrongHistoricalKind)

    const missingHistoricalResolutionRef = passedLocalClosure()
    asObject(asArray(missingHistoricalResolutionRef.historicalCandidates)[0]).resolutionRefId = null
    expectInvalid(validateLocalClosure, missingHistoricalResolutionRef)

    const typedSymbolFreeLocator = passedLocalClosure()
    asObject(asArray(typedSymbolFreeLocator.discoveredNodes)[0]).locatorKind = 'declaration'
    expectInvalid(validateLocalClosure, typedSymbolFreeLocator)
  })

  it('requires complete external-process endpoint attribution', () => {
    for (const field of [
      'nodeId',
      'path',
      'symbol',
      'locatorKind',
      'attributions',
    ]) {
      const report = passedLocalClosure()
      delete asObject(asArray(report.externalProcessEndpoints)[0])[field]
      expectInvalid(validateLocalClosure, report)
    }

    const attributionFields = [
      'edgeId',
      'sourceNodeId',
      'capabilityId',
      'cutoverUnitId',
      'sourceHash',
      'sourceReachability',
    ]
    for (const field of attributionFields) {
      const report = passedLocalClosure()
      const endpoint = asObject(asArray(report.externalProcessEndpoints)[0])
      delete asObject(asArray(endpoint.attributions)[0])[field]
      expectInvalid(validateLocalClosure, report)
    }

    const emptyAttributions = passedLocalClosure()
    asObject(asArray(emptyAttributions.externalProcessEndpoints)[0]).attributions = []
    expectInvalid(validateLocalClosure, emptyAttributions)

    const unknownSource = passedLocalClosure()
    const endpoint = asObject(asArray(unknownSource.externalProcessEndpoints)[0])
    asObject(asArray(endpoint.attributions)[0]).sourceReachability = 'unknown'
    expectInvalid(validateLocalClosure, unknownSource)

    const nonProcessTarget = passedLocalClosure()
    asObject(asObject(asArray(nonProcessTarget.declaredDynamicEdges)[0]).target).path = 'electron/service/ffmpeg.ts'
    expectInvalid(validateLocalClosure, nonProcessTarget)
  })

  it('preserves approved exclusion and retired tombstone provenance', () => {
    for (const field of [
      'candidateKind',
      'path',
      'symbol',
      'locatorKind',
      'decisionId',
      'decisionHash',
    ]) {
      const report = passedLocalClosure()
      delete asObject(asArray(report.approvedExclusions)[0])[field]
      expectInvalid(validateLocalClosure, report)
    }

    for (const field of [
      'locatorKind',
      'capabilityId',
      'cutoverUnitId',
      'deletionCommit',
      'deletionEvidenceRef',
      'provenanceRefs',
    ]) {
      const report = passedLocalClosure()
      delete asObject(asArray(report.retiredTombstones)[0])[field]
      expectInvalid(validateLocalClosure, report)
    }

    const emptyProvenance = passedLocalClosure()
    asObject(asArray(emptyProvenance.retiredTombstones)[0]).provenanceRefs = []
    expectInvalid(validateLocalClosure, emptyProvenance)
  })

  it('requires lossless unresolved dynamic edge diagnostics', () => {
    const requiredFields = [
      'actualSourceHash',
      'declaredSourceHash',
      'edgeId',
      'fixtureId',
      'kind',
      'reason',
      'resolutionRule',
      'source',
      'sourceNodeId',
      'target',
      'targetNodeId',
    ]

    for (const field of requiredFields) {
      const report = passedLocalClosure()
      report.status = 'blocked'
      report.unresolvedDynamicEdges = [unresolvedDynamicEdge()]
      delete asObject(asArray(report.unresolvedDynamicEdges)[0])[field]
      expectInvalid(validateLocalClosure, report)
    }
  })
})

describe('Cat Catch canonical risk policy schema', () => {
  it('allows additional rules and stricter evidence requirements', () => {
    const policy = clone(declaredRiskPolicy)
    asArray(riskRule(policy, 'risk.production-runtime').requireBeforeCutover).push('fixture')
    asArray(riskRule(policy, 'risk.production-runtime').requireForCompletion).push('fixture')
    asArray(policy.rules).push({
      id: 'risk.additional',
      whenAnySignals: ['additional-signal'],
      addRiskTags: ['production-runtime'],
      requireBeforeCutover: [],
      requireForCompletion: [],
    })
    expectValid(validateRiskPolicy, policy)
  })

  it('requires exactly one rule for every canonical id', () => {
    const missingRule = clone(declaredRiskPolicy)
    riskRule(missingRule, 'risk.temp-file').id = 'risk.additional'
    expectInvalid(validateRiskPolicy, missingRule)

    const duplicateRule = clone(declaredRiskPolicy)
    const duplicate = clone(riskRule(duplicateRule, 'risk.temp-file'))
    duplicate.whenAnySignals = [...asArray(duplicate.whenAnySignals), 'another-temp-signal']
    asArray(duplicateRule.rules).push(duplicate)
    expectInvalid(validateRiskPolicy, duplicateRule)
  })

  it('preserves the minimum semantics of every canonical rule', () => {
    for (const requirement of canonicalRiskRequirements) {
      for (const property of [
        'whenAnySignals',
        'addRiskTags',
        'requireBeforeCutover',
        'requireForCompletion',
      ] as const) {
        for (const requiredValue of requirement[property]) {
          const policy = clone(declaredRiskPolicy)
          removeArrayValue(riskRule(policy, requirement.id), property, requiredValue)
          expectInvalid(validateRiskPolicy, policy)
        }
      }
    }
  })
})

describe('Cat Catch capability ledger audit binding', () => {
  it('requires a commit for specified mappings', () => {
    expectValid(validateCapabilityLedger, specifiedLedger())
    expectInvalid(validateCapabilityLedger, specifiedLedger(false, null))
  })

  it('requires a classified disposition for specified mappings', () => {
    const ledger = specifiedLedger()
    const capability = asObject(asArray(ledger.capabilities)[0])
    capability.disposition = 'pending'
    expectInvalid(validateCapabilityLedger, ledger)
  })

  it('keeps derived closure artifact refs out of specified cutover declarations', () => {
    const ledger = specifiedLedger()
    const cutoverUnit = asObject(asArray(ledger.cutoverUnits)[0])
    expect(cutoverUnit).not.toHaveProperty('dependencyEvidenceRefs')
    expectValid(validateCapabilityLedger, ledger)

    cutoverUnit.dependencyEvidenceRefs = [{
      artifactId: 'local-closure.test',
      artifactSchemaId: 'https://omniflow.local/schemas/cat-catch/local-closure-report.schema.json',
      contentHash: sha256,
    }]
    expectInvalid(validateCapabilityLedger, ledger)
  })

  it('applies the audit requirement to intentional exclusions', () => {
    expectValid(validateCapabilityLedger, specifiedLedger(true))
    expectInvalid(validateCapabilityLedger, specifiedLedger(true, null))
  })
})
