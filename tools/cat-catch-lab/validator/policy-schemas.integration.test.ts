import { fileURLToPath } from 'node:url'
import path from 'node:path'

import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { beforeAll, describe, expect, it } from 'vitest'

import { loadAndValidateContracts } from './schema-registry.ts'

type JsonObject = Record<string, unknown>
type ScopeDecision = 'included' | 'undecided' | 'excluded'

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const catCatchDirectory = path.join(appRoot, 'docs/cat-catch')

let validateAutomationPolicy: ValidateFunction
let validateReleaseTargets: ValidateFunction

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

function expectValid(validate: ValidateFunction, value: JsonObject): void {
  expect(validate(value), JSON.stringify(validate.errors, null, 2)).toBe(true)
}

function expectInvalid(validate: ValidateFunction, value: JsonObject): void {
  expect(validate(value)).toBe(false)
}

function releaseTarget(scopeDecision: ScopeDecision): JsonObject {
  const isIncluded = scopeDecision === 'included'
  const isUndecided = scopeDecision === 'undecided'
  return {
    id: `linux-${scopeDecision}`,
    platform: 'linux',
    architectures: ['x64'],
    packageFormats: ['appimage'],
    scopeDecision,
    decisionRef: scopeDecision === 'excluded' ? 'decision://exclude-linux' : null,
    signing: isIncluded
      ? {
          requirement: 'required',
          method: 'gpg-package-signing',
          requiredChecks: ['signature-verify'],
        }
      : {
          requirement: isUndecided ? 'undecided' : 'not-required',
          method: null,
          requiredChecks: [],
        },
    requiredSmokes: isIncluded ? ['packaged-app-launch'] : [],
    sourceRefs: [{ path: 'electron-builder.json5', selector: '$.linux.target' }],
    blockerIds: isUndecided ? ['release.linux-undecided'] : [],
  }
}

function releasePolicy(scopeDecision: ScopeDecision): JsonObject {
  return {
    $schema: './release-targets.schema.json',
    schemaVersion: 1,
    policyVersion: '2026-08-23.1',
    targets: [releaseTarget(scopeDecision)],
    blockers: scopeDecision === 'undecided'
      ? [{
          id: 'release.linux-undecided',
          targetId: 'linux-undecided',
          reason: 'Linux release scope is not decided.',
          resolutionCriteria: 'Include or exclude the Linux target.',
          blocksGates: ['G0'],
        }]
      : [],
  }
}

function targetOf(policy: JsonObject): JsonObject {
  return asObject(asArray(policy.targets)[0])
}

function signingOf(policy: JsonObject): JsonObject {
  return asObject(targetOf(policy).signing)
}

function automationBlocker(): JsonObject {
  return {
    id: 'automation.not-approved',
    reason: 'Runtime automation is not approved.',
    resolutionCriteria: 'Approve the trusted automation policy.',
    blocks: ['automatic-runtime-modification'],
  }
}

function automationPolicy(mode: 'report-only' | 'runtime-changes-enabled'): JsonObject {
  const reportOnly = mode === 'report-only'
  return {
    $schema: './automation-policy.schema.json',
    schemaVersion: 1,
    policyVersion: '2026-08-23.1',
    runtimeModificationMode: mode,
    maxFiles: reportOnly ? 0 : 1,
    maxBehavioralHunks: reportOnly ? 0 : 1,
    maxChangedLines: reportOnly ? 0 : 1,
    maxNewDependencies: 0,
    allowedChromeApis: reportOnly ? [] : ['webRequest'],
    allowedNodeApis: reportOnly ? [] : ['node:fs'],
    protectedPaths: [],
    allowedRuntimePaths: reportOnly ? [] : ['electron/service/embedded-browser/**'],
    requiredChecks: ['schema'],
    blockers: reportOnly ? [automationBlocker()] : [],
  }
}

beforeAll(() => {
  const { contracts, issues } = loadAndValidateContracts(catCatchDirectory)
  expect(issues).toEqual([])

  const ajv = new Ajv2020({ allErrors: true, strict: true, validateFormats: true })
  addFormats(ajv)
  for (const schema of contracts.schemas.values()) ajv.addSchema(schema)

  const automationValidator = ajv.getSchema('https://omniflow.local/schemas/cat-catch/automation-policy.schema.json')
  const releaseTargetsValidator = ajv.getSchema('https://omniflow.local/schemas/cat-catch/release-targets.schema.json')
  if (!automationValidator || !releaseTargetsValidator) {
    throw new Error('Policy schema validator is missing')
  }
  validateAutomationPolicy = automationValidator
  validateReleaseTargets = releaseTargetsValidator
})

describe('Cat Catch release target policy schema', () => {
  it('enforces signing method and check requirements', () => {
    const requiredWithoutMethod = releasePolicy('included')
    signingOf(requiredWithoutMethod).method = null
    expectInvalid(validateReleaseTargets, requiredWithoutMethod)

    const requiredWithoutChecks = releasePolicy('included')
    signingOf(requiredWithoutChecks).requiredChecks = []
    expectInvalid(validateReleaseTargets, requiredWithoutChecks)

    const undecidedWithMethod = releasePolicy('undecided')
    signingOf(undecidedWithMethod).method = 'method-not-yet-approved'
    expectInvalid(validateReleaseTargets, undecidedWithMethod)
  })

  it('enforces the included, undecided, and excluded target matrices', () => {
    for (const scopeDecision of ['included', 'undecided', 'excluded'] as const) {
      expectValid(validateReleaseTargets, releasePolicy(scopeDecision))
    }

    const includedWithUndecidedSigning = releasePolicy('included')
    includedWithUndecidedSigning.targets = [{
      ...targetOf(includedWithUndecidedSigning),
      signing: { requirement: 'undecided', method: null, requiredChecks: [] },
    }]
    expectInvalid(validateReleaseTargets, includedWithUndecidedSigning)

    const includedWithoutSmokes = releasePolicy('included')
    targetOf(includedWithoutSmokes).requiredSmokes = []
    expectInvalid(validateReleaseTargets, includedWithoutSmokes)

    const includedWithBlocker = releasePolicy('included')
    targetOf(includedWithBlocker).blockerIds = ['release.unexpected']
    expectInvalid(validateReleaseTargets, includedWithBlocker)

    const undecidedWithRequiredSigning = releasePolicy('undecided')
    targetOf(undecidedWithRequiredSigning).signing = {
      requirement: 'required',
      method: 'gpg-package-signing',
      requiredChecks: ['signature-verify'],
    }
    expectInvalid(validateReleaseTargets, undecidedWithRequiredSigning)

    const undecidedWithoutBlocker = releasePolicy('undecided')
    targetOf(undecidedWithoutBlocker).blockerIds = []
    expectInvalid(validateReleaseTargets, undecidedWithoutBlocker)

    const excludedWithoutDecision = releasePolicy('excluded')
    targetOf(excludedWithoutDecision).decisionRef = null
    expectInvalid(validateReleaseTargets, excludedWithoutDecision)

    const excludedWithBlocker = releasePolicy('excluded')
    targetOf(excludedWithBlocker).blockerIds = ['release.unexpected']
    expectInvalid(validateReleaseTargets, excludedWithBlocker)

    const excludedWithSmoke = releasePolicy('excluded')
    targetOf(excludedWithSmoke).requiredSmokes = ['packaged-app-launch']
    expectInvalid(validateReleaseTargets, excludedWithSmoke)
  })
})

describe('Cat Catch automation policy schema', () => {
  it('makes report-only limits and API allowlists inert', () => {
    expectValid(validateAutomationPolicy, automationPolicy('report-only'))

    for (const threshold of [
      'maxFiles',
      'maxBehavioralHunks',
      'maxChangedLines',
      'maxNewDependencies',
    ]) {
      const policy = automationPolicy('report-only')
      policy[threshold] = 1
      expectInvalid(validateAutomationPolicy, policy)
    }

    const chromeApiAllowed = automationPolicy('report-only')
    chromeApiAllowed.allowedChromeApis = ['webRequest']
    expectInvalid(validateAutomationPolicy, chromeApiAllowed)

    const nodeApiAllowed = automationPolicy('report-only')
    nodeApiAllowed.allowedNodeApis = ['node:fs']
    expectInvalid(validateAutomationPolicy, nodeApiAllowed)
  })

  it('preserves positive runtime limits and requires an empty blocker set', () => {
    expectValid(validateAutomationPolicy, automationPolicy('runtime-changes-enabled'))

    for (const threshold of ['maxFiles', 'maxBehavioralHunks', 'maxChangedLines']) {
      const policy = automationPolicy('runtime-changes-enabled')
      policy[threshold] = 0
      expectInvalid(validateAutomationPolicy, policy)
    }

    const blockedPolicy = automationPolicy('runtime-changes-enabled')
    blockedPolicy.blockers = [automationBlocker()]
    expectInvalid(validateAutomationPolicy, blockedPolicy)
  })
})
