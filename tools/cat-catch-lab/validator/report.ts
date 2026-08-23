import path from 'node:path'

import {
  hashGitCommitInputs,
  hashTrackedWorktreeInputs,
  hashValidatorSourceManifest,
  hashValidatorToolchainFingerprint,
  listDirtyTrackedPaths,
  listUntrackedPaths,
  tryReadGitHead,
} from './git-input.ts'
import { createIssue, type CandidatePreflightReport, type LoadedContracts, type ValidationIssue } from './types.ts'

export function getCandidatePreflightExitCode(report: CandidatePreflightReport): 0 | 1 {
  return report.structuralStatus === 'failed' || report.g0Status === 'blocked' ? 1 : 0
}

export function createCandidatePreflightReport(input: {
  appRoot: string
  upstreamRoot: string
  contracts: LoadedContracts
  issues: ValidationIssue[]
}): CandidatePreflightReport {
  const dirtyTrackedPaths = listDirtyTrackedPaths(input.appRoot)
  const untrackedInputPaths = listUntrackedPaths(input.appRoot).filter(relativePath => (
    relativePath !== 'docs/cat-catch/report-index'
    && !relativePath.startsWith('docs/cat-catch/report-index/')
  ))
  const appHead = tryReadGitHead(input.appRoot)
  const issues = [...input.issues]
  issues.push(createIssue(
    'blocker',
    'candidate-worktree-non-promotable',
    'Worktree validation is candidate-only; formal evidence must read an exact Git commit object',
  ))
  if (dirtyTrackedPaths.length > 0) {
    issues.push(createIssue(
      'blocker',
      'dirty-tracked-worktree',
      `${dirtyTrackedPaths.length} tracked paths differ from HEAD`,
      path.relative(input.appRoot, input.appRoot) || '.',
    ))
  }
  if (untrackedInputPaths.length > 0) {
    issues.push(createIssue(
      'blocker',
      'untracked-candidate-inputs',
      `${untrackedInputPaths.length} untracked paths contribute to the candidate input tree`,
      '.',
    ))
  }

  const errors = issues.filter(issue => issue.severity === 'error')
  const blockers = issues.filter(issue => issue.severity === 'blocker')
  const warnings = issues.filter(issue => issue.severity === 'warning')
  return {
    schemaVersion: 1,
    reportType: 'g0-candidate-preflight',
    promotable: false,
    generatedAt: new Date().toISOString(),
    validatorSourceManifestHash: hashValidatorSourceManifest(input.appRoot),
    validatorToolchainFingerprintHash: hashValidatorToolchainFingerprint(input.appRoot),
    workspace: {
      appHead,
      appCommitInputTreeHash: appHead ? hashGitCommitInputs(input.appRoot, appHead) : null,
      dirtyTrackedPaths,
      untrackedInputPaths,
      upstreamHead: tryReadGitHead(input.upstreamRoot),
      worktreeInputHash: hashTrackedWorktreeInputs(input.appRoot),
    },
    inputHashes: input.contracts.inputHashes,
    structuralStatus: errors.length === 0 ? 'passed' : 'failed',
    g0Status: errors.length > 0 || blockers.length > 0 ? 'blocked' : 'in-progress',
    errors,
    blockers,
    warnings,
  }
}
