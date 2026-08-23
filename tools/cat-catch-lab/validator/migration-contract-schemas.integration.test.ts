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

function closureCandidate(candidateId: string, resolutionKind = 'current-node'): JsonObject {
  return {
    candidateId,
    path: `electron/service/${candidateId}.ts`,
    symbol: null,
    sourceHash: sha256,
    resolutionKind,
    resolutionRefId: resolutionKind === 'unresolved' ? null : 'node.capture',
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
    schemaVersion: 1,
    reportId: 'local-closure.test',
    validator: validatorBinding(),
    generatedAt,
    evidenceInputCommit: commit,
    evidenceInputTreeHash: sha256,
    discoveryRulesVersion: '1.0.0',
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
    bootstrapRoots: [{ nodeId: 'node.capture', path: 'electron/service/capture.ts', symbol: null }],
    discoveredNodes: [{
      nodeId: 'node.capture',
      path: 'electron/service/capture.ts',
      symbol: null,
      sourceHash: sha256,
      reachability: 'reachable',
      inventoryEntryId: 'inventory.capture',
      capabilityId: 'capture.test',
      cutoverUnitId: 'capture.unit',
      ownerRole: 'production-owner',
    }],
    edges: [],
    semanticCandidates: [closureCandidate('semantic.capture')],
    historicalCandidates: [closureCandidate('historical.capture')],
    declaredDynamicEdges: [],
    unresolvedDynamicEdges: [],
    approvedExclusions: [],
    retiredTombstones: [],
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
  it('accepts a non-vacuous, fully resolved passed report', () => {
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
    unresolvedSemantic.semanticCandidates = [closureCandidate('semantic.capture', 'unresolved')]
    expectInvalid(validateLocalClosure, unresolvedSemantic)

    const unresolvedHistorical = passedLocalClosure()
    unresolvedHistorical.historicalCandidates = [closureCandidate('historical.capture', 'unresolved')]
    expectInvalid(validateLocalClosure, unresolvedHistorical)

    const unresolvedDynamic = passedLocalClosure()
    unresolvedDynamic.unresolvedDynamicEdges = [{
      edgeId: 'edge.dynamic',
      sourceNodeId: 'node.capture',
      kind: 'dynamic-import',
      reason: 'The runtime target could not be resolved.',
    }]
    expectInvalid(validateLocalClosure, unresolvedDynamic)
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

  it('applies the audit requirement to intentional exclusions', () => {
    expectValid(validateCapabilityLedger, specifiedLedger(true))
    expectInvalid(validateCapabilityLedger, specifiedLedger(true, null))
  })
})
