import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import type { JsonObject, ValidationContext } from './types.ts'
import { canonicalizeGitRepositoryUrl, validateUpstreamState } from './upstream-validation.ts'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true })
  }
})

function commitFile(repository: string, content: string, message: string): string {
  writeFileSync(path.join(repository, 'input.txt'), content)
  execFileSync('git', ['add', 'input.txt'], { cwd: repository })
  execFileSync('git', ['commit', '--quiet', '-m', message], { cwd: repository })
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' }).trim()
}

function createRepository(): { baseline: string; observed: string; repository: string } {
  const repository = mkdtempSync(path.join(tmpdir(), 'cat-catch-upstream-state-'))
  temporaryDirectories.push(repository)
  execFileSync('git', ['init', '--quiet'], { cwd: repository })
  execFileSync('git', ['config', 'user.email', 'validator@example.invalid'], { cwd: repository })
  execFileSync('git', ['config', 'user.name', 'Validator Test'], { cwd: repository })
  execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:xifangczy/cat-catch.git'], { cwd: repository })
  const baseline = commitFile(repository, 'baseline\n', 'baseline')
  const observed = commitFile(repository, 'observed\n', 'observed')
  execFileSync('git', ['update-ref', 'refs/remotes/origin/master', observed], { cwd: repository })
  return { baseline, observed, repository }
}

function createContext(
  repository: string,
  upstreamState: JsonObject,
): ValidationContext {
  return {
    appRoot: repository,
    catCatchDirectory: path.join(repository, 'docs/cat-catch'),
    documents: new Map([['upstream-state.json', upstreamState]]),
    inputHashes: {},
    schemas: new Map(),
    upstreamRoot: repository,
  }
}

describe('Cat Catch upstream state binding', () => {
  it('normalizes canonical HTTPS and SSH GitHub repository URLs', () => {
    expect(canonicalizeGitRepositoryUrl('https://github.com/xifangczy/cat-catch')).toBe('github.com/xifangczy/cat-catch')
    expect(canonicalizeGitRepositoryUrl('git@github.com:xifangczy/cat-catch.git')).toBe('github.com/xifangczy/cat-catch')
  })

  it('binds observedHead to origin/master instead of the checked-out HEAD', () => {
    const { baseline, observed, repository } = createRepository()
    commitFile(repository, 'local-head-ahead\n', 'local head ahead')
    const issues = validateUpstreamState(createContext(repository, {
      repository: 'https://github.com/xifangczy/cat-catch',
      baselineCursor: baseline,
      observedHead: observed,
      auditedThrough: null,
      verificationTarget: null,
      releaseCursor: null,
    }))

    expect(issues).toContainEqual(expect.objectContaining({ code: 'audit-cursor-unset' }))
    expect(issues).not.toContainEqual(expect.objectContaining({ code: 'observed-head-stale' }))
    expect(issues).not.toContainEqual(expect.objectContaining({ severity: 'error' }))
  })

  it('rejects audited and release cursors outside the observed ancestry chain', () => {
    const { baseline, observed, repository } = createRepository()
    const unauditedFuture = commitFile(repository, 'future\n', 'future')
    const issues = validateUpstreamState(createContext(repository, {
      repository: 'https://github.com/xifangczy/cat-catch',
      baselineCursor: baseline,
      observedHead: observed,
      auditedThrough: unauditedFuture,
      verificationTarget: observed,
      releaseCursor: unauditedFuture,
    }))

    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'auditedThrough-after-observed-head' }),
      expect.objectContaining({ code: 'releaseCursor-after-observed-head' }),
      expect.objectContaining({ code: 'release-cursor-not-verification-target' }),
    ]))
  })

  it('rejects a different upstream origin even when commit ids exist', () => {
    const { baseline, observed, repository } = createRepository()
    const issues = validateUpstreamState(createContext(repository, {
      repository: 'https://github.com/example/not-cat-catch',
      baselineCursor: baseline,
      observedHead: observed,
      auditedThrough: observed,
      verificationTarget: observed,
      releaseCursor: observed,
    }))

    expect(issues).toContainEqual(expect.objectContaining({
      code: 'upstream-origin-mismatch',
      severity: 'error',
    }))
  })
})
