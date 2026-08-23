import { fileURLToPath } from 'node:url'
import path from 'node:path'

import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { beforeAll, describe, expect, it } from 'vitest'

import { loadAndValidateContracts } from './schema-registry.ts'

type GateId = 'G0' | 'G1' | 'G2' | 'G3' | 'G4' | 'G5' | 'G6' | 'G7-pre-seal'
type JsonObject = Record<string, unknown>

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const catCatchDirectory = path.join(appRoot, 'docs/cat-catch')
const commit = 'a'.repeat(40)
const sha256 = `sha256:${'a'.repeat(64)}`
const generatedAt = '2026-08-23T00:00:00.000Z'
const nextCheckDueAt = '2026-08-30T00:00:00.000Z'

const evidenceSchemaId = 'https://omniflow.local/schemas/cat-catch/evidence-artifact.schema.json'
const capabilityStateSchemaId = 'https://omniflow.local/schemas/cat-catch/capability-state-report.schema.json'
const localClosureSchemaId = 'https://omniflow.local/schemas/cat-catch/local-closure-report.schema.json'
const artifactAvailabilitySchemaId = 'https://omniflow.local/schemas/cat-catch/artifact-availability-report.schema.json'

const commonCheckIds = [
  'input-integrity',
  'canonical-artifact-resolution',
  'artifact-availability',
  'validator-trust',
  'gate-invariants',
] as const

const gateCheckProfiles: Record<GateId, readonly string[]> = {
  G0: ['g0-fact-baseline', 'g0-dependency-closure', 'g0-release-scope'],
  G1: ['g1-foundation-boundaries', 'g1-transition-history'],
  G2: ['g2-oracle-integrity', 'g2-health-sentinels', 'g2-reproducible-fixtures'],
  G3: ['g3-upstream-coverage', 'g3-capability-evidence', 'g3-approved-exclusions'],
  G4: ['g4-cutover-history', 'g4-single-owner-closure', 'g4-production-smoke'],
  G5: [
    'g5-lifecycle-resource-safety',
    'g5-active-evidence',
    'g5-output-correctness',
    'g5-packaged-target-smoke',
  ],
  G6: ['g6-legacy-closure', 'g6-retired-tombstones', 'g6-rollback-rehearsal'],
  'G7-pre-seal': [
    'g7-release-cursor-coverage',
    'g7-full-validation',
    'g7-release-target-evidence',
    'g7-provenance-and-notices',
    'g7-cross-gate-coherence',
  ],
}

let validateGate: ValidateFunction

function asObject(value: unknown): JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Expected a JSON object')
  }
  return value as JsonObject
}

function artifactReference(
  artifactId: string,
  artifactSchemaId = evidenceSchemaId,
): JsonObject {
  return { artifactId, artifactSchemaId, contentHash: sha256 }
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

function inputHashes(): JsonObject {
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

function gateCheck(checkId: string): JsonObject {
  return {
    checkId,
    result: 'passed',
    preExistingFailure: false,
    evidenceRefs: [artifactReference(`evidence.${checkId}`)],
    details: '',
  }
}

function passedGate(gateId: GateId, checkIds = [...commonCheckIds, ...gateCheckProfiles[gateId]]): JsonObject {
  const artifactAvailabilityRef = artifactReference(
    'report.artifact-availability',
    artifactAvailabilitySchemaId,
  )
  return {
    $schema: 'https://omniflow.local/schemas/cat-catch/gate-report.schema.json',
    schemaVersion: 1,
    reportId: `gate.${gateId.toLowerCase()}`,
    gateId,
    validator: validatorBinding(),
    generatedAt,
    evidenceInputCommit: commit,
    evidenceInputTreeHash: sha256,
    inputHashes: inputHashes(),
    referencedEvidence: [artifactReference('evidence.current-invariant')],
    derivedReportRefs: {
      capabilityState: artifactReference('report.capability-state', capabilityStateSchemaId),
      localClosure: artifactReference('report.local-closure', localClosureSchemaId),
      artifactAvailability: artifactAvailabilityRef,
    },
    transitionHistoryRefs: gateId === 'G0'
      ? [artifactReference('transition.g0-baseline')]
      : [],
    requiredChecks: checkIds.map(gateCheck),
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

function expectValid(value: JsonObject): void {
  expect(validateGate(value), JSON.stringify(validateGate.errors, null, 2)).toBe(true)
}

function expectInvalid(value: JsonObject): void {
  expect(validateGate(value)).toBe(false)
}

beforeAll(() => {
  const { contracts, issues } = loadAndValidateContracts(catCatchDirectory)
  expect(issues).toEqual([])

  const ajv = new Ajv2020({ allErrors: true, strict: true, validateFormats: true })
  addFormats(ajv)
  for (const schema of contracts.schemas.values()) ajv.addSchema(schema)
  const validator = ajv.getSchema('https://omniflow.local/schemas/cat-catch/gate-report.schema.json')
  if (!validator) throw new Error('Gate report schema validator is missing')
  validateGate = validator
})

describe('Cat Catch gate report schema roles', () => {
  it('accepts each minimum gate profile and additional checks', () => {
    for (const gateId of Object.keys(gateCheckProfiles) as GateId[]) {
      expectValid(passedGate(gateId))
      expectValid(passedGate(gateId, [
        ...commonCheckIds,
        ...gateCheckProfiles[gateId],
        `stricter-${gateId.toLowerCase()}`,
      ]))
    }
  })

  it('rejects the wrong schema id in every derived report role', () => {
    const wrongCapabilityState = passedGate('G1')
    asObject(wrongCapabilityState.derivedReportRefs).capabilityState = artifactReference(
      'report.wrong-capability-state',
      localClosureSchemaId,
    )
    expectInvalid(wrongCapabilityState)

    const wrongLocalClosure = passedGate('G1')
    asObject(wrongLocalClosure.derivedReportRefs).localClosure = artifactReference(
      'report.wrong-local-closure',
      capabilityStateSchemaId,
    )
    expectInvalid(wrongLocalClosure)

    const wrongAvailability = passedGate('G1')
    asObject(wrongAvailability.derivedReportRefs).artifactAvailability = artifactReference(
      'report.wrong-availability',
      evidenceSchemaId,
    )
    expectInvalid(wrongAvailability)
  })
})

describe('Cat Catch gate report minimum check profiles', () => {
  it('rejects a G7 pre-seal report with only the five generic checks', () => {
    expectInvalid(passedGate('G7-pre-seal', [...commonCheckIds]))
  })

  it('rejects every passed gate when a gate-specific check is missing', () => {
    for (const gateId of Object.keys(gateCheckProfiles) as GateId[]) {
      for (const missingCheckId of gateCheckProfiles[gateId]) {
        const remainingCheckIds = [
          ...commonCheckIds,
          ...gateCheckProfiles[gateId].filter(checkId => checkId !== missingCheckId),
        ]
        expectInvalid(passedGate(gateId, remainingCheckIds))
      }
    }
  })
})
