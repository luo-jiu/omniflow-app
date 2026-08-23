import {
  getGitAncestryState,
  gitObjectExists,
  readGitCommitParents,
  readGitFileAtCommit,
  readGitPathAtCommit,
} from './git-input.ts'
import { getString, isJsonObject, sha256Bytes } from './json.ts'
import {
  inspectSourceLocator,
  normalizeSourceLocatorKind,
  type SourceLocatorKind,
  type SourceLocatorMatchResult,
} from './source-locator.ts'
import { createIssue, type ValidationIssue } from './types.ts'

export type GitSourceReferenceInput = {
  anchorField?: 'anchor' | 'symbol'
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

  const sourceState = readGitPathAtCommit(input.repositoryRoot, input.commit, relativePath)
  if (sourceState.status === 'absent') {
    issues.push(createIssue(
      'error',
      'source-path-missing-at-commit',
      `Source path does not exist at ${input.commit}: ${relativePath}`,
      input.issuePath,
    ))
    return issues
  }
  if (sourceState.status === 'unavailable') {
    issues.push(createIssue(
      'blocker',
      'source-path-unavailable-at-commit',
      `Source path cannot be read at ${input.commit}: ${relativePath}`,
      input.issuePath,
    ))
    return issues
  }
  const sourceBytes = sourceState.bytes

  const expectedHash = getString(input.source[input.hashField])
  if (expectedHash && sha256Bytes(sourceBytes) !== expectedHash) {
    issues.push(createIssue(
      'blocker',
      'source-hash-mismatch',
      `Source hash is stale at ${input.commit}: ${relativePath}`,
      input.issuePath,
    ))
  }
  const anchorField = input.anchorField ?? 'anchor'
  const anchor = getString(input.source[anchorField])
  const rawLocatorKind = input.source.locatorKind
  const locatorKind = anchorField === 'symbol' ? normalizeSourceLocatorKind(rawLocatorKind) : null
  if (anchorField === 'symbol' && locatorKind === null) {
    issues.push(createIssue(
      'error',
      'source-locator-kind-invalid',
      `Source locator kind is invalid: ${String(rawLocatorKind)}`,
      input.issuePath,
    ))
  } else if (!anchor && rawLocatorKind !== undefined) {
    issues.push(createIssue(
      'error',
      'source-locator-kind-without-symbol',
      'Source locator kind requires a non-null symbol',
      input.issuePath,
    ))
  } else if (anchor) {
    issues.push(...validateLocatorAtSnapshot({
      anchor,
      anchorField,
      issuePath: input.issuePath,
      locatorKind,
      relativePath,
      snapshot: input.commit,
      sourceText: sourceBytes.toString('utf8'),
    }))
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
  const ancestryState = getGitAncestryState(input.repositoryRoot, introducedBy, input.commit)
  if (ancestryState === 'unavailable') {
    issues.push(createIssue(
      'blocker',
      'source-introduction-ancestry-unavailable',
      `Cannot prove source introduction ancestry at ${input.commit}: ${introducedBy}`,
      input.issuePath,
    ))
  } else if (ancestryState === 'not-ancestor') {
    issues.push(createIssue(
      'error',
      'source-introduction-after-snapshot',
      `Source introduction commit is not an ancestor of ${input.commit}: ${introducedBy}`,
      input.issuePath,
    ))
  }
  const introducedState = readGitPathAtCommit(input.repositoryRoot, introducedBy, relativePath)
  if (introducedState.status === 'absent') {
    issues.push(createIssue(
      'blocker',
      'source-introduction-path-missing',
      `Source path is absent from its declared introduction commit: ${relativePath}`,
      input.issuePath,
    ))
    return issues
  }
  if (introducedState.status === 'unavailable') {
    issues.push(createIssue(
      'blocker',
      'source-introduction-source-unavailable',
      `Source path cannot be read from its declared introduction commit: ${relativePath}`,
      input.issuePath,
    ))
    return issues
  }
  if (anchor) {
    issues.push(...validateLocatorAtIntroduction({
      anchor,
      anchorField,
      issuePath: input.issuePath,
      locatorKind,
      relativePath,
      sourceText: introducedState.bytes.toString('utf8'),
    }))
  }

  const parents = readGitCommitParents(input.repositoryRoot, introducedBy)
  if (!parents) {
    issues.push(createIssue(
      'blocker',
      'source-introduction-parents-unavailable',
      `Cannot read direct parents for source introduction commit: ${introducedBy}`,
      input.issuePath,
    ))
    return issues
  }
  for (const parent of parents) {
    if (!gitObjectExists(input.repositoryRoot, parent)) {
      issues.push(createIssue(
        'blocker',
        'source-introduction-parent-unavailable',
        `Source introduction parent commit is unavailable: ${parent}`,
        input.issuePath,
      ))
      continue
    }
    const parentState = readGitPathAtCommit(input.repositoryRoot, parent, relativePath)
    if (parentState.status === 'absent' || !anchor) continue
    if (parentState.status === 'unavailable') {
      issues.push(createIssue(
        'blocker',
        'source-introduction-parent-source-unavailable',
        `Cannot prove parent source absence at ${parent}: ${relativePath}`,
        input.issuePath,
      ))
      continue
    }
    const preexisting = inspectLocatorPresence({
      anchor,
      anchorField,
      locatorKind,
      relativePath,
      sourceText: parentState.bytes.toString('utf8'),
    })
    if (preexisting === null) {
      issues.push(createIssue(
        'blocker',
        'source-introduction-parent-source-unavailable',
        `Cannot parse parent source at ${parent}: ${relativePath}`,
        input.issuePath,
      ))
    } else if (preexisting) {
      issues.push(createIssue(
        'blocker',
        anchorField === 'symbol' ? 'source-symbol-preexisting-in-parent' : 'source-anchor-preexisting-in-parent',
        `Source ${anchorField} already exists in direct parent ${parent}: ${anchor}`,
        input.issuePath,
      ))
    }
  }
  return issues
}

type LocatorInspectionInput = {
  anchor: string
  anchorField: 'anchor' | 'symbol'
  locatorKind: SourceLocatorKind | null
  relativePath: string
  sourceText: string
}

function inspectLocator(input: LocatorInspectionInput): SourceLocatorMatchResult | null {
  if (input.anchorField === 'anchor') {
    const matchCount = input.sourceText.includes(input.anchor) ? 1 : 0
    return { matchCount, status: matchCount ? 'matched' : 'missing' }
  }
  if (!input.locatorKind) return null
  return inspectSourceLocator(input.sourceText, input.relativePath, input.anchor, input.locatorKind)
}

function inspectLocatorPresence(input: LocatorInspectionInput): boolean | null {
  const result = inspectLocator(input)
  if (!result || result.status === 'parse-error' || result.status === 'unsupported-language') return null
  return result.status === 'matched' || result.status === 'ambiguous'
}

function validateLocatorAtSnapshot(
  input: LocatorInspectionInput & { issuePath: string; snapshot: string },
): ValidationIssue[] {
  const result = inspectLocator(input)
  if (!result || result.status === 'parse-error' || result.status === 'unsupported-language') {
    return [createIssue(
      'blocker',
      'source-locator-unverifiable',
      `Source ${input.anchorField} cannot be parsed at ${input.snapshot}: ${input.anchor}`,
      input.issuePath,
    )]
  }
  if (result.status === 'ambiguous') {
    return [createIssue(
      'blocker',
      'source-locator-ambiguous',
      `Source ${input.anchorField} has ${result.matchCount} logical matches at ${input.snapshot}: ${input.anchor}`,
      input.issuePath,
    )]
  }
  if (result.status === 'missing') {
    return [createIssue(
      'blocker',
      input.anchorField === 'symbol' ? 'source-symbol-missing' : 'source-anchor-missing',
      `Source ${input.anchorField} is missing at ${input.snapshot}: ${input.anchor}`,
      input.issuePath,
    )]
  }
  return []
}

function validateLocatorAtIntroduction(
  input: LocatorInspectionInput & { issuePath: string },
): ValidationIssue[] {
  const result = inspectLocator(input)
  if (!result || result.status === 'parse-error' || result.status === 'unsupported-language') {
    return [createIssue(
      'blocker',
      'source-introduction-locator-unverifiable',
      `Source ${input.anchorField} cannot be parsed at its declared introduction commit: ${input.anchor}`,
      input.issuePath,
    )]
  }
  if (result.status === 'ambiguous') {
    return [createIssue(
      'blocker',
      'source-introduction-locator-ambiguous',
      `Source ${input.anchorField} has ${result.matchCount} logical matches at its declared introduction commit: ${input.anchor}`,
      input.issuePath,
    )]
  }
  if (result.status === 'missing') {
    return [createIssue(
      'blocker',
      input.anchorField === 'symbol' ? 'source-symbol-not-introduced' : 'source-anchor-not-introduced',
      `Source ${input.anchorField} is absent from its declared introduction commit: ${input.anchor}`,
      input.issuePath,
    )]
  }
  return []
}
