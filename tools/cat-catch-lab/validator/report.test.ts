import { describe, expect, it } from 'vitest'

import { getCandidatePreflightExitCode } from './report.ts'
import type { CandidatePreflightReport } from './types.ts'

function createReport(
  structuralStatus: CandidatePreflightReport['structuralStatus'],
  g0Status: CandidatePreflightReport['g0Status'],
): CandidatePreflightReport {
  return {
    schemaVersion: 1,
    reportType: 'g0-candidate-preflight',
    promotable: false,
    generatedAt: '2026-08-23T00:00:00.000Z',
    validatorSourceManifestHash: `sha256:${'0'.repeat(64)}`,
    validatorToolchainFingerprintHash: `sha256:${'0'.repeat(64)}`,
    workspace: {
      appHead: null,
      appCommitInputTreeHash: null,
      dirtyTrackedPaths: [],
      untrackedInputPaths: [],
      upstreamHead: null,
      worktreeInputHash: `sha256:${'0'.repeat(64)}`,
    },
    inputHashes: {},
    structuralStatus,
    g0Status,
    errors: [],
    blockers: [],
    warnings: [],
  }
}

describe('Cat Catch candidate preflight exit status', () => {
  it('fails the command while G0 remains blocked', () => {
    expect(getCandidatePreflightExitCode(createReport('passed', 'blocked'))).toBe(1)
  })

  it('allows a structurally valid and unblocked preflight', () => {
    expect(getCandidatePreflightExitCode(createReport('passed', 'in-progress'))).toBe(0)
  })
})
