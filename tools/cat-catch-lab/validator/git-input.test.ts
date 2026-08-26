import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { deflateSync } from 'node:zlib'

import { afterEach, describe, expect, it } from 'vitest'

import {
  getGitAncestryState,
  getGitCommitRangeMembershipState,
  gitCommitContainsPathScope,
  gitCommitTouchesPath,
  gitObjectExists,
  hashGitCommitInputs,
  hashTrackedWorktreeInputs,
  hashValidatorSourceManifest,
  hashValidatorSourceHashEntries,
  hashValidatorToolchainFingerprint,
  listGitCommitTreeEntries,
  listGitCommitTreeEntriesWithBudget,
  listGitTreeEntriesAtCommit,
  listDirtyTrackedPaths,
  listUntrackedPaths,
  normalizeWorktreeRelativePath,
  inspectVerifiedGitCommitMetadata,
  readGitCommitParents,
  readGitBlobObjects,
  readGitFileAtCommit,
  readGitPathAtCommit,
  readVerifiedGitCommitMetadata,
} from './git-input.ts'
import { sha256Bytes } from './json.ts'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true })
  }
})

function initializeRepository(objectFormat?: 'sha1' | 'sha256'): string {
  const repository = mkdtempSync(path.join(tmpdir(), 'cat-catch-git-input-'))
  temporaryDirectories.push(repository)
  execFileSync('git', [
    'init',
    '--quiet',
    ...(objectFormat ? [`--object-format=${objectFormat}`] : []),
  ], { cwd: repository })
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

function writeLiteralTreeObject(repository: string, rawTree: Buffer): string {
  return execFileSync(
    'git',
    ['hash-object', '-t', 'tree', '-w', '--stdin', '--literally'],
    { cwd: repository, encoding: 'utf8', input: rawTree },
  ).trim()
}

function writeLiteralTreeCommit(repository: string, rawTree: Buffer): string {
  const treeId = writeLiteralTreeObject(repository, rawTree)
  return execFileSync('git', ['commit-tree', treeId, '-m', 'literal tree'], {
    cwd: repository,
    encoding: 'utf8',
  }).trim()
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

  it('does not expose mutable exact-path cache bytes to callers', () => {
    const repository = createRepository()
    const head = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repository,
      encoding: 'utf8',
    }).trim()
    const firstRead = readGitPathAtCommit(repository, head, 'input.txt')
    if (firstRead.status !== 'present') throw new Error('fixture path is unavailable')
    firstRead.bytes.fill(0x78)

    expect(readGitPathAtCommit(repository, head, 'input.txt')).toEqual({
      bytes: Buffer.from('input-a\n'),
      status: 'present',
    })
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

  it('verifies SHA-256 commit and recursive tree object identities', () => {
    const repository = initializeRepository('sha256')
    mkdirSync(path.join(repository, 'nested'))
    writeFileSync(path.join(repository, 'nested/input.txt'), 'sha256 tree\n')
    execFileSync('git', ['add', '.'], { cwd: repository })
    execFileSync('git', ['commit', '--quiet', '-m', 'sha256 fixture'], { cwd: repository })
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repository,
      encoding: 'utf8',
    }).trim()

    expect(commit).toMatch(/^[0-9a-f]{64}$/)
    const tree = listGitCommitTreeEntries(repository, commit)
    expect(tree).toEqual({
      entries: [{
        mode: '100644',
        objectId: expect.stringMatching(/^[0-9a-f]{64}$/),
        objectType: 'blob',
        relativePath: 'nested/input.txt',
      }],
      status: 'present',
    })
  })

  it('charges recursive raw-tree entries incrementally and reports the completed walk size', () => {
    const repository = initializeRepository()
    mkdirSync(path.join(repository, 'nested'))
    writeFileSync(path.join(repository, 'nested/input.txt'), 'nested tree\n')
    execFileSync('git', ['add', '.'], { cwd: repository })
    execFileSync('git', ['commit', '--quiet', '-m', 'nested tree budget'], { cwd: repository })
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repository,
      encoding: 'utf8',
    }).trim()

    expect(listGitCommitTreeEntriesWithBudget(repository, commit, 1)).toEqual({
      requiredEntryCount: 2,
      status: 'budget-exhausted',
    })
    expect(listGitCommitTreeEntriesWithBudget(repository, commit, 2)).toEqual({
      entries: [{
        mode: '100644',
        objectId: expect.stringMatching(/^[0-9a-f]{40}$/),
        objectType: 'blob',
        relativePath: 'nested/input.txt',
      }],
      status: 'present',
      walkedEntryCount: 2,
    })
    expect(listGitCommitTreeEntriesWithBudget(repository, commit, 1)).toEqual({
      requiredEntryCount: 2,
      status: 'budget-exhausted',
    })
  })

  it('lets the entry budget fail closed before an unavailable child tree', () => {
    const repository = initializeRepository()
    const missingTreeId = '11'.repeat(20)
    const commit = writeLiteralTreeCommit(repository, Buffer.concat([
      Buffer.from('40000 nested\0'),
      Buffer.from(missingTreeId, 'hex'),
    ]))

    expect(listGitCommitTreeEntriesWithBudget(repository, commit, 1)).toEqual({
      requiredEntryCount: 2,
      status: 'budget-exhausted',
    })
    expect(listGitCommitTreeEntriesWithBudget(repository, commit, 2)).toEqual({
      status: 'unavailable',
    })
  })

  it('accepts verified empty trees without charging phantom entries', () => {
    const repository = initializeRepository()
    const emptyTreeId = execFileSync(
      'git',
      ['hash-object', '-t', 'tree', '-w', '--stdin'],
      { cwd: repository, encoding: 'utf8', input: Buffer.alloc(0) },
    ).trim()
    const emptyRootCommit = writeLiteralTreeCommit(repository, Buffer.alloc(0))
    const nestedEmptyCommit = writeLiteralTreeCommit(repository, Buffer.concat([
      Buffer.from('40000 nested\0'),
      Buffer.from(emptyTreeId, 'hex'),
    ]))

    expect(listGitCommitTreeEntriesWithBudget(repository, emptyRootCommit, 0)).toEqual({
      entries: [],
      status: 'present',
      walkedEntryCount: 0,
    })
    expect(listGitCommitTreeEntriesWithBudget(repository, nestedEmptyCommit, 1)).toEqual({
      entries: [],
      status: 'present',
      walkedEntryCount: 1,
    })
    expect(readGitPathAtCommit(repository, nestedEmptyCommit, 'nested')).toEqual({
      status: 'unavailable',
    })
  })

  it('charges repeated subtree expansion for every recursive path', () => {
    const repository = initializeRepository()
    const blobId = execFileSync('git', ['hash-object', '-w', '--stdin'], {
      cwd: repository,
      encoding: 'utf8',
      input: 'shared leaf\n',
    }).trim()
    const childTreeId = writeLiteralTreeObject(repository, Buffer.concat([
      Buffer.from('100644 leaf.txt\0'),
      Buffer.from(blobId, 'hex'),
    ]))
    const commit = writeLiteralTreeCommit(repository, Buffer.concat([
      Buffer.from('40000 a\0'),
      Buffer.from(childTreeId, 'hex'),
      Buffer.from('40000 b\0'),
      Buffer.from(childTreeId, 'hex'),
    ]))

    expect(listGitCommitTreeEntriesWithBudget(repository, commit, 3)).toEqual({
      requiredEntryCount: 4,
      status: 'budget-exhausted',
    })
    expect(listGitCommitTreeEntriesWithBudget(repository, commit, 4)).toEqual({
      entries: [
        expect.objectContaining({ relativePath: 'a/leaf.txt' }),
        expect.objectContaining({ relativePath: 'b/leaf.txt' }),
      ],
      status: 'present',
      walkedEntryCount: 4,
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

  it('rejects raw root and nested tree bytes that do not match their referenced ids', () => {
    const rootRepository = createRepository()
    const rootCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: rootRepository,
      encoding: 'utf8',
    }).trim()
    const rootTreeId = execFileSync('git', ['rev-parse', 'HEAD^{tree}'], {
      cwd: rootRepository,
      encoding: 'utf8',
    }).trim()
    const rootTreeBytes = execFileSync('git', ['cat-file', 'tree', rootTreeId], {
      cwd: rootRepository,
      encoding: 'buffer',
    })
    const forgedRootBytes = Buffer.from(rootTreeBytes)
    const rootNameOffset = forgedRootBytes.indexOf(0x20) + 1
    forgedRootBytes[rootNameOffset] = forgedRootBytes[rootNameOffset] === 0x64 ? 0x65 : 0x64
    const rootObjectPath = path.join(
      rootRepository,
      '.git',
      'objects',
      rootTreeId.slice(0, 2),
      rootTreeId.slice(2),
    )
    rmSync(rootObjectPath)
    writeFileSync(rootObjectPath, deflateSync(Buffer.concat([
      Buffer.from(`tree ${forgedRootBytes.length}\0`),
      forgedRootBytes,
    ])))
    expect(listGitCommitTreeEntries(rootRepository, rootCommit)).toEqual({ status: 'unavailable' })
    expect(listGitTreeEntriesAtCommit(rootRepository, rootCommit, 'docs')).toEqual({
      status: 'unavailable',
    })
    expect(readGitPathAtCommit(rootRepository, rootCommit, 'input.txt')).toEqual({
      status: 'unavailable',
    })
    expect(gitCommitContainsPathScope(rootRepository, rootCommit, 'docs')).toBe(false)
    expect(gitCommitTouchesPath(rootRepository, rootCommit, 'input.txt')).toBe(false)

    const nestedRepository = createRepository()
    mkdirSync(path.join(nestedRepository, 'nested'))
    writeFileSync(path.join(nestedRepository, 'nested/leaf.txt'), 'nested leaf\n')
    execFileSync('git', ['add', 'nested/leaf.txt'], { cwd: nestedRepository })
    execFileSync('git', ['commit', '--quiet', '-m', 'nested tree'], { cwd: nestedRepository })
    const nestedCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: nestedRepository,
      encoding: 'utf8',
    }).trim()
    const nestedTreeId = execFileSync('git', ['rev-parse', 'HEAD:nested'], {
      cwd: nestedRepository,
      encoding: 'utf8',
    }).trim()
    const nestedTreeBytes = execFileSync('git', ['cat-file', 'tree', nestedTreeId], {
      cwd: nestedRepository,
      encoding: 'buffer',
    })
    const forgedNestedBytes = Buffer.from(nestedTreeBytes)
    const nestedNameOffset = forgedNestedBytes.indexOf(0x20) + 1
    forgedNestedBytes[nestedNameOffset] = forgedNestedBytes[nestedNameOffset] === 0x6c ? 0x6d : 0x6c
    const nestedObjectPath = path.join(
      nestedRepository,
      '.git',
      'objects',
      nestedTreeId.slice(0, 2),
      nestedTreeId.slice(2),
    )
    rmSync(nestedObjectPath)
    writeFileSync(nestedObjectPath, deflateSync(Buffer.concat([
      Buffer.from(`tree ${forgedNestedBytes.length}\0`),
      forgedNestedBytes,
    ])))
    expect(listGitCommitTreeEntries(nestedRepository, nestedCommit)).toEqual({
      status: 'unavailable',
    })
    expect(listGitTreeEntriesAtCommit(nestedRepository, nestedCommit, 'nested')).toEqual({
      status: 'unavailable',
    })
    expect(readGitPathAtCommit(nestedRepository, nestedCommit, 'nested/leaf.txt')).toEqual({
      status: 'unavailable',
    })
    expect(gitCommitContainsPathScope(nestedRepository, nestedCommit, 'nested')).toBe(false)
    expect(gitCommitTouchesPath(nestedRepository, nestedCommit, 'nested/leaf.txt')).toBe(false)
  })

  it('verifies every direct parent tree before reporting that a merge touched a path', () => {
    const repository = createRepository()
    const mainBranch = execFileSync('git', ['branch', '--show-current'], {
      cwd: repository,
      encoding: 'utf8',
    }).trim()
    execFileSync('git', ['checkout', '--quiet', '-b', 'side'], { cwd: repository })
    writeFileSync(path.join(repository, 'side.txt'), 'side\n')
    execFileSync('git', ['add', 'side.txt'], { cwd: repository })
    execFileSync('git', ['commit', '--quiet', '-m', 'side'], { cwd: repository })
    const sideCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repository,
      encoding: 'utf8',
    }).trim()

    execFileSync('git', ['checkout', '--quiet', mainBranch], { cwd: repository })
    writeFileSync(path.join(repository, 'main.txt'), 'main\n')
    execFileSync('git', ['add', 'main.txt'], { cwd: repository })
    execFileSync('git', ['commit', '--quiet', '-m', 'main'], { cwd: repository })
    execFileSync('git', ['merge', '--quiet', '--no-ff', 'side', '-m', 'merge'], {
      cwd: repository,
    })
    const mergeCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repository,
      encoding: 'utf8',
    }).trim()
    const sideTreeId = execFileSync('git', ['rev-parse', `${sideCommit}^{tree}`], {
      cwd: repository,
      encoding: 'utf8',
    }).trim()
    const sideTreeBytes = execFileSync('git', ['cat-file', 'tree', sideTreeId], {
      cwd: repository,
      encoding: 'buffer',
    })
    const forgedSideTreeBytes = Buffer.from(sideTreeBytes)
    const firstNameOffset = forgedSideTreeBytes.indexOf(0x20) + 1
    forgedSideTreeBytes[firstNameOffset] = forgedSideTreeBytes[firstNameOffset] === 0x64 ? 0x65 : 0x64
    const sideTreeObjectPath = path.join(
      repository,
      '.git',
      'objects',
      sideTreeId.slice(0, 2),
      sideTreeId.slice(2),
    )
    rmSync(sideTreeObjectPath)
    writeFileSync(sideTreeObjectPath, deflateSync(Buffer.concat([
      Buffer.from(`tree ${forgedSideTreeBytes.length}\0`),
      forgedSideTreeBytes,
    ])))

    expect(gitCommitTouchesPath(repository, mergeCommit, 'side.txt')).toBe(false)
  })

  it('rejects matching-id tree objects with duplicate, unsorted, or malformed entries', () => {
    const repository = createRepository()
    const blobId = execFileSync('git', ['rev-parse', 'HEAD:input.txt'], {
      cwd: repository,
      encoding: 'utf8',
    }).trim()
    const objectIdBytes = Buffer.from(blobId, 'hex')
    const entry = (mode: string, name: string, objectId = objectIdBytes): Buffer => Buffer.concat([
      Buffer.from(`${mode} ${name}\0`),
      objectId,
    ])
    const malformedTrees = [
      Buffer.concat([entry('100644', 'same.txt'), entry('100644', 'same.txt')]),
      Buffer.concat([entry('100644', 'z.txt'), entry('100644', 'a.txt')]),
      entry('100664', 'invalid-mode.txt'),
      entry('100644', 'directory/name.txt'),
      entry('100644', 'truncated.txt', objectIdBytes.subarray(0, objectIdBytes.length - 1)),
      entry('40000', 'blob-as-tree', objectIdBytes),
      entry('40000', 'missing-tree', Buffer.from('11'.repeat(objectIdBytes.length), 'hex')),
    ]

    for (const rawTree of malformedTrees) {
      const commit = writeLiteralTreeCommit(repository, rawTree)
      expect(listGitCommitTreeEntries(repository, commit)).toEqual({ status: 'unavailable' })
    }
  })

  it('preserves an unavailable external gitlink as a commit leaf', () => {
    const repository = createRepository()
    const externalCommitId = '22'.repeat(20)
    const commit = writeLiteralTreeCommit(repository, Buffer.concat([
      Buffer.from('160000 submodule\0'),
      Buffer.from(externalCommitId, 'hex'),
    ]))

    expect(listGitCommitTreeEntries(repository, commit)).toEqual({
      entries: [{
        mode: '160000',
        objectId: externalCommitId,
        objectType: 'commit',
        relativePath: 'submodule',
      }],
      status: 'present',
    })
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

  it('verifies raw commit identity and exposes exact tree, parents, and message bytes', () => {
    const repository = createRepository()
    const parent = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repository,
      encoding: 'utf8',
    }).trim()
    execFileSync('git', ['commit', '--quiet', '--allow-empty', '-m', 'literal π message'], {
      cwd: repository,
    })
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repository,
      encoding: 'utf8',
    }).trim()
    const tree = execFileSync('git', ['rev-parse', `${commit}^{tree}`], {
      cwd: repository,
      encoding: 'utf8',
    }).trim()

    const metadata = readVerifiedGitCommitMetadata(repository, commit)
    expect(metadata).toEqual(expect.objectContaining({
      commitId: commit,
      message: 'literal π message\n',
      parentIds: [parent],
      treeId: tree,
    }))
    expect(metadata?.messageBytes).toEqual(Buffer.from('literal π message\n'))
    expect(metadata?.rawObjectHash).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(readVerifiedGitCommitMetadata(repository, commit.slice(0, 12))).toBeNull()
  })

  it('returns defensive copies of cached verified commit metadata', () => {
    const repository = createRepository()
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repository,
      encoding: 'utf8',
    }).trim()
    const first = readVerifiedGitCommitMetadata(repository, commit)
    if (!first) throw new Error('verified commit metadata fixture is unavailable')
    first.messageBytes.fill(0x78)
    first.parentIds.push('f'.repeat(40))

    const second = inspectVerifiedGitCommitMetadata(repository, commit)
    expect(second).toEqual(expect.objectContaining({ status: 'present' }))
    if (second.status !== 'present') throw new Error('cached commit metadata is unavailable')
    expect(second.metadata.messageBytes).toEqual(Buffer.from('fixture\n'))
    expect(second.metadata.parentIds).toEqual([])
  })

  it('rejects raw commit bytes that do not hash to the requested object id', () => {
    const repository = createRepository()
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repository,
      encoding: 'utf8',
    }).trim()
    const rawCommit = execFileSync('git', ['cat-file', 'commit', commit], {
      cwd: repository,
      encoding: 'buffer',
    })
    const messageOffset = rawCommit.indexOf('\n\n') + 2
    const forgedBytes = Buffer.from(rawCommit)
    forgedBytes[messageOffset] = forgedBytes[messageOffset] === 0x66 ? 0x67 : 0x66
    const forgedObject = Buffer.concat([
      Buffer.from(`commit ${forgedBytes.length}\0`),
      forgedBytes,
    ])
    const objectPath = path.join(
      repository,
      '.git',
      'objects',
      commit.slice(0, 2),
      commit.slice(2),
    )
    const originalObject = readFileSync(objectPath)
    rmSync(objectPath)
    writeFileSync(objectPath, deflateSync(forgedObject))

    expect(readVerifiedGitCommitMetadata(repository, commit)).toBeNull()
    expect(gitObjectExists(repository, commit)).toBe(false)
    expect(getGitAncestryState(repository, commit, commit)).toBe('unavailable')
    expect(readGitCommitParents(repository, commit)).toBeNull()
    expect(listGitCommitTreeEntries(repository, commit)).toEqual({ status: 'unavailable' })
    expect(listGitTreeEntriesAtCommit(repository, commit, 'docs')).toEqual({
      status: 'unavailable',
    })
    expect(readGitPathAtCommit(repository, commit, 'input.txt')).toEqual({
      status: 'unavailable',
    })
    expect(gitCommitContainsPathScope(repository, commit, 'docs')).toBe(false)
    expect(gitCommitTouchesPath(repository, commit, 'input.txt')).toBe(false)

    writeFileSync(objectPath, originalObject)
    expect(readVerifiedGitCommitMetadata(repository, commit)).toEqual(expect.objectContaining({
      commitId: commit,
    }))
  })

  it('fails closed when raw commit messages are not valid UTF-8', () => {
    const repository = createRepository()
    const tree = execFileSync('git', ['rev-parse', 'HEAD^{tree}'], {
      cwd: repository,
      encoding: 'utf8',
    }).trim()
    const malformedCommit = Buffer.concat([
      Buffer.from(`tree ${tree}\nauthor Validator Test <validator@example.invalid> 1 +0000\n`),
      Buffer.from('committer Validator Test <validator@example.invalid> 1 +0000\n\nmessage-'),
      Buffer.from([0xc3, 0x28]),
    ])
    const commit = execFileSync('git', ['hash-object', '-t', 'commit', '-w', '--stdin'], {
      cwd: repository,
      encoding: 'utf8',
      input: malformedCommit,
    }).trim()

    expect(inspectVerifiedGitCommitMetadata(repository, commit)).toEqual({
      reason: 'invalid-message-utf8',
      status: 'unavailable',
    })
    expect(readGitCommitParents(repository, commit)).toBeNull()
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

  it('classifies exact from-parent-excluded range membership across a merge DAG', () => {
    const repository = createRepository()
    const root = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repository,
      encoding: 'utf8',
    }).trim()
    const mainBranch = execFileSync('git', ['branch', '--show-current'], {
      cwd: repository,
      encoding: 'utf8',
    }).trim()

    execFileSync('git', ['checkout', '--quiet', '-b', 'side'], { cwd: repository })
    writeFileSync(path.join(repository, 'side.txt'), 'side\n')
    execFileSync('git', ['add', 'side.txt'], { cwd: repository })
    execFileSync('git', ['commit', '--quiet', '-m', 'side'], { cwd: repository })
    const side = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repository,
      encoding: 'utf8',
    }).trim()

    execFileSync('git', ['checkout', '--quiet', mainBranch], { cwd: repository })
    writeFileSync(path.join(repository, 'main.txt'), 'main\n')
    execFileSync('git', ['add', 'main.txt'], { cwd: repository })
    execFileSync('git', ['commit', '--quiet', '-m', 'main'], { cwd: repository })
    const main = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repository,
      encoding: 'utf8',
    }).trim()
    execFileSync('git', ['merge', '--quiet', '--no-ff', 'side', '-m', 'merge'], {
      cwd: repository,
    })
    const merge = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repository,
      encoding: 'utf8',
    }).trim()
    execFileSync('git', ['commit', '--quiet', '--allow-empty', '-m', 'after merge'], {
      cwd: repository,
    })
    const after = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repository,
      encoding: 'utf8',
    }).trim()

    expect(getGitCommitRangeMembershipState(repository, main, merge, main)).toBe('included')
    expect(getGitCommitRangeMembershipState(repository, main, merge, side)).toBe('included')
    expect(getGitCommitRangeMembershipState(repository, main, merge, merge)).toBe('included')
    expect(getGitCommitRangeMembershipState(repository, main, merge, root)).toBe('excluded')
    expect(getGitCommitRangeMembershipState(repository, main, merge, after)).toBe('excluded')
    expect(getGitCommitRangeMembershipState(repository, side, main, side)).toBe('non-ancestor-range')
    expect(getGitCommitRangeMembershipState(
      repository,
      main.slice(0, 12),
      merge,
      side,
    )).toBe('unavailable')
    expect(getGitCommitRangeMembershipState(
      repository,
      main,
      merge,
      'f'.repeat(40),
    )).toBe('unavailable')
  })

  it('resolves moving revisions before consulting module-global Git caches', () => {
    const repository = createRepository()
    const initialCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repository,
      encoding: 'utf8',
    }).trim()

    expect(gitObjectExists(repository, 'later')).toBe(false)
    execFileSync('git', ['branch', 'later', initialCommit], { cwd: repository })
    expect(gitObjectExists(repository, 'later')).toBe(true)

    expect(readGitPathAtCommit(repository, 'HEAD', 'input.txt')).toEqual({
      bytes: Buffer.from('input-a\n'),
      status: 'present',
    })
    expect(readGitCommitParents(repository, 'HEAD')).toEqual([])
    writeFileSync(path.join(repository, 'input.txt'), 'input-b\n')
    execFileSync('git', ['add', 'input.txt'], { cwd: repository })
    execFileSync('git', ['commit', '--quiet', '-m', 'change input'], { cwd: repository })
    const changedCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repository,
      encoding: 'utf8',
    }).trim()
    expect(readGitPathAtCommit(repository, 'HEAD', 'input.txt')).toEqual({
      bytes: Buffer.from('input-b\n'),
      status: 'present',
    })
    expect(readGitCommitParents(repository, 'HEAD')).toEqual([initialCommit])

    execFileSync('git', ['branch', 'moving-touch', changedCommit], { cwd: repository })
    expect(gitCommitTouchesPath(repository, 'moving-touch', 'input.txt')).toBe(true)
    execFileSync('git', ['commit', '--quiet', '--allow-empty', '-m', 'empty'], {
      cwd: repository,
    })
    const emptyCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repository,
      encoding: 'utf8',
    }).trim()
    execFileSync('git', ['branch', '--force', 'moving-touch', emptyCommit], { cwd: repository })
    expect(gitCommitTouchesPath(repository, 'moving-touch', 'input.txt')).toBe(false)

    execFileSync('git', ['branch', 'moving-ancestor', changedCommit], { cwd: repository })
    execFileSync('git', ['branch', 'moving-descendant', emptyCommit], { cwd: repository })
    expect(getGitAncestryState(repository, 'moving-ancestor', 'moving-descendant')).toBe('ancestor')
    execFileSync('git', ['branch', '--force', 'moving-ancestor', emptyCommit], { cwd: repository })
    execFileSync('git', ['branch', '--force', 'moving-descendant', changedCommit], { cwd: repository })
    expect(getGitAncestryState(repository, 'moving-ancestor', 'moving-descendant')).toBe(
      'not-ancestor',
    )
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
