import {
  gitCommitTouchesPath,
  gitObjectExists,
  isGitAncestor,
  readGitFileAtCommit,
} from './git-input.ts'
import { getString, isJsonObject, sha256Bytes } from './json.ts'
import { createIssue, type ValidationIssue } from './types.ts'

export type GitSourceReferenceInput = {
  commit: string | null
  hashField: 'blobHash' | 'sourceHash'
  issuePath: string
  repositoryRoot: string
  requireIntroducedBy?: boolean
  source: unknown
}

export function readGitSourceText(
  repositoryRoot: string,
  commit: string | null,
  source: unknown,
): string | null {
  if (!commit || !isJsonObject(source)) return null
  const relativePath = getString(source.path)
  if (!relativePath) return null
  return readGitFileAtCommit(repositoryRoot, commit, relativePath)?.toString('utf8') ?? null
}

export function validateGitSourceReference(input: GitSourceReferenceInput): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  if (!isJsonObject(input.source)) return issues
  const relativePath = getString(input.source.path)
  if (!relativePath) return issues
  if (!input.commit || !gitObjectExists(input.repositoryRoot, input.commit)) {
    issues.push(createIssue(
      'blocker',
      'source-snapshot-commit-unavailable',
      `Cannot resolve an exact source snapshot commit for ${relativePath}`,
      input.issuePath,
    ))
    return issues
  }

  const sourceBytes = readGitFileAtCommit(input.repositoryRoot, input.commit, relativePath)
  if (!sourceBytes) {
    issues.push(createIssue(
      'error',
      'source-path-missing-at-commit',
      `Source path does not exist at ${input.commit}: ${relativePath}`,
      input.issuePath,
    ))
    return issues
  }

  const expectedHash = getString(input.source[input.hashField])
  if (expectedHash && sha256Bytes(sourceBytes) !== expectedHash) {
    issues.push(createIssue(
      'blocker',
      'source-hash-mismatch',
      `Source hash is stale at ${input.commit}: ${relativePath}`,
      input.issuePath,
    ))
  }
  const anchor = getString(input.source.anchor)
  if (anchor && !sourceBytes.toString('utf8').includes(anchor)) {
    issues.push(createIssue(
      'blocker',
      'source-anchor-missing',
      `Source anchor is missing at ${input.commit}: ${anchor}`,
      input.issuePath,
    ))
  }

  const introducedBy = getString(input.source.introducedBy)
  if (!introducedBy) {
    if (input.requireIntroducedBy) {
      issues.push(createIssue(
        'blocker',
        'source-introduction-unset',
        `Verified upstream source must declare introducedBy: ${relativePath}`,
        input.issuePath,
      ))
    }
    return issues
  }
  if (!gitObjectExists(input.repositoryRoot, introducedBy)) {
    issues.push(createIssue(
      'blocker',
      'source-commit-missing',
      `Source introduction commit is unavailable: ${introducedBy}`,
      input.issuePath,
    ))
    return issues
  }
  if (!isGitAncestor(input.repositoryRoot, introducedBy, input.commit)) {
    issues.push(createIssue(
      'error',
      'source-introduction-after-snapshot',
      `Source introduction commit is not an ancestor of ${input.commit}: ${introducedBy}`,
      input.issuePath,
    ))
  }
  if (!gitCommitTouchesPath(input.repositoryRoot, introducedBy, relativePath)) {
    issues.push(createIssue(
      'blocker',
      'source-introduction-path-unproven',
      `Source introduction commit does not touch ${relativePath}: ${introducedBy}`,
      input.issuePath,
    ))
    return issues
  }
  const introducedBytes = readGitFileAtCommit(input.repositoryRoot, introducedBy, relativePath)
  if (anchor && (!introducedBytes || !introducedBytes.toString('utf8').includes(anchor))) {
    issues.push(createIssue(
      'blocker',
      'source-anchor-not-introduced',
      `Source anchor is absent from its declared introduction commit: ${anchor}`,
      input.issuePath,
    ))
  }
  return issues
}
