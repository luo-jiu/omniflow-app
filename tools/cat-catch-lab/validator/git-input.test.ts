import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { deflateSync } from 'node:zlib'

import { afterEach, describe, expect, it } from 'vitest'

import {
  getGitAncestryState,
  gitCommitContainsPathScope,
  gitCommitTouchesPath,
  hashGitCommitInputs,
  hashTrackedWorktreeInputs,
  hashValidatorSourceManifest,
  hashValidatorSourceHashEntries,
  hashValidatorToolchainFingerprint,
  listGitCommitTreeEntries,
  listGitTreeEntriesAtCommit,
  listDirtyTrackedPaths,
  listUntrackedPaths,
  normalizeWorktreeRelativePath,
  readGitCommitParents,
  readGitBlobObjects,
  readGitFileAtCommit,
  readGitPathAtCommit,
} from './git-input.ts'
import { sha256Bytes } from './json.ts'

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

  it('lists recursive tree entries without consulting uncommitted paths', () => {
    const repository = createRepository()
    const head = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repository,
      encoding: 'utf8',
    }).trim()
    writeFileSync(path.join(repository, 'docs/cat-catch/worktree-only.json'), '{}\n')

    const tree = listGitTreeEntriesAtCommit(repository, head, 'docs/cat-catch')
    expect(tree).toEqual(expect.objectContaining({ status: 'present' }))
    if (tree.status !== 'present') throw new Error('fixture tree is unavailable')
    expect(tree.entries.map(entry => entry.relativePath)).toEqual([
      'docs/cat-catch/report-index/index.json',
    ])
    expect(listGitTreeEntriesAtCommit(repository, head, 'missing')).toEqual({ status: 'absent' })
    expect(listGitTreeEntriesAtCommit(repository, 'f'.repeat(40), 'docs')).toEqual({
      status: 'unavailable',
    })
  })

  it('preserves newlines in NUL-delimited tree paths', () => {
    const repository = createRepository()
    const relativePath = 'line\nbreak.txt'
    writeFileSync(path.join(repository, relativePath), 'newline path\n')
    execFileSync('git', ['add', '.'], { cwd: repository })
    execFileSync('git', ['commit', '--quiet', '-m', 'newline path'], { cwd: repository })
    const head = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repository,
      encoding: 'utf8',
    }).trim()

    const tree = listGitCommitTreeEntries(repository, head)
    expect(tree).toEqual(expect.objectContaining({ status: 'present' }))
    if (tree.status !== 'present') throw new Error('fixture tree is unavailable')
    expect(tree.entries.map(entry => entry.relativePath)).toContain(relativePath)
    expect(readGitPathAtCommit(repository, head, relativePath)).toEqual({
      bytes: Buffer.from('newline path\n'),
      status: 'present',
    })
    expect(hashGitCommitInputs(repository, head)).toMatch(/^sha256:[0-9a-f]{64}$/)
  })

  it('treats exact Git paths containing pathspec characters literally', () => {
    const repository = createRepository()
    const relativePath = 'literal[owner]*?.txt'
    writeFileSync(path.join(repository, relativePath), 'literal pathspec bytes\n')
    execFileSync('git', ['add', '-A'], { cwd: repository })
    execFileSync('git', ['commit', '--quiet', '-m', 'literal pathspec'], { cwd: repository })
    const head = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repository,
      encoding: 'utf8',
    }).trim()

    expect(readGitPathAtCommit(repository, head, relativePath)).toEqual({
      bytes: Buffer.from('literal pathspec bytes\n'),
      status: 'present',
    })
    const scopedTree = listGitTreeEntriesAtCommit(repository, head, relativePath)
    expect(scopedTree).toEqual(expect.objectContaining({ status: 'present' }))
    if (scopedTree.status !== 'present') throw new Error('literal pathspec tree is unavailable')
    expect(scopedTree.entries.map(entry => entry.relativePath)).toEqual([relativePath])
    expect(gitCommitTouchesPath(repository, head, relativePath)).toBe(true)
  })

  it('rejects blob bytes that no longer hash to their exact tree object id', () => {
    const repository = createRepository()
    const head = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repository,
      encoding: 'utf8',
    }).trim()
    const objectId = execFileSync('git', ['rev-parse', `${head}:input.txt`], {
      cwd: repository,
      encoding: 'utf8',
    }).trim()
    const forgedBytes = Buffer.from('forged bytes\n')
    const forgedObject = Buffer.concat([
      Buffer.from(`blob ${forgedBytes.length}\0`),
      forgedBytes,
    ])
    const objectPath = path.join(
      repository,
      '.git',
      'objects',
      objectId.slice(0, 2),
      objectId.slice(2),
    )
    rmSync(objectPath)
    writeFileSync(objectPath, deflateSync(forgedObject))

    expect(readGitBlobObjects(repository, [objectId])).toBeNull()
    expect(readGitPathAtCommit(repository, head, 'input.txt')).toEqual({ status: 'unavailable' })
  })

  it('fails closed when an exact tree contains a non-UTF-8 path', () => {
    const repository = initializeRepository()
    const blob = execFileSync('git', ['hash-object', '-w', '--stdin'], {
      cwd: repository,
      encoding: 'utf8',
      input: 'invalid path bytes\n',
    }).trim()
    const treeInput = Buffer.concat([
      Buffer.from(`100644 blob ${blob}\tinvalid-`),
      Buffer.from([0xff]),
      Buffer.from('.txt\0'),
    ])
    const tree = execFileSync('git', ['mktree', '-z'], {
      cwd: repository,
      encoding: 'utf8',
      input: treeInput,
    }).trim()
    const commit = execFileSync('git', ['commit-tree', tree, '-m', 'invalid path bytes'], {
      cwd: repository,
      encoding: 'utf8',
    }).trim()

    expect(listGitCommitTreeEntries(repository, commit)).toEqual({ status: 'unavailable' })
    expect(hashGitCommitInputs(repository, commit)).toBeNull()
  })

  it('batch reads raw blobs from the complete exact-commit tree', () => {
    const repository = createRepository()
    const binaryBytes = Buffer.from([0x00, 0x0a, 0x41, 0x00, 0x0a, 0xff])
    writeFileSync(path.join(repository, 'binary-input.bin'), binaryBytes)
    execFileSync('git', ['add', 'binary-input.bin'], { cwd: repository })
    execFileSync('git', ['commit', '--quiet', '-m', 'binary input'], { cwd: repository })
    const head = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repository,
      encoding: 'utf8',
    }).trim()
    writeFileSync(path.join(repository, 'input.txt'), 'worktree-only\n')

    const tree = listGitCommitTreeEntries(repository, head)
    expect(tree).toEqual(expect.objectContaining({ status: 'present' }))
    if (tree.status !== 'present') throw new Error('fixture tree is unavailable')
    const blobs = readGitBlobObjects(
      repository,
      tree.entries.filter(entry => entry.objectType === 'blob').map(entry => entry.objectId),
    )
    expect(blobs).not.toBeNull()
    const inputEntry = tree.entries.find(entry => entry.relativePath === 'input.txt')
    if (!inputEntry) throw new Error('fixture input tree entry is missing')
    expect(blobs?.get(inputEntry.objectId)?.toString('utf8')).toBe('input-a\n')
    const binaryEntry = tree.entries.find(entry => entry.relativePath === 'binary-input.bin')
    if (!binaryEntry) throw new Error('fixture binary tree entry is missing')
    expect(blobs?.get(binaryEntry.objectId)).toEqual(binaryBytes)
    expect(readGitBlobObjects(repository, ['not-an-object-id'])).toBeNull()
    expect(listGitCommitTreeEntries(repository, 'f'.repeat(40))).toEqual({ status: 'unavailable' })
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
    execFileSync('git', ['add', '.'], { cwd: repository })
    execFileSync('git', ['commit', '--quiet', '-m', 'validator sources'], { cwd: repository })
    const head = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repository,
      encoding: 'utf8',
    }).trim()
    const tree = listGitCommitTreeEntries(repository, head)
    if (tree.status !== 'present') throw new Error('fixture tree is unavailable')
    const validatorEntries = tree.entries.filter(entry => (
      (entry.relativePath.startsWith('tools/cat-catch-lab/validator/') && entry.relativePath.endsWith('.ts'))
      || entry.relativePath === 'package.json'
      || entry.relativePath === 'package-lock.json'
      || entry.relativePath === 'tsconfig.cat-catch-tools.json'
    ))
    const blobs = readGitBlobObjects(repository, validatorEntries.map(entry => entry.objectId))
    if (!blobs) throw new Error('fixture blobs are unavailable')
    const exactCommitHash = hashValidatorSourceHashEntries(validatorEntries.map(entry => ({
      contentHash: sha256Bytes(blobs.get(entry.objectId) || Buffer.alloc(0)),
      relativePath: entry.relativePath,
    })))
    expect(exactCommitHash).toBe(before)

    writeFileSync(path.join(repository, 'package-lock.json'), '{"lockfileVersion":3,"changed":true}\n')
    expect(hashValidatorSourceManifest(repository)).not.toBe(before)
  })

  it('uses locale-independent code-unit ordering for validator source hashes', () => {
    const firstHash = `sha256:${'1'.repeat(64)}`
    const secondHash = `sha256:${'2'.repeat(64)}`
    const entries = [
      { contentHash: secondHash, relativePath: 'validator/é.ts' },
      { contentHash: firstHash, relativePath: 'validator/z.ts' },
    ]
    expect(hashValidatorSourceHashEntries(entries)).toBe(sha256Bytes(
      `validator/z.ts\0${firstHash}\0validator/é.ts\0${secondHash}`,
    ))
    expect(hashValidatorSourceHashEntries([...entries].reverse())).toBe(
      hashValidatorSourceHashEntries(entries),
    )
  })

  it('normalizes host separators before hashing without collapsing POSIX backslashes', () => {
    expect(normalizeWorktreeRelativePath(
      'tools\\cat-catch-lab\\validator\\cli.ts',
      '\\',
    )).toBe('tools/cat-catch-lab/validator/cli.ts')
    expect(normalizeWorktreeRelativePath('validator/a\\b.ts', '/')).toBe('validator/a\\b.ts')

    const contentHash = `sha256:${'1'.repeat(64)}`
    expect(hashValidatorSourceHashEntries([
      { contentHash, relativePath: 'validator/a\\b.ts' },
    ])).not.toBe(hashValidatorSourceHashEntries([
      { contentHash, relativePath: 'validator/a/b.ts' },
    ]))
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
