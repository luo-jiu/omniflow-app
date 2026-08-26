import { fileURLToPath } from 'node:url'
import path from 'node:path'

import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { beforeAll, describe, expect, it } from 'vitest'

import { scanExactGitHistory, type ExactHistoryTouchset } from './exact-history-scan.ts'
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
  const candidatePath = `electron/service/${candidateId}.ts`
  return {
    candidateId,
    candidateKind,
    discoveryEvidence: historical
      ? {
          kind: 'changed-blob-query-hit',
          queryId: 'history.fixture.source',
          queryHit: {
            byteEnd: 16,
            byteStart: 1,
            commitId: commit,
            parentCommitId: null,
            path: candidatePath,
            rawSourceHash: sha256,
            side: 'after',
          },
        }
      : null,
    discoveryRuleIds: historical ? [] : ['semantic.capture'],
    lastKnownCommit: historical ? commit : null,
    locatorKind: historical ? 'declaration' : null,
    path: candidatePath,
    symbol: historical ? 'legacyCapture' : null,
    sourceHash: sha256,
    touchsetId: historical ? 'history.fixture' : null,
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

function semanticRule(inventory: JsonObject, id: string): JsonObject {
  const match = asArray(inventory.semanticScanRules)
    .map(value => asObject(value))
    .find(rule => rule.id === id)
  if (!match) throw new Error(`Semantic scan rule is missing: ${id}`)
  return match
}

function historicalTouchset(inventory: JsonObject, id: string): JsonObject {
  const match = asArray(inventory.historicalTouchsets)
    .map(value => asObject(value))
    .find(touchset => touchset.id === id)
  if (!match) throw new Error(`Historical touchset is missing: ${id}`)
  return match
}

function historicalCandidate(inventory: JsonObject, id: string): JsonObject {
  const match = asArray(inventory.historicalCandidates)
    .map(value => asObject(value))
    .find(candidate => candidate.id === id)
  if (!match) throw new Error(`Historical candidate is missing: ${id}`)
  return match
}

function historicalTouchsetReferenceIssues(inventory: JsonObject): string[] {
  const touchsetCounts = new Map<string, number>()
  for (const touchset of asArray(inventory.historicalTouchsets).map(value => asObject(value))) {
    if (typeof touchset.id !== 'string') continue
    touchsetCounts.set(touchset.id, (touchsetCounts.get(touchset.id) || 0) + 1)
  }
  return asArray(inventory.historicalCandidates)
    .map(value => asObject(value))
    .flatMap(candidate => {
      const candidateId = typeof candidate.id === 'string' ? candidate.id : '<missing>'
      const touchsetId = typeof candidate.touchsetId === 'string'
        ? candidate.touchsetId
        : '<missing>'
      const count = touchsetCounts.get(touchsetId) || 0
      return count === 1 ? [] : [`${candidateId}:${touchsetId}:${count}`]
    })
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

describe('Cat Catch semantic scan rule schema v2', () => {
  it('validates the executable checked-in v2 declaration and its result classifications', () => {
    expectValid(validateLegacyInventory, declaredLegacyInventory)
    expect(declaredLegacyInventory.schemaVersion).toBe(2)
    expect(declaredLegacyInventory.inventoryVersion).toBe('2026-08-26.1')
    expect(declaredLegacyInventory.discoveryRulesVersion).toBe('2026-08-26.1')

    const rules = asArray(declaredLegacyInventory.semanticScanRules).map(value => asObject(value))
    const staticGraphExtensions = ['.cjs', '.cts', '.js', '.jsx', '.mjs', '.mts', '.ts', '.tsx']
    expect(rules.every(rule => rule.matchProfile === 'utf8-literal-case-sensitive-v1')).toBe(true)
    expect(rules.every(rule => asArray(rule.includedExtensions).length > 0)).toBe(true)
    expect(rules.every(rule => asArray(rule.excludedPaths).length === 0)).toBe(true)
    const codeRules = rules.filter(rule => rule.resultKind !== 'audit-reference')
    expect(codeRules.map(rule => rule.includedExtensions))
      .toEqual(codeRules.map(() => staticGraphExtensions))

    expect(semanticRule(declaredLegacyInventory, 'scan.cat-catch-code-provenance'))
      .toEqual(expect.objectContaining({ resultKind: 'candidate', pathScopes: ['electron', 'src'] }))
    expect(semanticRule(declaredLegacyInventory, 'scan.cat-catch-docs-provenance'))
      .toEqual(expect.objectContaining({
        includedExtensions: ['.json', '.md'],
        resultKind: 'audit-reference',
        pathScopes: ['docs'],
      }))
    expect(semanticRule(declaredLegacyInventory, 'scan.tracked-generated-runtime').resultKind)
      .toBe('generated-mirror')

    const crossProcessPatterns = asArray(asArray(
      semanticRule(declaredLegacyInventory, 'scan.cross-process-channels').patternGroups,
    )[0])
    expect(crossProcessPatterns).toEqual(['embedded-browser:'])
    const dynamicPatterns = asArray(asArray(
      semanticRule(declaredLegacyInventory, 'scan.dynamic-runtime').patternGroups,
    )[0])
    expect(dynamicPatterns).not.toContain('.toString()')
    const ownerAndOutputGroups = asArray(semanticRule(
      declaredLegacyInventory,
      'scan.owner-and-output-state',
    ).patternGroups)
    expect(ownerAndOutputGroups).toHaveLength(2)
    expect(ownerAndOutputGroups[0]).toEqual(['embeddedBrowser', 'EmbeddedBrowser', 'embedded-browser'])
    const sensitiveContextGroups = asArray(semanticRule(
      declaredLegacyInventory,
      'scan.sensitive-request-context',
    ).patternGroups)
    expect(sensitiveContextGroups).toHaveLength(2)
    expect(sensitiveContextGroups[0]).toEqual(['embeddedBrowser', 'EmbeddedBrowser', 'embedded-browser'])
  })

  it('rejects legacy flat patterns and vacuous or unsupported v2 fields', () => {
    const legacy = clone(declaredLegacyInventory)
    const legacyRule = semanticRule(legacy, 'scan.embedded-browser-symbols')
    legacyRule.patterns = ['embeddedBrowser']
    delete legacyRule.patternGroups
    expectInvalid(validateLegacyInventory, legacy)

    const emptyOuterGroup = clone(declaredLegacyInventory)
    semanticRule(emptyOuterGroup, 'scan.embedded-browser-symbols').patternGroups = []
    expectInvalid(validateLegacyInventory, emptyOuterGroup)

    const emptyInnerGroup = clone(declaredLegacyInventory)
    semanticRule(emptyInnerGroup, 'scan.embedded-browser-symbols').patternGroups = [[]]
    expectInvalid(validateLegacyInventory, emptyInnerGroup)

    const unsupportedResultKind = clone(declaredLegacyInventory)
    semanticRule(unsupportedResultKind, 'scan.embedded-browser-symbols').resultKind = 'candidate-or-audit'
    expectInvalid(validateLegacyInventory, unsupportedResultKind)
  })
})

describe('Cat Catch historical scan declaration schema v2', () => {
  it('binds every checked-in historical candidate to one typed touchset and exact query hit', () => {
    expectValid(validateLegacyInventory, declaredLegacyInventory)
    expect(historicalTouchsetReferenceIssues(declaredLegacyInventory)).toEqual([])
    expect(Object.fromEntries(
      asArray(declaredLegacyInventory.historicalCandidates)
        .map(value => asObject(value))
        .map(candidate => [candidate.id, candidate.touchsetId]),
    )).toEqual({
      'historical.probe-monolith-before-split': 'history.capture-runtime-apr14-15',
      'historical.resource-service-before-split': 'history.capture-runtime-apr14-15',
      'historical.deep-hooks-port-snapshot': 'history.capture-runtime-apr14-15',
      'historical.mse-duration-snapshot': 'history.mse-spool-apr23',
      'historical.hls-parser-initial-snapshot': 'history.hls-dash-apr22-23',
      'historical.dash-parser-initial-snapshot': 'history.hls-dash-apr22-23',
    })
    expect(Object.fromEntries(
      asArray(declaredLegacyInventory.historicalCandidates)
        .map(value => asObject(value))
        .map(candidate => [candidate.id, asObject(candidate.discoveryEvidence).queryId]),
    )).toEqual({
      'historical.probe-monolith-before-split': 'candidate.probe-monolith',
      'historical.resource-service-before-split': 'candidate.resource-service',
      'historical.deep-hooks-port-snapshot': 'candidate.deep-hooks',
      'historical.mse-duration-snapshot': 'candidate.mse-duration',
      'historical.hls-parser-initial-snapshot': 'candidate.hls-parser',
      'historical.dash-parser-initial-snapshot': 'candidate.mpd-parser',
    })

    const scanCache = new Map<string, ReturnType<typeof scanExactGitHistory>>()
    for (const candidateValue of asArray(declaredLegacyInventory.historicalCandidates)) {
      const candidate = asObject(candidateValue)
      const touchsetId = String(candidate.touchsetId)
      let scan = scanCache.get(touchsetId)
      if (!scan) {
        scan = scanExactGitHistory(
          appRoot,
          historicalTouchset(
            declaredLegacyInventory,
            touchsetId,
          ) as unknown as ExactHistoryTouchset,
        )
        scanCache.set(touchsetId, scan)
      }
      expect(scan.ok, JSON.stringify(scan.issues, null, 2)).toBe(true)
      if (!scan.ok) continue
      const evidence = asObject(candidate.discoveryEvidence)
      const selector = asObject(evidence.queryHit)
      const exactHits = scan.result.queryHits.filter(hit => (
        hit.queryId === evidence.queryId
        && hit.commitId === selector.commitId
        && hit.parentCommitId === selector.parentCommitId
        && hit.path === selector.path
        && hit.side === selector.side
        && hit.rawSourceHash === selector.rawSourceHash
        && hit.byteStart === selector.byteStart
        && hit.byteEnd === selector.byteEnd
      ))
      expect(exactHits, String(candidate.id)).toHaveLength(1)
      const hit = exactHits[0]
      expect(evidence.kind).toBe('changed-blob-query-hit')
      expect(hit?.profile).toBe('changed-blob-literal-v1')
      expect(hit?.path).toBe(candidate.path)
      expect(hit?.rawSourceHash).toBe(candidate.sourceHash)
      expect(hit?.side === 'after' ? hit.commitId : hit?.parentCommitId)
        .toBe(candidate.lastKnownCommit)
    }
  })

  it('rejects legacy, nullable, empty, unsupported, and exactly duplicated query declarations', () => {
    const legacy = clone(declaredLegacyInventory)
    const legacyTouchset = historicalTouchset(legacy, 'history.capture-runtime-apr14-15')
    legacyTouchset.searchTerms = ['deep resource probe']
    delete legacyTouchset.queries
    expectInvalid(validateLegacyInventory, legacy)

    const nullableStart = clone(declaredLegacyInventory)
    historicalTouchset(nullableStart, 'history.capture-runtime-apr14-15').fromCommit = null
    expectInvalid(validateLegacyInventory, nullableStart)

    const emptyQueryId = clone(declaredLegacyInventory)
    const emptyIdQueries = asArray(historicalTouchset(
      emptyQueryId,
      'history.capture-runtime-apr14-15',
    ).queries)
    asObject(emptyIdQueries[0]).id = ''
    expectInvalid(validateLegacyInventory, emptyQueryId)

    const unsupportedProfile = clone(declaredLegacyInventory)
    const unsupportedQueries = asArray(historicalTouchset(
      unsupportedProfile,
      'history.capture-runtime-apr14-15',
    ).queries)
    asObject(unsupportedQueries[0]).profile = 'git-grep-regex-v1'
    expectInvalid(validateLegacyInventory, unsupportedProfile)

    const exactDuplicate = clone(declaredLegacyInventory)
    const duplicateQueries = asArray(historicalTouchset(
      exactDuplicate,
      'history.capture-runtime-apr14-15',
    ).queries)
    duplicateQueries.push(clone(duplicateQueries[0]))
    expectInvalid(validateLegacyInventory, exactDuplicate)

    const missingTouchsetRef = clone(declaredLegacyInventory)
    delete historicalCandidate(
      missingTouchsetRef,
      'historical.probe-monolith-before-split',
    ).touchsetId
    expectInvalid(validateLegacyInventory, missingTouchsetRef)

    const missingEvidence = clone(declaredLegacyInventory)
    delete historicalCandidate(
      missingEvidence,
      'historical.probe-monolith-before-split',
    ).discoveryEvidence
    expectInvalid(validateLegacyInventory, missingEvidence)

    const freeTextEvidence = clone(declaredLegacyInventory)
    historicalCandidate(
      freeTextEvidence,
      'historical.probe-monolith-before-split',
    ).discoveryEvidence = {
      rationale: 'This source was probably introduced by the touchset.',
    }
    expectInvalid(validateLegacyInventory, freeTextEvidence)

    const incompleteHit = clone(declaredLegacyInventory)
    const incompleteEvidence = asObject(historicalCandidate(
      incompleteHit,
      'historical.probe-monolith-before-split',
    ).discoveryEvidence)
    delete asObject(incompleteEvidence.queryHit).rawSourceHash
    expectInvalid(validateLegacyInventory, incompleteHit)

    const uncorrelatedMessage = clone(declaredLegacyInventory)
    historicalCandidate(
      uncorrelatedMessage,
      'historical.probe-monolith-before-split',
    ).discoveryEvidence = {
      kind: 'commit-message-query-hit-with-path-change',
      queryId: 'capture.resource-capture-split',
      queryHit: {
        byteEnd: 59,
        byteStart: 20,
        commitId: 'e1eeb8f0ae2c2b25f5277bb70665d8c97acca39b',
        parentCommitId: '49b6e999b077a0a994fff09edf6415072f322bb8',
        path: null,
        rawSourceHash: 'sha256:d57f31a6e266e09d1a1e1f3f77b796afe6f422f090475b562de2f537b3869b3e',
        side: 'commit-message',
      },
    }
    expectInvalid(validateLegacyInventory, uncorrelatedMessage)
  })

  it('leaves cross-record identity checks to executable fail-closed invariants', () => {
    const duplicateQueryId = clone(declaredLegacyInventory)
    const duplicateIdTouchset = historicalTouchset(
      duplicateQueryId,
      'history.capture-runtime-apr14-15',
    )
    const duplicateIdQueries = asArray(duplicateIdTouchset.queries)
    asObject(duplicateIdQueries[1]).id = asObject(duplicateIdQueries[0]).id
    expectValid(validateLegacyInventory, duplicateQueryId)

    const scan = scanExactGitHistory(
      '/not/a/repository',
      duplicateIdTouchset as unknown as ExactHistoryTouchset,
    )
    expect(scan).toEqual(expect.objectContaining({ ok: false, result: null }))
    expect(scan.issues).toContainEqual(expect.objectContaining({
      code: 'history-scan.query-id-duplicate',
      queryId: 'capture.resource-tools',
    }))

    const danglingTouchsetRef = clone(declaredLegacyInventory)
    historicalCandidate(
      danglingTouchsetRef,
      'historical.probe-monolith-before-split',
    ).touchsetId = 'history.missing'
    expectValid(validateLegacyInventory, danglingTouchsetRef)
    expect(historicalTouchsetReferenceIssues(danglingTouchsetRef)).toEqual([
      'historical.probe-monolith-before-split:history.missing:0',
    ])

    const duplicateTouchsetId = clone(declaredLegacyInventory)
    historicalTouchset(
      duplicateTouchsetId,
      'history.hls-dash-apr22-23',
    ).id = 'history.capture-runtime-apr14-15'
    expectValid(validateLegacyInventory, duplicateTouchsetId)
    expect(historicalTouchsetReferenceIssues(duplicateTouchsetId)).toEqual([
      'historical.probe-monolith-before-split:history.capture-runtime-apr14-15:2',
      'historical.resource-service-before-split:history.capture-runtime-apr14-15:2',
      'historical.deep-hooks-port-snapshot:history.capture-runtime-apr14-15:2',
      'historical.hls-parser-initial-snapshot:history.hls-dash-apr22-23:0',
      'historical.dash-parser-initial-snapshot:history.hls-dash-apr22-23:0',
    ])
  })
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
      ['discoveryEvidence', report => asObject(asArray(report.semanticCandidates)[0])],
      ['discoveryRuleIds', report => asObject(asArray(report.semanticCandidates)[0])],
      ['lastKnownCommit', report => asObject(asArray(report.semanticCandidates)[0])],
      ['touchsetId', report => asObject(asArray(report.semanticCandidates)[0])],
      ['candidateKind', report => asObject(asArray(report.historicalCandidates)[0])],
      ['locatorKind', report => asObject(asArray(report.historicalCandidates)[0])],
      ['discoveryEvidence', report => asObject(asArray(report.historicalCandidates)[0])],
      ['discoveryRuleIds', report => asObject(asArray(report.historicalCandidates)[0])],
      ['lastKnownCommit', report => asObject(asArray(report.historicalCandidates)[0])],
      ['touchsetId', report => asObject(asArray(report.historicalCandidates)[0])],
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

    const currentWithHistoricalEvidence = passedLocalClosure()
    const semanticCandidate = asObject(asArray(currentWithHistoricalEvidence.semanticCandidates)[0])
    const historicalCandidate = asObject(asArray(currentWithHistoricalEvidence.historicalCandidates)[0])
    semanticCandidate.discoveryEvidence = clone(historicalCandidate.discoveryEvidence)
    semanticCandidate.touchsetId = historicalCandidate.touchsetId
    expectInvalid(validateLocalClosure, currentWithHistoricalEvidence)

    const historicalWithoutTypedEvidence = passedLocalClosure()
    asObject(asArray(historicalWithoutTypedEvidence.historicalCandidates)[0]).discoveryEvidence = {
      rationale: 'A free-text claim is not exact discovery evidence.',
    }
    expectInvalid(validateLocalClosure, historicalWithoutTypedEvidence)

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
