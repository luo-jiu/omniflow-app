import { fileURLToPath } from 'node:url'
import path from 'node:path'

import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { beforeAll, describe, expect, it } from 'vitest'

import { loadAndValidateContracts } from './schema-registry.ts'

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const catCatchDirectory = path.join(appRoot, 'docs/cat-catch')
const commit = 'a'.repeat(40)
const sha256 = `sha256:${'a'.repeat(64)}`
const generatedAt = '2026-08-23T00:00:00.000Z'
const nextCheckDueAt = '2026-08-30T00:00:00.000Z'
const evidenceSchemaId = 'https://omniflow.local/schemas/cat-catch/evidence-artifact.schema.json'

let validateAvailability: ValidateFunction
let validateCapabilityState: ValidateFunction
let validateEvidence: ValidateFunction
let validateGate: ValidateFunction

function requireValidator(ajv: Ajv2020, schemaId: string): ValidateFunction {
  const validate = ajv.getSchema(schemaId)
  if (!validate) throw new Error(`Schema validator is missing: ${schemaId}`)
  return validate
}

function validatorBinding(): Record<string, unknown> {
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

function artifactReference(
  id = 'evidence.behavior',
  artifactSchemaId = evidenceSchemaId,
): Record<string, unknown> {
  return {
    artifactId: id,
    artifactSchemaId,
    contentHash: sha256,
  }
}

function commandResult(status: 'passed' | 'failed' = 'passed', exitCode = 0): Record<string, unknown> {
  return {
    checkId: 'unit-test',
    commandFingerprint: sha256,
    exitCode,
    status,
    startedAt: generatedAt,
    finishedAt: generatedAt,
    stdoutHash: null,
    stderrHash: null,
  }
}

function passedEvidence(): Record<string, unknown> {
  return {
    $schema: 'https://omniflow.local/schemas/cat-catch/evidence-artifact.schema.json',
    schemaVersion: 1,
    artifactId: 'evidence.behavior',
    artifactType: 'unit',
    evidenceRole: 'current-invariant',
    evidenceDimension: 'behavior',
    deploymentUnderTest: 'candidate',
    capabilityIds: ['capture.test'],
    releaseTargetId: null,
    evidenceInputCommit: commit,
    evidenceInputTreeHash: sha256,
    upstreamSnapshot: { commit, manifestHash: sha256 },
    environmentFingerprint: {
      os: 'macos-15',
      arch: 'arm64',
      electron: '30.0.1',
      chromium: '124.0.0',
      node: '20.0.0',
      ffmpeg: null,
    },
    producer: {
      runnerId: 'trusted-runner',
      runnerClassification: 'trusted-runner',
      toolId: 'cat-catch-lab',
      toolVersion: '1.0.0',
      toolSourceManifestHash: sha256,
      trustPolicyHash: sha256,
      attestationRef: 'attestation://trusted-runner/run-1',
    },
    inputHash: sha256,
    commandResults: [commandResult()],
    status: 'passed',
    startedAt: generatedAt,
    finishedAt: generatedAt,
    attachments: [],
  }
}

function inputHashes(): Record<string, unknown> {
  return {
    schemaBundle: sha256,
    upstreamState: sha256,
    capabilityLedger: sha256,
    legacyInventory: sha256,
    releaseTargets: sha256,
    riskPolicy: sha256,
    automationPolicy: sha256,
    evidenceRetentionPolicy: sha256,
    validatorTrustPolicy: sha256,
  }
}

function capabilityState(): Record<string, unknown> {
  const evidenceRef = artifactReference()
  return {
    id: 'capture.test',
    origin: 'upstream-derived',
    effectiveRiskTags: ['production-runtime'],
    verifiedThrough: commit,
    evidence: {
      mapping: 'specified',
      fixture: 'ready',
      behavior: 'pass',
      candidateIntegration: 'pass',
      candidateSoak: 'not-required',
      activeIntegration: 'pending',
      activeSoak: 'not-required',
    },
    effectiveRequiredEvidence: {
      beforeCutover: ['fixture', 'behavior', 'candidateIntegration'],
      forCompletion: ['fixture', 'behavior', 'candidateIntegration', 'activeIntegration'],
    },
    deployment: 'candidate',
    freshness: 'current',
    resolvedOwners: { production: [], candidate: [], legacy: [] },
    artifactRefs: {
      mapping: [evidenceRef],
      fixture: [evidenceRef],
      behavior: [evidenceRef],
      candidateIntegration: [evidenceRef],
      candidateSoak: [],
      activeIntegration: [],
      activeSoak: [],
    },
    summaryState: 'verified-candidate',
    blockers: [],
  }
}

function passedCapabilityState(): Record<string, unknown> {
  return {
    $schema: 'https://omniflow.local/schemas/cat-catch/capability-state-report.schema.json',
    schemaVersion: 1,
    reportId: 'capability-state.test',
    validator: validatorBinding(),
    generatedAt,
    evidenceInputCommit: commit,
    evidenceInputTreeHash: sha256,
    inputHashes: inputHashes(),
    upstreamSnapshot: { commit, manifestHash: sha256 },
    capabilities: [capabilityState()],
    summary: {
      total: 1,
      included: 1,
      intentionalExclusions: 0,
      pending: 0,
      unmapped: 0,
      stale: 0,
      implementedUnverified: 0,
    },
    referencedArtifacts: [artifactReference()],
    status: 'passed',
    blockers: [],
  }
}

function storageCheck(allChecksPass = true): Record<string, unknown> {
  return {
    storeId: 'canonical-store',
    uri: 'https://evidence.invalid/evidence.behavior.json',
    readable: allChecksPass,
    schemaValid: allChecksPass,
    hashMatches: allChecksPass,
    retentionCovered: allChecksPass,
    expiresAt: null,
    message: '',
  }
}

function artifactCheck(allChecksPass = true): Record<string, unknown> {
  return {
    artifactId: 'evidence.behavior',
    expectedHash: sha256,
    artifactSchemaId: 'https://omniflow.local/schemas/cat-catch/evidence-artifact.schema.json',
    storageChecks: [storageCheck(allChecksPass)],
    result: 'current',
  }
}

function passedAvailability(): Record<string, unknown> {
  return {
    $schema: 'https://omniflow.local/schemas/cat-catch/artifact-availability-report.schema.json',
    schemaVersion: 1,
    reportId: 'availability.test',
    validator: validatorBinding(),
    evidenceInputCommit: commit,
    evidenceInputTreeHash: sha256,
    retentionPolicyHash: sha256,
    projectionHashProfile: 'report-index-covered-projection-jcs-v1',
    coveredIndexProjectionHash: sha256,
    checkedAt: generatedAt,
    nextCheckDueAt,
    supportedReleases: [{
      releaseRef: 'refs/tags/v0.2.2',
      releaseState: 'supported',
      maintenanceEndsAt: nextCheckDueAt,
      rollbackWindowEndsAt: nextCheckDueAt,
    }],
    artifactChecks: [artifactCheck()],
    staleArtifactIds: [],
    status: 'passed',
    blockers: [],
  }
}

function gateCheck(checkId: string): Record<string, unknown> {
  return {
    checkId,
    result: 'passed',
    preExistingFailure: false,
    evidenceRefs: [artifactReference()],
    details: '',
  }
}

function passedGate(): Record<string, unknown> {
  const capabilityStateRef = artifactReference(
    'report.capability-state',
    'https://omniflow.local/schemas/cat-catch/capability-state-report.schema.json',
  )
  const localClosureRef = artifactReference(
    'report.local-closure',
    'https://omniflow.local/schemas/cat-catch/local-closure-report.schema.json',
  )
  const artifactAvailabilityRef = artifactReference(
    'report.artifact-availability',
    'https://omniflow.local/schemas/cat-catch/artifact-availability-report.schema.json',
  )
  return {
    $schema: 'https://omniflow.local/schemas/cat-catch/gate-report.schema.json',
    schemaVersion: 1,
    reportId: 'gate.g0.test',
    gateId: 'G0',
    validator: validatorBinding(),
    generatedAt,
    evidenceInputCommit: commit,
    evidenceInputTreeHash: sha256,
    inputHashes: inputHashes(),
    referencedEvidence: [artifactReference()],
    derivedReportRefs: {
      capabilityState: capabilityStateRef,
      localClosure: localClosureRef,
      artifactAvailability: artifactAvailabilityRef,
    },
    transitionHistoryRefs: [artifactReference('transition.g0-baseline')],
    requiredChecks: [
      'input-integrity',
      'canonical-artifact-resolution',
      'artifact-availability',
      'validator-trust',
      'gate-invariants',
      'g0-fact-baseline',
      'g0-dependency-closure',
      'g0-release-scope',
    ].map(gateCheck),
    sourceToolchainFingerprints: [{ id: 'node', version: '20.0.0', sourceHash: sha256 }],
    availabilityCheck: {
      policyHash: sha256,
      reportRef: artifactAvailabilityRef,
      checkedAt: generatedAt,
      nextCheckDueAt,
      status: 'current',
    },
    status: 'passed',
    failures: [],
    blockers: [],
  }
}

function expectValid(validate: ValidateFunction, value: Record<string, unknown>): void {
  expect(validate(value), JSON.stringify(validate.errors, null, 2)).toBe(true)
}

function expectInvalid(validate: ValidateFunction, value: Record<string, unknown>): void {
  expect(validate(value)).toBe(false)
}

beforeAll(() => {
  const { contracts, issues } = loadAndValidateContracts(catCatchDirectory)
  expect(issues).toEqual([])
  const ajv = new Ajv2020({ allErrors: true, strict: true, validateFormats: true })
  addFormats(ajv)
  for (const schema of contracts.schemas.values()) ajv.addSchema(schema)
  validateAvailability = requireValidator(ajv, 'https://omniflow.local/schemas/cat-catch/artifact-availability-report.schema.json')
  validateCapabilityState = requireValidator(ajv, 'https://omniflow.local/schemas/cat-catch/capability-state-report.schema.json')
  validateEvidence = requireValidator(ajv, 'https://omniflow.local/schemas/cat-catch/evidence-artifact.schema.json')
  validateGate = requireValidator(ajv, 'https://omniflow.local/schemas/cat-catch/gate-report.schema.json')
})

describe('Cat Catch passed report invariants', () => {
  it('rejects passed evidence with a failed command or non-zero exit', () => {
    expectValid(validateEvidence, passedEvidence())

    const failedCommand = passedEvidence()
    failedCommand.commandResults = [commandResult('failed', 1)]
    expectInvalid(validateEvidence, failedCommand)

    const nonZeroCommand = passedEvidence()
    nonZeroCommand.commandResults = [commandResult('passed', 1)]
    expectInvalid(validateEvidence, nonZeroCommand)
  })

  it('rejects empty or all-zero passed capability-state reports', () => {
    expectValid(validateCapabilityState, passedCapabilityState())

    const blockedReport = passedCapabilityState()
    blockedReport.capabilities = []
    blockedReport.summary = {
      total: 0,
      included: 0,
      intentionalExclusions: 0,
      pending: 0,
      unmapped: 0,
      stale: 0,
      implementedUnverified: 0,
    }
    blockedReport.status = 'blocked'
    blockedReport.blockers = [{
      code: 'ledger-load-failed',
      message: 'The ledger could not be loaded.',
      capabilityId: null,
    }]
    expectValid(validateCapabilityState, blockedReport)

    const emptyReport = passedCapabilityState()
    emptyReport.capabilities = []
    emptyReport.summary = {
      total: 0,
      included: 0,
      intentionalExclusions: 0,
      pending: 0,
      unmapped: 0,
      stale: 0,
      implementedUnverified: 0,
    }
    expectInvalid(validateCapabilityState, emptyReport)

    const zeroSummary = passedCapabilityState()
    zeroSummary.summary = emptyReport.summary
    expectInvalid(validateCapabilityState, zeroSummary)
  })

  it('rejects vacuous availability and false storage checks reported as current', () => {
    expectValid(validateAvailability, passedAvailability())

    const noReleases = passedAvailability()
    noReleases.supportedReleases = []
    expectInvalid(validateAvailability, noReleases)

    const noArtifacts = passedAvailability()
    noArtifacts.artifactChecks = []
    expectInvalid(validateAvailability, noArtifacts)

    const unavailableArtifact = passedAvailability()
    unavailableArtifact.artifactChecks = [artifactCheck(false)]
    expectInvalid(validateAvailability, unavailableArtifact)
  })

  it('rejects the obsolete whole-index availability hash field', () => {
    const availability = passedAvailability()
    delete availability.coveredIndexProjectionHash
    availability.reportIndexHash = sha256
    expectInvalid(validateAvailability, availability)
  })

  it('rejects unknown availability projection hash profiles', () => {
    const availability = passedAvailability()
    availability.projectionHashProfile = 'report-index-covered-projection-jcs-v2'
    expectInvalid(validateAvailability, availability)
  })

  it('rejects arbitrary single-check gates and null availability bindings', () => {
    expectValid(validateGate, passedGate())

    const arbitraryCheck = passedGate()
    arbitraryCheck.requiredChecks = [gateCheck('looks-good')]
    expectInvalid(validateGate, arbitraryCheck)

    const missingAvailability = passedGate()
    missingAvailability.availabilityCheck = {
      policyHash: sha256,
      reportRef: null,
      checkedAt: null,
      nextCheckDueAt: null,
      status: 'current',
    }
    expectInvalid(validateGate, missingAvailability)
  })
})
