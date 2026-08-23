import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  getGitAncestryState,
  gitCommitContainsPathScope,
  hashGitCommitInputs,
  hashTrackedWorktreeInputs,
  hashValidatorSourceManifest,
  hashValidatorToolchainFingerprint,
  listDirtyTrackedPaths,
  listUntrackedPaths,
  readGitCommitParents,
  readGitFileAtCommit,
  readGitPathAtCommit,
} from './git-input.ts'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true })
  }
})

function initializeRepository(): string {
  const repository = mkdtempSync(path.join(tmpdir(), 'cat-catch-git-input-'))
  temporaryDirectories.push(repository)
  execFileSync('git', ['init', '--quiet'], { cwd: repository })
  execFileSync('git', ['config', 'user.email', 'validator@example.invalid'], { cwd: repository })
  execFileSync('git', ['config', 'user.name', 'Validator Test'], { cwd: repository })
  return repository
}

function createRepository(): string {
  const repository = initializeRepository()
  mkdirSync(path.join(repository, 'docs/cat-catch/report-index'), { recursive: true })
  writeFileSync(path.join(repository, 'input.txt'), 'input-a\n')
  writeFileSync(path.join(repository, 'docs/cat-catch/report-index/index.json'), '{"entries":[]}\n')
  execFileSync('git', ['add', '.'], { cwd: repository })
  execFileSync('git', ['commit', '--quiet', '-m', 'fixture'], { cwd: repository })
  return repository
}

describe('Cat Catch Git inputs', () => {
  it('excludes report-index bytes from the evidence input hash', () => {
    const repository = createRepository()
    const before = hashTrackedWorktreeInputs(repository)
    writeFileSync(path.join(repository, 'docs/cat-catch/report-index/index.json'), '{"entries":[{"id":"changed"}]}\n')
    expect(hashTrackedWorktreeInputs(repository)).toBe(before)

    writeFileSync(path.join(repository, 'input.txt'), 'input-b\n')
    expect(hashTrackedWorktreeInputs(repository)).not.toBe(before)
  })

  it('includes untracked candidate inputs while exact commit hashes stay immutable', () => {
    const repository = createRepository()
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' }).trim()
    const commitHash = hashGitCommitInputs(repository, head)
    const candidateHash = hashTrackedWorktreeInputs(repository)

    writeFileSync(path.join(repository, 'untracked.txt'), 'candidate-only\n')
    expect(listUntrackedPaths(repository)).toEqual(['untracked.txt'])
    expect(hashTrackedWorktreeInputs(repository)).not.toBe(candidateHash)
    expect(hashGitCommitInputs(repository, head)).toBe(commitHash)
  })

  it('reads source bytes from an exact commit and binds Git mode changes', () => {
    const repository = createRepository()
    const firstCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' }).trim()
    const firstHash = hashGitCommitInputs(repository, firstCommit)

    writeFileSync(path.join(repository, 'input.txt'), 'worktree-only\n')
    expect(readGitFileAtCommit(repository, firstCommit, 'input.txt')?.toString('utf8')).toBe('input-a\n')
    expect(gitCommitContainsPathScope(repository, firstCommit, 'docs')).toBe(true)
    expect(gitCommitContainsPathScope(repository, firstCommit, 'missing')).toBe(false)

    execFileSync('git', ['update-index', '--chmod=+x', 'input.txt'], { cwd: repository })
    execFileSync('git', ['commit', '--quiet', '-m', 'mode-only'], { cwd: repository })
    const secondCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' }).trim()
    expect(hashGitCommitInputs(repository, secondCommit)).not.toBe(firstHash)
  })

  it('distinguishes absent paths from unavailable Git objects and exposes direct parents', () => {
    const repository = createRepository()
    const parent = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' }).trim()
    writeFileSync(path.join(repository, 'second.txt'), 'second\n')
    execFileSync('git', ['add', 'second.txt'], { cwd: repository })
    execFileSync('git', ['commit', '--quiet', '-m', 'second'], { cwd: repository })
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' }).trim()

    expect(readGitCommitParents(repository, head)).toEqual([parent])
    expect(readGitCommitParents(repository, parent)).toEqual([])
    expect(readGitPathAtCommit(repository, head, 'input.txt')).toEqual(expect.objectContaining({
      status: 'present',
    }))
    expect(readGitPathAtCommit(repository, head, 'missing.txt')).toEqual({ status: 'absent' })
    expect(readGitPathAtCommit(repository, 'f'.repeat(40), 'input.txt')).toEqual({ status: 'unavailable' })
  })

  it('reads direct parents from a root commit with an empty message', () => {
    const repository = initializeRepository()
    execFileSync('git', [
      'commit',
      '--quiet',
      '--allow-empty',
      '--allow-empty-message',
      '-m',
      '',
    ], { cwd: repository })
    const root = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repository,
      encoding: 'utf8',
    }).trim()

    expect(readGitCommitParents(repository, root)).toEqual([])
  })

  it('distinguishes complete, incomplete, and unavailable ancestry graphs', () => {
    const completeRepository = createRepository()
    const ancestor = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: completeRepository,
      encoding: 'utf8',
    }).trim()
    execFileSync('git', ['commit', '--quiet', '--allow-empty', '-m', 'descendant'], {
      cwd: completeRepository,
    })
    const descendant = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: completeRepository,
      encoding: 'utf8',
    }).trim()
    expect(getGitAncestryState(completeRepository, ancestor, descendant)).toBe('ancestor')
    expect(getGitAncestryState(completeRepository, descendant, ancestor)).toBe('not-ancestor')

    const incompleteRepository = createRepository()
    const incompleteAncestor = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: incompleteRepository,
      encoding: 'utf8',
    }).trim()
    execFileSync('git', ['commit', '--quiet', '--allow-empty', '-m', 'missing middle'], {
      cwd: incompleteRepository,
    })
    const missingParent = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: incompleteRepository,
      encoding: 'utf8',
    }).trim()
    execFileSync('git', ['commit', '--quiet', '--allow-empty', '-m', 'incomplete descendant'], {
      cwd: incompleteRepository,
    })
    const incompleteDescendant = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: incompleteRepository,
      encoding: 'utf8',
    }).trim()
    rmSync(path.join(
      incompleteRepository,
      '.git',
      'objects',
      missingParent.slice(0, 2),
      missingParent.slice(2),
    ))
    expect(getGitAncestryState(
      incompleteRepository,
      incompleteAncestor,
      incompleteDescendant,
    )).toBe('unavailable')

    const nonRepository = mkdtempSync(path.join(tmpdir(), 'cat-catch-git-unavailable-'))
    temporaryDirectories.push(nonRepository)
    expect(getGitAncestryState(nonRepository, 'a'.repeat(40), 'b'.repeat(40))).toBe('unavailable')
  })

  it('reports tracked changes without dropping a leading porcelain status byte', () => {
    const repository = createRepository()
    writeFileSync(path.join(repository, 'input.txt'), 'changed\n')
    expect(listDirtyTrackedPaths(repository)).toEqual(['input.txt'])
  })

  it('binds validator dependencies and TypeScript configuration into its source manifest', () => {
    const repository = createRepository()
    mkdirSync(path.join(repository, 'tools/cat-catch-lab/validator'), { recursive: true })
    writeFileSync(path.join(repository, 'tools/cat-catch-lab/validator/cli.ts'), 'export {}\n')
    writeFileSync(path.join(repository, 'package.json'), '{"devDependencies":{"ajv":"8.17.1"}}\n')
    writeFileSync(path.join(repository, 'package-lock.json'), '{"lockfileVersion":3}\n')
    writeFileSync(path.join(repository, 'tsconfig.cat-catch-tools.json'), '{}\n')
    const before = hashValidatorSourceManifest(repository)

    writeFileSync(path.join(repository, 'package-lock.json'), '{"lockfileVersion":3,"changed":true}\n')
    expect(hashValidatorSourceManifest(repository)).not.toBe(before)
  })

  it('separately fingerprints the validator runtime toolchain', () => {
    const repository = createRepository()
    mkdirSync(path.join(repository, 'node_modules/ajv'), { recursive: true })
    writeFileSync(path.join(repository, 'node_modules/ajv/package.json'), '{"version":"8.17.1"}\n')
    const before = hashValidatorToolchainFingerprint(repository)

    writeFileSync(path.join(repository, 'node_modules/ajv/package.json'), '{"version":"8.18.0"}\n')
    expect(hashValidatorToolchainFingerprint(repository)).not.toBe(before)
  })
})
