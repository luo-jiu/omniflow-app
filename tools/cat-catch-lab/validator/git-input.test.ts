import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  gitCommitContainsPathScope,
  hashGitCommitInputs,
  hashTrackedWorktreeInputs,
  hashValidatorSourceManifest,
  hashValidatorToolchainFingerprint,
  listDirtyTrackedPaths,
  listUntrackedPaths,
  readGitFileAtCommit,
} from './git-input.ts'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true })
  }
})

function createRepository(): string {
  const repository = mkdtempSync(path.join(tmpdir(), 'cat-catch-git-input-'))
  temporaryDirectories.push(repository)
  execFileSync('git', ['init', '--quiet'], { cwd: repository })
  execFileSync('git', ['config', 'user.email', 'validator@example.invalid'], { cwd: repository })
  execFileSync('git', ['config', 'user.name', 'Validator Test'], { cwd: repository })
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
