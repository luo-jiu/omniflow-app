import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { sha256Bytes } from './json.ts'
import { validateGitSourceReference } from './source-validation.ts'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true })
  }
})

function commit(repository: string, content: string, message: string): string {
  writeFileSync(path.join(repository, 'source.ts'), content)
  execFileSync('git', ['add', 'source.ts'], { cwd: repository })
  execFileSync('git', ['commit', '--quiet', '-m', message], { cwd: repository })
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' }).trim()
}

function createRepository(): { current: string; introducedBy: string; repository: string } {
  const repository = mkdtempSync(path.join(tmpdir(), 'cat-catch-source-ref-'))
  temporaryDirectories.push(repository)
  execFileSync('git', ['init', '--quiet'], { cwd: repository })
  execFileSync('git', ['config', 'user.email', 'validator@example.invalid'], { cwd: repository })
  execFileSync('git', ['config', 'user.name', 'Validator Test'], { cwd: repository })
  const introducedBy = commit(repository, 'export const anchor = true\n', 'introduce source')
  const current = commit(repository, 'export const anchor = true\nexport const current = true\n', 'extend source')
  return { current, introducedBy, repository }
}

describe('Cat Catch exact source references', () => {
  it('validates hash and anchor against commit bytes rather than worktree bytes', () => {
    const { current, introducedBy, repository } = createRepository()
    const committedSource = 'export const anchor = true\nexport const current = true\n'
    writeFileSync(path.join(repository, 'source.ts'), 'worktree changed\n')

    expect(validateGitSourceReference({
      commit: current,
      hashField: 'blobHash',
      issuePath: 'source',
      repositoryRoot: repository,
      requireIntroducedBy: true,
      source: {
        path: 'source.ts',
        anchor: 'anchor',
        blobHash: sha256Bytes(committedSource),
        introducedBy,
      },
    })).toEqual([])
  })

  it('rejects stale hashes and anchors absent from the declared introduction commit', () => {
    const { current, introducedBy, repository } = createRepository()
    const later = commit(repository, 'export const anchor = true\nexport const lateAnchor = true\n', 'late anchor')

    const issues = validateGitSourceReference({
      commit: later,
      hashField: 'blobHash',
      issuePath: 'source',
      repositoryRoot: repository,
      requireIntroducedBy: true,
      source: {
        path: 'source.ts',
        anchor: 'lateAnchor',
        blobHash: `sha256:${'0'.repeat(64)}`,
        introducedBy,
      },
    })

    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'source-hash-mismatch' }),
      expect.objectContaining({ code: 'source-anchor-not-introduced' }),
    ]))
    expect(current).not.toBe(later)
  })

  it('rejects an introduction commit that did not touch the declared path', () => {
    const { current, repository } = createRepository()
    writeFileSync(path.join(repository, 'other.ts'), 'export const unrelated = true\n')
    execFileSync('git', ['add', 'other.ts'], { cwd: repository })
    execFileSync('git', ['commit', '--quiet', '-m', 'unrelated'], { cwd: repository })
    const unrelatedCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' }).trim()

    expect(validateGitSourceReference({
      commit: unrelatedCommit,
      hashField: 'blobHash',
      issuePath: 'source',
      repositoryRoot: repository,
      source: {
        path: 'source.ts',
        anchor: 'anchor',
        blobHash: sha256Bytes('export const anchor = true\nexport const current = true\n'),
        introducedBy: unrelatedCommit,
      },
    })).toContainEqual(expect.objectContaining({ code: 'source-introduction-path-unproven' }))
    expect(current).not.toBe(unrelatedCommit)
  })
})
