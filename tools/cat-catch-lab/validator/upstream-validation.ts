import {
  gitObjectExists,
  isGitAncestor,
  tryReadGitRemoteUrl,
  tryResolveGitCommit,
} from './git-input.ts'
import { getString } from './json.ts'
import { createIssue, type ValidationContext, type ValidationIssue } from './types.ts'

const UPSTREAM_TRACKING_REF = 'refs/remotes/origin/master'

export function canonicalizeGitRepositoryUrl(repositoryUrl: string): string | null {
  const trimmed = repositoryUrl.trim()
  const scpLike = /^git@([^:]+):(.+)$/.exec(trimmed)
  if (scpLike) {
    return `${scpLike[1]?.toLowerCase()}/${scpLike[2]?.replace(/\.git$/, '').replace(/^\/+|\/+$/g, '')}`
  }
  try {
    const url = new URL(trimmed)
    const repositoryPath = url.pathname.replace(/\.git$/, '').replace(/^\/+|\/+$/g, '')
    return repositoryPath ? `${url.hostname.toLowerCase()}/${repositoryPath}` : null
  } catch {
    return null
  }
}

function validateCursorRange(
  context: ValidationContext,
  issues: ValidationIssue[],
  cursorName: string,
  cursor: string | null,
  baselineCursor: string | null,
  observedHead: string | null,
): boolean {
  if (!cursor) return false
  if (!gitObjectExists(context.upstreamRoot, cursor)) {
    issues.push(createIssue(
      'error',
      `${cursorName}-commit-missing`,
      `${cursorName} commit is unavailable: ${cursor}`,
      `upstream-state.json.${cursorName}`,
    ))
    return false
  }
  if (baselineCursor && !isGitAncestor(context.upstreamRoot, baselineCursor, cursor)) {
    issues.push(createIssue(
      'error',
      `${cursorName}-before-baseline`,
      `${cursorName} must include baselineCursor`,
      `upstream-state.json.${cursorName}`,
    ))
  }
  if (observedHead && !isGitAncestor(context.upstreamRoot, cursor, observedHead)) {
    issues.push(createIssue(
      'error',
      `${cursorName}-after-observed-head`,
      `${cursorName} must be an ancestor of observedHead`,
      `upstream-state.json.${cursorName}`,
    ))
  }
  return true
}

export function validateUpstreamState(context: ValidationContext): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const state = context.documents.get('upstream-state.json')
  if (!state) return issues

  const repository = getString(state.repository)
  const remoteUrl = tryReadGitRemoteUrl(context.upstreamRoot)
  if (!remoteUrl) {
    issues.push(createIssue(
      'blocker',
      'upstream-origin-missing',
      'The pinned upstream repository has no readable origin URL',
      'upstream-state.json.repository',
    ))
  } else if (
    repository
    && canonicalizeGitRepositoryUrl(repository) !== canonicalizeGitRepositoryUrl(remoteUrl)
  ) {
    issues.push(createIssue(
      'error',
      'upstream-origin-mismatch',
      `Declared upstream ${repository} does not match origin ${remoteUrl}`,
      'upstream-state.json.repository',
    ))
  }

  const baselineCursor = getString(state.baselineCursor)
  const observedHead = getString(state.observedHead)
  const auditedThrough = getString(state.auditedThrough)
  const verificationTarget = getString(state.verificationTarget)
  const releaseCursor = getString(state.releaseCursor)

  validateCursorRange(context, issues, 'baselineCursor', baselineCursor, null, observedHead)
  validateCursorRange(context, issues, 'observedHead', observedHead, baselineCursor, null)

  const remoteTrackingHead = tryResolveGitCommit(context.upstreamRoot, UPSTREAM_TRACKING_REF)
  if (!remoteTrackingHead) {
    issues.push(createIssue(
      'blocker',
      'upstream-tracking-ref-missing',
      `Cannot resolve ${UPSTREAM_TRACKING_REF}; fetch origin before validating observedHead`,
      'upstream-state.json.observedHead',
    ))
  } else if (observedHead && remoteTrackingHead !== observedHead) {
    issues.push(createIssue(
      'blocker',
      'observed-head-stale',
      `Observed head ${observedHead} does not match ${UPSTREAM_TRACKING_REF} ${remoteTrackingHead}`,
      'upstream-state.json.observedHead',
    ))
  }

  if (!auditedThrough) {
    issues.push(createIssue(
      'blocker',
      'audit-cursor-unset',
      'auditedThrough cannot advance until initial dependency closure is classified',
      'upstream-state.json.auditedThrough',
    ))
  } else {
    validateCursorRange(context, issues, 'auditedThrough', auditedThrough, baselineCursor, observedHead)
  }

  if (verificationTarget) {
    validateCursorRange(context, issues, 'verificationTarget', verificationTarget, baselineCursor, observedHead)
    if (!auditedThrough || !isGitAncestor(context.upstreamRoot, verificationTarget, auditedThrough)) {
      issues.push(createIssue(
        'error',
        'verification-target-not-audited',
        'verificationTarget must be covered by auditedThrough',
        'upstream-state.json.verificationTarget',
      ))
    }
  }

  if (releaseCursor) {
    validateCursorRange(context, issues, 'releaseCursor', releaseCursor, baselineCursor, observedHead)
    if (!auditedThrough || !isGitAncestor(context.upstreamRoot, releaseCursor, auditedThrough)) {
      issues.push(createIssue(
        'error',
        'release-cursor-not-audited',
        'releaseCursor must be covered by auditedThrough',
        'upstream-state.json.releaseCursor',
      ))
    }
    if (!verificationTarget || !isGitAncestor(context.upstreamRoot, releaseCursor, verificationTarget)) {
      issues.push(createIssue(
        'error',
        'release-cursor-not-verification-target',
        'releaseCursor must be covered by verificationTarget',
        'upstream-state.json.releaseCursor',
      ))
    }
  }

  return issues
}
