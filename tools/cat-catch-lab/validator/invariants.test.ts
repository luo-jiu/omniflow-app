import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { validateCrossFileInvariants } from './invariants.ts'
import { hashFile } from './json.ts'
import type { JsonObject, ValidationContext } from './types.ts'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true })
  }
})

function createContext(ledger: JsonObject): ValidationContext {
  const appRoot = mkdtempSync(path.join(tmpdir(), 'cat-catch-validator-'))
  temporaryDirectories.push(appRoot)
  execFileSync('git', ['init', '--quiet'], { cwd: appRoot })
  execFileSync('git', ['config', 'user.email', 'validator@example.invalid'], { cwd: appRoot })
  execFileSync('git', ['config', 'user.name', 'Validator Test'], { cwd: appRoot })
  execFileSync('git', ['commit', '--quiet', '--allow-empty', '-m', 'baseline'], { cwd: appRoot })
  return {
    appRoot,
    catCatchDirectory: path.join(appRoot, 'docs/cat-catch'),
    documents: new Map<string, JsonObject>([
      ['capability-ledger.json', ledger],
      ['legacy-inventory.json', {
        entries: [],
        historicalCandidates: [],
      }],
      ['release-targets.json', { blockers: [], targets: [] }],
      ['evidence-retention-policy.json', { promotionMode: 'enabled', officialStores: [{}] }],
      ['validator-trust-policy.json', {
        approvalProviders: [{}],
        trustMode: 'active',
        trustedRunnerIdentities: [{}],
        trustedValidatorBundles: [{}],
      }],
      ['automation-policy.json', { runtimeModificationMode: 'report-only' }],
      ['risk-policy.json', {
        knownRiskTags: ['production-runtime'],
        rules: [{
          whenAnySignals: ['production-runtime'],
          requireBeforeCutover: ['candidateIntegration'],
          requireForCompletion: ['candidateIntegration', 'activeIntegration'],
        }],
      }],
      ['report-index/index.json', { entries: [{ gateId: 'G0' }] }],
    ]),
    inputHashes: {},
    schemas: new Map(),
    upstreamRoot: appRoot,
  }
}

function commitCandidateInputs(context: ValidationContext): void {
  execFileSync('git', ['add', '.'], { cwd: context.appRoot })
  execFileSync('git', ['commit', '--quiet', '-m', 'candidate input'], { cwd: context.appRoot })
}

describe('Cat Catch contract invariants', () => {
  it('rejects derived state stored in the declaration ledger', () => {
    const context = createContext({
      status: 'passed',
      cutoverUnits: [],
      capabilities: [],
    })

    expect(validateCrossFileInvariants(context)).toContainEqual(expect.objectContaining({
      code: 'derived-ledger-field',
      severity: 'error',
    }))
  })

  it('does not let a capability weaken fixed evidence minima', () => {
    const context = createContext({
      cutoverUnits: [{ id: 'output' }],
      capabilities: [],
    })
    const contractPath = path.join(context.appRoot, 'contract.ts')
    writeFileSync(contractPath, 'export const contract = true\n')
    commitCandidateInputs(context)
    const ledger = context.documents.get('capability-ledger.json')
    if (!ledger) throw new Error('test ledger missing')
    ledger.capabilities = [{
      id: 'output.test',
      auditedThrough: null,
      cutoverUnitId: 'output',
      origin: 'omniflow-integration',
      disposition: 'omniflow-native',
      upstreamSources: [],
      localContractRefs: [{
        path: 'contract.ts',
        anchor: 'contract',
        sourceHash: hashFile(contractPath),
      }],
      requiredEvidence: {
        beforeCutover: ['fixture'],
        forCompletion: ['fixture'],
      },
    }]

    const issues = validateCrossFileInvariants(context)
    expect(issues.filter(issue => issue.code === 'fixed-evidence-minimum-missing')).toHaveLength(2)
  })

  it('detects stale local source hashes without treating them as schema errors', () => {
    const context = createContext({
      cutoverUnits: [{ id: 'output' }],
      capabilities: [],
    })
    const contractPath = path.join(context.appRoot, 'contract.ts')
    writeFileSync(contractPath, 'export const contract = true\n')
    commitCandidateInputs(context)
    const ledger = context.documents.get('capability-ledger.json')
    if (!ledger) throw new Error('test ledger missing')
    ledger.capabilities = [{
      id: 'output.test',
      auditedThrough: null,
      cutoverUnitId: 'output',
      origin: 'omniflow-integration',
      disposition: 'omniflow-native',
      upstreamSources: [],
      localContractRefs: [{
        path: 'contract.ts',
        anchor: 'contract',
        sourceHash: `sha256:${'0'.repeat(64)}`,
      }],
      requiredEvidence: {
        beforeCutover: ['fixture', 'behavior'],
        forCompletion: ['fixture', 'behavior'],
      },
    }]

    expect(validateCrossFileInvariants(context)).toContainEqual(expect.objectContaining({
      code: 'source-hash-mismatch',
      severity: 'blocker',
    }))
  })

  it('enforces additive risk-policy evidence requirements', () => {
    const context = createContext({
      cutoverUnits: [{ id: 'output' }],
      capabilities: [],
    })
    const contractPath = path.join(context.appRoot, 'contract.ts')
    writeFileSync(contractPath, 'export const contract = true\n')
    commitCandidateInputs(context)
    const ledger = context.documents.get('capability-ledger.json')
    if (!ledger) throw new Error('test ledger missing')
    ledger.capabilities = [{
      id: 'output.test',
      additionalRiskTags: ['production-runtime'],
      auditedThrough: null,
      cutoverUnitId: 'output',
      disposition: 'omniflow-native',
      localContractRefs: [{
        path: 'contract.ts',
        anchor: 'contract',
        sourceHash: hashFile(contractPath),
      }],
      origin: 'omniflow-integration',
      requiredEvidence: {
        beforeCutover: ['fixture', 'behavior'],
        forCompletion: ['fixture', 'behavior'],
      },
      upstreamSources: [],
    }]

    expect(validateCrossFileInvariants(context).filter(issue => (
      issue.code === 'risk-evidence-minimum-missing'
    ))).toHaveLength(3)
  })

  it('deduplicates evidence requirements shared by multiple risk rules', () => {
    const context = createContext({
      cutoverUnits: [{ id: 'output' }],
      capabilities: [],
    })
    const contractPath = path.join(context.appRoot, 'contract.ts')
    writeFileSync(contractPath, 'export const contract = true\n')
    commitCandidateInputs(context)
    context.documents.set('risk-policy.json', {
      knownRiskTags: ['production-runtime', 'cross-process'],
      rules: [
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
      ],
    })
    const ledger = context.documents.get('capability-ledger.json')
    if (!ledger) throw new Error('test ledger missing')
    ledger.capabilities = [{
      id: 'output.test',
      additionalRiskTags: ['production-runtime', 'cross-process'],
      auditedThrough: null,
      cutoverUnitId: 'output',
      disposition: 'omniflow-native',
      localContractRefs: [{
        path: 'contract.ts',
        anchor: 'contract',
        sourceHash: hashFile(contractPath),
      }],
      origin: 'omniflow-integration',
      requiredEvidence: {
        beforeCutover: ['fixture', 'behavior'],
        forCompletion: ['fixture', 'behavior'],
      },
      upstreamSources: [],
    }]

    const riskIssues = validateCrossFileInvariants(context).filter(issue => (
      issue.code === 'risk-evidence-minimum-missing'
    ))
    expect(riskIssues).toHaveLength(3)
    expect(riskIssues[0]?.message).toContain('risk.production-runtime, risk.cross-process')
  })

  it('evaluates risk tags added by matched rules to a fixed point', () => {
    const context = createContext({
      cutoverUnits: [{ id: 'output' }],
      capabilities: [],
    })
    const contractPath = path.join(context.appRoot, 'contract.ts')
    writeFileSync(contractPath, 'export const contract = true\n')
    commitCandidateInputs(context)
    context.documents.set('risk-policy.json', {
      knownRiskTags: ['production-runtime', 'security-boundary'],
      rules: [
        {
          id: 'risk.production-runtime',
          whenAnySignals: ['production-runtime'],
          addRiskTags: ['security-boundary'],
          requireBeforeCutover: [],
          requireForCompletion: [],
        },
        {
          id: 'risk.security-boundary',
          whenAnySignals: ['security-boundary'],
          addRiskTags: ['security-boundary'],
          requireBeforeCutover: ['candidateSoak'],
          requireForCompletion: ['candidateSoak', 'activeSoak'],
        },
      ],
    })
    const ledger = context.documents.get('capability-ledger.json')
    if (!ledger) throw new Error('test ledger missing')
    ledger.capabilities = [{
      id: 'output.test',
      additionalRiskTags: ['production-runtime'],
      auditedThrough: null,
      cutoverUnitId: 'output',
      disposition: 'omniflow-native',
      localContractRefs: [{
        path: 'contract.ts',
        anchor: 'contract',
        sourceHash: hashFile(contractPath),
      }],
      origin: 'omniflow-integration',
      requiredEvidence: {
        beforeCutover: ['fixture', 'behavior'],
        forCompletion: ['fixture', 'behavior'],
      },
      upstreamSources: [],
    }]

    const riskIssues = validateCrossFileInvariants(context).filter(issue => (
      issue.code === 'risk-evidence-minimum-missing'
    ))
    expect(riskIssues).toHaveLength(3)
    expect(riskIssues.every(issue => issue.message.includes('risk.security-boundary'))).toBe(true)
  })

  it('does not accept an unverified gate index summary as a G0 report', () => {
    const context = createContext({ cutoverUnits: [], capabilities: [] })
    context.documents.set('report-index/index.json', {
      entries: [{
        artifactId: 'not-g0',
        artifactKind: 'gate',
        artifactSchemaId: 'https://omniflow.local/schemas/cat-catch/evidence-artifact.schema.json',
        contentHash: `sha256:${'0'.repeat(64)}`,
        locations: [{ canonical: false }],
        validationSummary: {
          schemaValidated: false,
          hashValidated: false,
          reportedStatus: 'failed',
        },
      }],
    })

    const issues = validateCrossFileInvariants(context)
    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'artifact-schema-kind-mismatch', severity: 'error' }),
      expect.objectContaining({ code: 'artifact-canonical-location-invalid', severity: 'error' }),
      expect.objectContaining({ code: 'artifact-index-summary-not-passed', severity: 'blocker' }),
      expect.objectContaining({ code: 'g0-report-unresolved', severity: 'blocker' }),
      expect.objectContaining({ code: 'canonical-artifact-resolution-not-implemented', severity: 'blocker' }),
    ]))
    expect(issues).not.toContainEqual(expect.objectContaining({ code: 'g0-report-missing' }))
  })

  it('requires inventory cutover mappings to agree with the capability ledger', () => {
    const context = createContext({
      cutoverUnits: [{ id: 'capture' }, { id: 'other' }],
      capabilities: [{
        id: 'capture.test',
        auditedThrough: 'a'.repeat(40),
        cutoverUnitId: 'capture',
        disposition: 'port-required',
        localContractRefs: [],
        mapping: 'specified',
        origin: 'upstream-derived',
        requiredEvidence: {
          beforeCutover: ['fixture', 'behavior'],
          forCompletion: ['fixture', 'behavior'],
        },
        upstreamSources: [],
      }],
    })
    const sourcePath = path.join(context.appRoot, 'node.ts')
    writeFileSync(sourcePath, 'export const inventoryNode = true\n')
    commitCandidateInputs(context)
    context.documents.set('legacy-inventory.json', {
      entries: [{
        id: 'node.capture',
        entryType: 'current-node',
        path: 'node.ts',
        symbol: 'inventoryNode',
        sourceHash: hashFile(sourcePath),
        capabilityId: 'capture.test',
        cutoverUnitId: 'other',
      }],
      historicalCandidates: [],
    })

    expect(validateCrossFileInvariants(context)).toContainEqual(expect.objectContaining({
      code: 'inventory-cutover-unit-mismatch',
      severity: 'error',
    }))
  })

  it('rejects duplicate inventory ids and locators even when the records differ', () => {
    const context = createContext({ cutoverUnits: [], capabilities: [] })
    const sourcePath = path.join(context.appRoot, 'node.ts')
    writeFileSync(sourcePath, 'export const firstNode = true\nexport const secondNode = true\n')
    commitCandidateInputs(context)
    context.documents.set('legacy-inventory.json', {
      entries: [
        {
          id: 'node.duplicate',
          entryType: 'current-node',
          path: 'node.ts',
          symbol: 'firstNode',
          sourceHash: hashFile(sourcePath),
          capabilityId: null,
          cutoverUnitId: null,
        },
        {
          id: 'node.duplicate',
          entryType: 'current-node',
          path: 'node.ts',
          symbol: 'firstNode',
          sourceHash: hashFile(sourcePath),
          capabilityId: null,
          cutoverUnitId: null,
          provenanceRefs: ['different-record'],
        },
      ],
      historicalCandidates: [],
    })

    const issues = validateCrossFileInvariants(context)
    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'duplicate-id', severity: 'error' }),
      expect.objectContaining({ code: 'duplicate-inventory-locator', severity: 'error' }),
      expect.objectContaining({ code: 'inventory-capability-unmapped', severity: 'blocker' }),
      expect.objectContaining({ code: 'inventory-cutover-unit-unmapped', severity: 'blocker' }),
    ]))
  })

  it('requires historical candidate resolutions to identify the declared record kind', () => {
    const context = createContext({ cutoverUnits: [], capabilities: [] })
    context.documents.set('legacy-inventory.json', {
      approvedExclusions: [{
        id: 'exclude.current-only',
        candidateKind: 'current',
        path: 'legacy.ts',
        symbol: 'legacyNode',
        decision: { type: 'intentional-exclusion' },
      }],
      entries: [],
      historicalCandidates: [{
        id: 'historical.legacy-node',
        path: 'legacy.ts',
        symbol: 'legacyNode',
        lastKnownCommit: 'a'.repeat(40),
        sourceHash: `sha256:${'0'.repeat(64)}`,
        resolution: {
          kind: 'approved-exclusion',
          refId: 'exclude.current-only',
        },
      }],
    })

    expect(validateCrossFileInvariants(context)).toContainEqual(expect.objectContaining({
      code: 'historical-candidate-resolution-unresolved',
      severity: 'blocker',
    }))
  })

  it('requires tombstone deletion commits and evidence to be independently resolvable', () => {
    const context = createContext({
      cutoverUnits: [{ id: 'capture' }],
      capabilities: [{
        id: 'capture.test',
        auditedThrough: 'a'.repeat(40),
        cutoverUnitId: 'capture',
        disposition: 'port-required',
        localContractRefs: [],
        mapping: 'specified',
        origin: 'upstream-derived',
        requiredEvidence: {
          beforeCutover: ['fixture', 'behavior'],
          forCompletion: ['fixture', 'behavior'],
        },
        upstreamSources: [],
      }],
    })
    context.documents.set('legacy-inventory.json', {
      entries: [{
        id: 'tombstone.capture',
        entryType: 'retired-tombstone',
        path: 'retired.ts',
        symbol: 'retiredNode',
        deletedSourceHash: `sha256:${'0'.repeat(64)}`,
        capabilityId: 'capture.test',
        cutoverUnitId: 'capture',
        deletionCommit: 'a'.repeat(40),
        deletionEvidenceRef: {
          artifactId: 'evidence.missing',
          artifactSchemaId: 'https://omniflow.local/schemas/cat-catch/evidence-artifact.schema.json',
          contentHash: `sha256:${'1'.repeat(64)}`,
        },
      }],
      historicalCandidates: [],
    })

    const issues = validateCrossFileInvariants(context)
    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'tombstone-deletion-commit-missing', severity: 'blocker' }),
      expect.objectContaining({ code: 'tombstone-deletion-evidence-unresolved', severity: 'blocker' }),
    ]))
  })

  it('rejects cyclic cutover dependency declarations', () => {
    const context = createContext({
      cutoverUnits: [
        { id: 'first', dependencyMapping: 'specified', dependsOn: ['second'] },
        { id: 'second', dependencyMapping: 'specified', dependsOn: ['first'] },
      ],
      capabilities: [],
    })

    expect(validateCrossFileInvariants(context)).toContainEqual(expect.objectContaining({
      code: 'cutover-dependency-cycle',
      severity: 'error',
    }))
  })

  it('requires bootstrap coverage and resolvable dynamic-edge fixtures', () => {
    const context = createContext({
      cutoverUnits: [{ id: 'capture', dependencyMapping: 'pending', dependsOn: [] }],
      capabilities: [],
    })
    writeFileSync(
      path.join(context.appRoot, 'runtime.ts'),
      'export const sourceNode = true\nexport const targetNode = true\n',
    )
    commitCandidateInputs(context)
    context.documents.set('legacy-inventory.json', {
      bootstrapRoots: [{
        id: 'root.runtime',
        path: 'runtime.ts',
        symbol: 'sourceNode',
      }],
      semanticScanRules: [],
      historicalTouchsets: [],
      entries: [],
      historicalCandidates: [],
      approvedExclusions: [],
      declaredDynamicEdges: [{
        id: 'edge.runtime',
        kind: 'runtime-template',
        source: { path: 'runtime.ts', symbol: 'sourceNode' },
        target: { path: 'runtime.ts', symbol: 'targetNode' },
        sourceHash: hashFile(path.join(context.appRoot, 'runtime.ts')),
        fixtureId: 'closure.runtime',
      }],
    })

    expect(validateCrossFileInvariants(context)).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'bootstrap-root-not-inventoried', severity: 'blocker' }),
      expect.objectContaining({ code: 'dynamic-edge-fixture-unmapped', severity: 'blocker' }),
    ]))
  })

  it('does not accept a dynamic-edge fixture declared by the wrong capability', () => {
    const baseCapability = {
      auditedThrough: null,
      cutoverUnitId: 'capture',
      disposition: 'pending',
      localContractRefs: [],
      mapping: 'unmapped',
      origin: 'omniflow-integration',
      requiredEvidence: {
        beforeCutover: ['fixture', 'behavior'],
        forCompletion: ['fixture', 'behavior'],
      },
      upstreamSources: [],
    }
    const context = createContext({
      cutoverUnits: [{ id: 'capture', dependencyMapping: 'pending', dependsOn: [] }],
      capabilities: [
        { ...baseCapability, id: 'capture.owner', fixtures: [] },
        { ...baseCapability, id: 'capture.unrelated', fixtures: ['closure.runtime'] },
      ],
    })
    const sourcePath = path.join(context.appRoot, 'runtime.ts')
    writeFileSync(sourcePath, 'export const sourceNode = true\nexport const targetNode = true\n')
    commitCandidateInputs(context)
    context.documents.set('legacy-inventory.json', {
      bootstrapRoots: [],
      semanticScanRules: [],
      historicalTouchsets: [],
      entries: [{
        id: 'node.runtime',
        entryType: 'current-node',
        path: 'runtime.ts',
        symbol: 'sourceNode',
        sourceHash: hashFile(sourcePath),
        capabilityId: 'capture.owner',
        cutoverUnitId: 'capture',
      }],
      historicalCandidates: [],
      approvedExclusions: [],
      declaredDynamicEdges: [{
        id: 'edge.runtime',
        kind: 'runtime-template',
        source: { path: 'runtime.ts', symbol: 'sourceNode' },
        target: { path: 'runtime.ts', symbol: 'targetNode' },
        sourceHash: hashFile(sourcePath),
        fixtureId: 'closure.runtime',
      }],
    })

    const issues = validateCrossFileInvariants(context)
    expect(issues).toContainEqual(expect.objectContaining({
      code: 'dynamic-edge-fixture-capability-mismatch',
      severity: 'blocker',
    }))
    expect(issues).not.toContainEqual(expect.objectContaining({
      code: 'dynamic-edge-fixture-unmapped',
    }))
    expect(issues).toContainEqual(expect.objectContaining({
      code: 'dynamic-edge-attribution-unresolved',
      path: 'legacy-inventory.json.declaredDynamicEdges[0].target',
    }))
  })

  it('attributes dynamic edge endpoints by exact path and symbol', () => {
    const capability = (id: string) => ({
      additionalRiskTags: [],
      auditedThrough: null,
      cutoverUnitId: 'capture',
      disposition: 'pending',
      fixtures: ['closure.runtime'],
      id,
      localContractRefs: [],
      mapping: 'unmapped',
      origin: 'omniflow-integration',
      requiredEvidence: {
        beforeCutover: ['fixture', 'behavior'],
        forCompletion: ['fixture', 'behavior'],
      },
      upstreamSources: [],
    })
    const context = createContext({
      cutoverUnits: [{ id: 'capture', dependencyMapping: 'pending', dependsOn: [] }],
      capabilities: [capability('capture.source'), capability('capture.target')],
    })
    const sourcePath = path.join(context.appRoot, 'runtime.ts')
    writeFileSync(sourcePath, 'export const sourceNode = true\nexport const targetNode = true\n')
    commitCandidateInputs(context)
    context.documents.set('legacy-inventory.json', {
      bootstrapRoots: [],
      semanticScanRules: [],
      historicalTouchsets: [],
      entries: [
        {
          id: 'node.runtime.source',
          entryType: 'current-node',
          path: 'runtime.ts',
          symbol: 'sourceNode',
          sourceHash: hashFile(sourcePath),
          capabilityId: 'capture.source',
          cutoverUnitId: 'capture',
        },
        {
          id: 'node.runtime.target',
          entryType: 'current-node',
          path: 'runtime.ts',
          symbol: 'targetNode',
          sourceHash: hashFile(sourcePath),
          capabilityId: 'capture.target',
          cutoverUnitId: 'capture',
        },
      ],
      historicalCandidates: [],
      approvedExclusions: [],
      declaredDynamicEdges: [{
        id: 'edge.runtime',
        kind: 'runtime-template',
        source: { path: 'runtime.ts', symbol: 'sourceNode' },
        target: { path: 'runtime.ts', symbol: 'targetNode' },
        sourceHash: hashFile(sourcePath),
        fixtureId: 'closure.runtime',
      }],
    })

    const issues = validateCrossFileInvariants(context)
    for (const code of [
      'dynamic-edge-attribution-ambiguous',
      'dynamic-edge-attribution-unresolved',
      'dynamic-edge-fixture-capability-mismatch',
    ]) {
      expect(issues).not.toContainEqual(expect.objectContaining({ code }))
    }
  })

  it('rejects duplicate dynamic edge semantics even when ids differ', () => {
    const context = createContext({
      cutoverUnits: [{ id: 'capture', dependencyMapping: 'pending', dependsOn: [] }],
      capabilities: [],
    })
    const sourcePath = path.join(context.appRoot, 'runtime.ts')
    writeFileSync(sourcePath, 'export const sourceNode = true\nexport const targetNode = true\n')
    commitCandidateInputs(context)
    const edge = {
      kind: 'runtime-template',
      source: { path: 'runtime.ts', symbol: 'sourceNode' },
      target: { path: 'runtime.ts', symbol: 'targetNode' },
      sourceHash: hashFile(sourcePath),
      fixtureId: 'closure.runtime',
    }
    context.documents.set('legacy-inventory.json', {
      bootstrapRoots: [],
      semanticScanRules: [],
      historicalTouchsets: [],
      entries: [],
      historicalCandidates: [],
      approvedExclusions: [],
      declaredDynamicEdges: [
        { ...edge, id: 'edge.runtime.first' },
        { ...edge, id: 'edge.runtime.second' },
      ],
    })

    expect(validateCrossFileInvariants(context)).toContainEqual(expect.objectContaining({
      code: 'duplicate-dynamic-edge',
      severity: 'error',
    }))
  })

  it('rejects non-canonical path aliases before locator deduplication', () => {
    const context = createContext({
      cutoverUnits: [{ id: 'capture', dependencyMapping: 'pending', dependsOn: [] }],
      capabilities: [],
    })
    const sourcePath = path.join(context.appRoot, 'runtime.ts')
    writeFileSync(sourcePath, 'export const sourceNode = true\nexport const targetNode = true\n')
    commitCandidateInputs(context)
    const sourceHash = hashFile(sourcePath)
    const edge = {
      kind: 'runtime-template',
      source: { path: 'runtime.ts', symbol: 'sourceNode' },
      target: { path: 'runtime.ts', symbol: 'targetNode' },
      sourceHash,
      fixtureId: 'closure.runtime',
    }
    context.documents.set('legacy-inventory.json', {
      bootstrapRoots: [],
      semanticScanRules: [],
      historicalTouchsets: [],
      entries: [
        {
          id: 'node.runtime',
          entryType: 'current-node',
          path: 'runtime.ts',
          symbol: 'sourceNode',
          sourceHash,
          capabilityId: null,
          cutoverUnitId: null,
        },
        {
          id: 'node.runtime.alias',
          entryType: 'current-node',
          path: './runtime.ts',
          symbol: 'sourceNode',
          sourceHash,
          capabilityId: null,
          cutoverUnitId: null,
        },
      ],
      historicalCandidates: [],
      approvedExclusions: [],
      declaredDynamicEdges: [
        { ...edge, id: 'edge.runtime' },
        {
          ...edge,
          id: 'edge.runtime.alias',
          source: { path: './runtime.ts', symbol: 'sourceNode' },
        },
      ],
    })

    const issues = validateCrossFileInvariants(context)
    const noncanonicalPaths = issues.filter(issue => issue.code === 'noncanonical-repository-path')
    expect(noncanonicalPaths).toHaveLength(2)
    expect(noncanonicalPaths).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'legacy-inventory.json.entries[1].path' }),
      expect.objectContaining({ path: 'legacy-inventory.json.declaredDynamicEdges[1].source.path' }),
    ]))
  })

  it('binds specified capability audit cursors to the global cursor', () => {
    const context = createContext({
      cutoverUnits: [{ id: 'capture', dependencyMapping: 'specified', dependsOn: [] }],
      capabilities: [{
        id: 'capture.test',
        auditedThrough: 'b'.repeat(40),
        cutoverUnitId: 'capture',
        disposition: 'faithful-port',
        fixtures: [],
        localContractRefs: [],
        mapping: 'specified',
        origin: 'upstream-derived',
        requiredEvidence: {
          beforeCutover: ['fixture', 'behavior'],
          forCompletion: ['fixture', 'behavior'],
        },
        upstreamSources: [],
      }],
    })
    context.documents.set('upstream-state.json', {
      auditedThrough: 'a'.repeat(40),
      baselineCursor: 'a'.repeat(40),
      observedHead: 'a'.repeat(40),
      releaseCursor: null,
      repository: 'https://github.com/xifangczy/cat-catch',
      verificationTarget: null,
    })

    expect(validateCrossFileInvariants(context)).toContainEqual(expect.objectContaining({
      code: 'capability-audit-cursor-mismatch',
      severity: 'error',
    }))
  })
})
