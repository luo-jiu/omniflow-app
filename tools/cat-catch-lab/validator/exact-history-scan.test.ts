import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  CHANGED_BLOB_LITERAL_PROFILE,
  COMMIT_MESSAGE_LITERAL_PROFILE,
  scanExactGitHistory,
  type ExactHistoryScanBudgetOverrides,
  type ExactHistoryScanIssueCode,
  type ExactHistoryTouchset,
} from './exact-history-scan.ts'
import { sha256Bytes } from './json.ts'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true })
  }
})

function initializeRepository(): string {
  const repository = mkdtempSync(path.join(tmpdir(), 'cat-catch-exact-history-'))
  temporaryDirectories.push(repository)
  execFileSync('git', ['init', '--quiet', '--initial-branch=main'], { cwd: repository })
  execFileSync('git', ['config', 'user.email', 'validator@example.invalid'], { cwd: repository })
  execFileSync('git', ['config', 'user.name', 'Validator Test'], { cwd: repository })
  return repository
}

function write(repository: string, relativePath: string, source: string | Buffer): void {
  mkdirSync(path.dirname(path.join(repository, relativePath)), { recursive: true })
  writeFileSync(path.join(repository, relativePath), source)
}

function commit(repository: string, message: string): string {
  execFileSync('git', ['add', '-A'], { cwd: repository })
  execFileSync('git', ['commit', '--quiet', '-m', message], { cwd: repository })
  return execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: repository,
    encoding: 'utf8',
  }).trim()
}

function touchset(
  fromCommit: string,
  throughCommit: string,
  overrides: Partial<ExactHistoryTouchset> = {},
): ExactHistoryTouchset {
  return {
    fromCommit,
    id: 'history.default',
    pathScopes: ['scope'],
    queries: [{
      id: 'query.message',
      literal: 'needle',
      profile: COMMIT_MESSAGE_LITERAL_PROFILE,
    }],
    throughCommit,
    ...overrides,
  }
}

function createRawCommit(
  repository: string,
  treeId: string,
  message: Buffer,
  parentIds: string[] = [],
): string {
  const headers = Buffer.from([
    `tree ${treeId}`,
    ...parentIds.map(parentId => `parent ${parentId}`),
    'author Validator Test <validator@example.invalid> 1 +0000',
    'committer Validator Test <validator@example.invalid> 1 +0000',
    '',
    '',
  ].join('\n'))
  return execFileSync('git', ['hash-object', '-t', 'commit', '-w', '--stdin'], {
    cwd: repository,
    encoding: 'utf8',
    input: Buffer.concat([headers, message]),
  }).trim()
}

function createScopedBlobTree(
  repository: string,
  blobId: string,
  allowMissing = false,
): string {
  const nestedTree = execFileSync('git', [
    'mktree',
    ...(allowMissing ? ['--missing'] : []),
  ], {
    cwd: repository,
    encoding: 'utf8',
    input: `100644 blob ${blobId}\tfile.txt\n`,
  }).trim()
  return execFileSync('git', ['mktree'], {
    cwd: repository,
    encoding: 'utf8',
    input: `040000 tree ${nestedTree}\tscope\n`,
  }).trim()
}

describe('exact Git historical touchset scan', () => {
  it('compares a root commit against the empty tree and binds message and blob sources', () => {
    const repository = initializeRepository()
    write(repository, 'scope/root.txt', 'π root blob needle\n')
    const root = commit(repository, 'π root message needle')
    const result = scanExactGitHistory(repository, touchset(root, root, {
      queries: [
        {
          id: 'query.blob',
          literal: 'blob needle',
          profile: CHANGED_BLOB_LITERAL_PROFILE,
        },
        {
          id: 'query.message',
          literal: 'message needle',
          profile: COMMIT_MESSAGE_LITERAL_PROFILE,
        },
      ],
    }))

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('root history fixture did not scan')
    expect(result.result.changes).toEqual([expect.objectContaining({
      after: expect.objectContaining({
        commitId: root,
        rawSourceHash: sha256Bytes('π root blob needle\n'),
      }),
      afterCommitId: root,
      before: null,
      beforeCommitId: null,
      kind: 'add',
      path: 'scope/root.txt',
    })])
    expect(result.result.queryHits).toEqual(expect.arrayContaining([
      expect.objectContaining({
        commitId: root,
        path: 'scope/root.txt',
        queryId: 'query.blob',
        side: 'after',
      }),
      expect.objectContaining({
        commitId: root,
        path: null,
        queryId: 'query.message',
        side: 'commit-message',
      }),
    ]))
    expect(result.result.commits[0]).toEqual(expect.objectContaining({
      commitId: root,
      messageRawSourceHash: sha256Bytes('π root message needle\n'),
      parentCommitIds: [],
    }))
  })

  it('reports linear add, modify, and delete without leaking sibling path prefixes', () => {
    const repository = initializeRepository()
    write(repository, 'scope/modify.txt', 'before\n')
    write(repository, 'scope/delete.txt', 'delete\n')
    write(repository, 'scope-other/outside.txt', 'before\n')
    const root = commit(repository, 'root')

    write(repository, 'scope/modify.txt', 'after\n')
    rmSync(path.join(repository, 'scope/delete.txt'))
    write(repository, 'scope/add.txt', 'add\n')
    write(repository, 'scope-other/outside.txt', 'after\n')
    const second = commit(repository, 'linear needle')
    const result = scanExactGitHistory(repository, touchset(second, second))

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('linear history fixture did not scan')
    expect(result.result.commits.map(item => item.commitId)).toEqual([second])
    expect(result.result.changes.map(change => [change.path, change.kind])).toEqual([
      ['scope/add.txt', 'add'],
      ['scope/delete.txt', 'delete'],
      ['scope/modify.txt', 'modify'],
    ])
    expect(result.result.changes.every(change => change.beforeCommitId === root)).toBe(true)
  })

  it('does not satisfy a scoped message query with an out-of-scope-only commit', () => {
    const repository = initializeRepository()
    write(repository, 'scope/file.txt', 'scoped\n')
    const root = commit(repository, 'root')
    write(repository, 'outside/file.txt', 'outside\n')
    const outsideOnly = commit(repository, 'outside needle')

    const result = scanExactGitHistory(repository, touchset(outsideOnly, outsideOnly))

    expect(result).toEqual(expect.objectContaining({ ok: false, result: null }))
    expect(result.issues).toEqual([expect.objectContaining({
      code: 'history-scan.query-zero-hits',
      queryId: 'query.message',
    })])
    expect(result.issues.some(item => item.commitId === root)).toBe(false)
  })

  it('checks changed blobs on both sides with independent raw-source provenance', () => {
    const repository = initializeRepository()
    write(repository, 'scope/file.txt', 'old needle\n')
    const root = commit(repository, 'root')
    write(repository, 'scope/file.txt', 'new needle\n')
    const second = commit(repository, 'second')
    const result = scanExactGitHistory(repository, touchset(second, second, {
      queries: [{
        id: 'query.blob',
        literal: 'needle',
        profile: CHANGED_BLOB_LITERAL_PROFILE,
      }],
    }))

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('blob history fixture did not scan')
    expect(result.result.queryHits.map(hit => ({
      commitId: hit.commitId,
      parentCommitId: hit.parentCommitId,
      source: hit.rawSourceHash,
      side: hit.side,
    }))).toEqual([
      {
        commitId: second,
        parentCommitId: root,
        side: 'after',
        source: sha256Bytes('new needle\n'),
      },
      {
        commitId: second,
        parentCommitId: root,
        side: 'before',
        source: sha256Bytes('old needle\n'),
      },
    ])
  })

  it('reports overlapping astral matches with exact UTF-8 byte and UTF-16 code-unit offsets', () => {
    const repository = initializeRepository()
    const source = '😀😀😀\n'
    const literal = '😀😀'
    write(repository, 'scope/file.txt', source)
    const root = commit(repository, '😀😀😀')

    const result = scanExactGitHistory(repository, touchset(root, root, {
      queries: [
        { id: 'query.blob', literal, profile: CHANGED_BLOB_LITERAL_PROFILE },
        { id: 'query.message', literal, profile: COMMIT_MESSAGE_LITERAL_PROFILE },
      ],
    }))

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('astral overlap fixture did not scan')
    for (const queryId of ['query.blob', 'query.message']) {
      expect(result.result.queryHits
        .filter(hit => hit.queryId === queryId)
        .map(hit => ({
          byteEnd: hit.byteEnd,
          byteStart: hit.byteStart,
          codeUnitEnd: hit.codeUnitEnd,
          codeUnitStart: hit.codeUnitStart,
        }))).toEqual([
        { byteEnd: 8, byteStart: 0, codeUnitEnd: 4, codeUnitStart: 0 },
        { byteEnd: 12, byteStart: 4, codeUnitEnd: 6, codeUnitStart: 2 },
      ])
    }
  })

  it('uses from-parent-excluded range semantics and compares a merge against every parent', () => {
    const repository = initializeRepository()
    write(repository, 'scope/base.txt', 'base\n')
    const root = commit(repository, 'root')

    execFileSync('git', ['checkout', '--quiet', '-b', 'side'], { cwd: repository })
    write(repository, 'scope/side.txt', 'side\n')
    const side = commit(repository, 'side needle')

    execFileSync('git', ['checkout', '--quiet', 'main'], { cwd: repository })
    write(repository, 'scope/main.txt', 'main\n')
    const main = commit(repository, 'main needle')
    execFileSync('git', ['merge', '--quiet', '--no-ff', 'side', '-m', 'merge needle'], {
      cwd: repository,
    })
    const merge = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repository,
      encoding: 'utf8',
    }).trim()

    const result = scanExactGitHistory(repository, touchset(main, merge))
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('merge history fixture did not scan')
    expect(result.result.commits.map(item => item.commitId).sort()).toEqual([main, merge, side].sort())
    expect(result.result.commits.map(item => item.commitId)).not.toContain(root)
    const mergeChanges = result.result.changes.filter(change => change.afterCommitId === merge)
    expect(new Set(mergeChanges.map(change => change.beforeCommitId))).toEqual(new Set([main, side]))
    expect(mergeChanges.map(change => [change.beforeCommitId, change.path])).toEqual(expect.arrayContaining([
      [main, 'scope/side.txt'],
      [side, 'scope/main.txt'],
    ]))
  })

  it('includes a merge fromCommit while excluding the reachable sets of all its direct parents', () => {
    const repository = initializeRepository()
    write(repository, 'scope/base.txt', 'base\n')
    const root = commit(repository, 'root')

    execFileSync('git', ['checkout', '--quiet', '-b', 'side'], { cwd: repository })
    write(repository, 'scope/side.txt', 'side\n')
    const side = commit(repository, 'side')

    execFileSync('git', ['checkout', '--quiet', 'main'], { cwd: repository })
    write(repository, 'scope/main.txt', 'main\n')
    const main = commit(repository, 'main')
    execFileSync('git', ['merge', '--quiet', '--no-ff', 'side', '-m', 'merge-from needle'], {
      cwd: repository,
    })
    const mergeFrom = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repository,
      encoding: 'utf8',
    }).trim()
    write(repository, 'scope/child.txt', 'child\n')
    const child = commit(repository, 'child needle')

    const result = scanExactGitHistory(repository, touchset(mergeFrom, child))

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('merge fromCommit fixture did not scan')
    const scannedCommitIds = result.result.commits.map(item => item.commitId)
    expect(scannedCommitIds.sort()).toEqual([child, mergeFrom].sort())
    expect(scannedCommitIds).not.toContain(root)
    expect(scannedCommitIds).not.toContain(side)
    expect(scannedCommitIds).not.toContain(main)
    expect(new Set(result.result.changes
      .filter(change => change.afterCommitId === mergeFrom)
      .map(change => change.beforeCommitId))).toEqual(new Set([main, side]))
  })

  it('binds a merge message hit only to direct parents with an in-scope difference', () => {
    const repository = initializeRepository()
    write(repository, 'scope/base.txt', 'base\n')
    commit(repository, 'root')

    execFileSync('git', ['checkout', '--quiet', '-b', 'side'], { cwd: repository })
    write(repository, 'outside/side.txt', 'side\n')
    const side = commit(repository, 'side')

    execFileSync('git', ['checkout', '--quiet', 'main'], { cwd: repository })
    write(repository, 'scope/main.txt', 'main\n')
    const main = commit(repository, 'main')
    execFileSync('git', ['merge', '--quiet', '--no-ff', 'side', '-m', 'merge needle'], {
      cwd: repository,
    })
    const merge = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repository,
      encoding: 'utf8',
    }).trim()

    const result = scanExactGitHistory(repository, touchset(merge, merge))

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('parent-associated merge fixture did not scan')
    expect(result.result.changes.map(change => [change.beforeCommitId, change.path])).toEqual([
      [side, 'scope/main.txt'],
    ])
    expect(result.result.queryHits).toEqual([expect.objectContaining({
      commitId: merge,
      parentCommitId: side,
      path: null,
      queryId: 'query.message',
      side: 'commit-message',
    })])
    expect(result.result.queryHits.some(hit => hit.parentCommitId === main)).toBe(false)
  })

  it('fails closed when any declared query has zero hits', () => {
    const repository = initializeRepository()
    write(repository, 'scope/file.txt', 'present\n')
    const root = commit(repository, 'present')
    const result = scanExactGitHistory(repository, touchset(root, root))

    expect(result).toEqual(expect.objectContaining({ ok: false, result: null }))
    expect(result.issues).toContainEqual(expect.objectContaining({
      code: 'history-scan.query-zero-hits',
      queryId: 'query.message',
    }))
  })

  it('rejects path-scope and query counts beyond the fixed scan profile before Git reads', () => {
    const commitId = 'a'.repeat(40)
    const queryResult = scanExactGitHistory(
      '/not/a/repository',
      touchset(commitId, commitId, {
        queries: [
          { id: 'query.one', literal: 'one', profile: COMMIT_MESSAGE_LITERAL_PROFILE },
          { id: 'query.two', literal: 'two', profile: COMMIT_MESSAGE_LITERAL_PROFILE },
        ],
      }),
      { maxQueries: 1 },
    )
    expect(queryResult.issues).toEqual([expect.objectContaining({
      code: 'history-scan.query-budget-exhausted',
      value: 'required=2;limit=1',
    })])
    expect(queryResult.issues.some(item => item.code === 'history-scan.commit-unavailable')).toBe(false)

    const pathResult = scanExactGitHistory(
      '/not/a/repository',
      touchset(commitId, commitId, { pathScopes: ['one', 'two'] }),
      { maxPathScopes: 1 },
    )
    expect(pathResult.issues).toEqual([expect.objectContaining({
      code: 'history-scan.path-scope-budget-exhausted',
      value: 'required=2;limit=1',
    })])
    expect(pathResult.issues.some(item => item.code === 'history-scan.commit-unavailable')).toBe(false)

    const invalidBudgetResult = scanExactGitHistory(
      '/not/a/repository',
      touchset(commitId, commitId),
      { maxHits: -1 },
    )
    expect(invalidBudgetResult.issues).toEqual([expect.objectContaining({
      code: 'history-scan.budget-invalid',
      value: 'maxHits=-1',
    })])
    expect(invalidBudgetResult.issues.some(
      item => item.code === 'history-scan.commit-unavailable',
    )).toBe(false)
  })

  it('fails closed with named issues when deterministic history expansion budgets are exhausted', () => {
    const repository = initializeRepository()
    write(repository, 'scope/file.txt', 'needle\n')
    const root = commit(repository, 'root needle')
    const cases: Array<{
      budget: ExactHistoryScanBudgetOverrides
      code: ExactHistoryScanIssueCode
    }> = [
      {
        budget: { maxAncestryCommits: 0 },
        code: 'history-scan.ancestry-commit-budget-exhausted',
      },
      {
        budget: { maxCommitBytes: 0 },
        code: 'history-scan.commit-byte-budget-exhausted',
      },
      {
        budget: { maxTreeEntries: 0 },
        code: 'history-scan.tree-entry-budget-exhausted',
      },
      {
        budget: { maxBlobObjects: 0 },
        code: 'history-scan.blob-object-budget-exhausted',
      },
      {
        budget: { maxComparedPaths: 0 },
        code: 'history-scan.compared-path-budget-exhausted',
      },
      {
        budget: { maxChanges: 0 },
        code: 'history-scan.change-budget-exhausted',
      },
      {
        budget: { maxBlobBytes: 0 },
        code: 'history-scan.blob-byte-budget-exhausted',
      },
      {
        budget: { maxSearchBytes: 0 },
        code: 'history-scan.search-byte-budget-exhausted',
      },
      {
        budget: { maxHits: 0 },
        code: 'history-scan.hit-budget-exhausted',
      },
    ]

    for (const fixture of cases) {
      const result = scanExactGitHistory(
        repository,
        touchset(root, root),
        fixture.budget,
      )
      expect(result).toEqual(expect.objectContaining({ ok: false, result: null }))
      expect(result.issues).toEqual([expect.objectContaining({ code: fixture.code })])
    }
  })

  it('accounts tree entries and blob objects incrementally across commit snapshots', () => {
    const repository = initializeRepository()
    write(repository, 'scope/file.txt', 'first needle\n')
    const root = commit(repository, 'root')
    write(repository, 'scope/file.txt', 'second needle\n')
    const second = commit(repository, 'second')
    const input = touchset(second, second, {
      queries: [{ id: 'query.blob', literal: 'needle', profile: CHANGED_BLOB_LITERAL_PROFILE }],
    })

    const treeResult = scanExactGitHistory(repository, input, { maxTreeEntries: 3 })
    expect(treeResult.issues).toEqual([expect.objectContaining({
      code: 'history-scan.tree-entry-budget-exhausted',
      value: 'required=4;limit=3',
    })])

    const blobResult = scanExactGitHistory(repository, input, { maxBlobObjects: 1 })
    expect(blobResult.issues).toEqual([expect.objectContaining({
      code: 'history-scan.blob-object-budget-exhausted',
      value: 'required=2;limit=1',
    })])

    const aggregateCommitBytes = [root, second].reduce((total, commitId) => (
      total + Number(execFileSync('git', ['cat-file', '-s', commitId], {
        cwd: repository,
        encoding: 'utf8',
      }).trim())
    ), 0)
    const commitResult = scanExactGitHistory(repository, input, {
      maxCommitBytes: aggregateCommitBytes - 1,
    })
    expect(commitResult.issues).toEqual([expect.objectContaining({
      code: 'history-scan.commit-byte-budget-exhausted',
      value: `required=${aggregateCommitBytes};limit=${aggregateCommitBytes - 1}`,
    })])
  })

  it('preflights aggregate message and blob search work before literal scanning or blob decoding', () => {
    const messageRepository = initializeRepository()
    write(messageRepository, 'scope/file.txt', 'present\n')
    const messageCommit = commit(messageRepository, 'needle needle')
    const messageByteLength = Buffer.byteLength('needle needle\n')
    const messageResult = scanExactGitHistory(messageRepository, touchset(
      messageCommit,
      messageCommit,
      {
        queries: [
          { id: 'query.message-one', literal: 'needle', profile: COMMIT_MESSAGE_LITERAL_PROFILE },
          { id: 'query.message-two', literal: 'needle', profile: COMMIT_MESSAGE_LITERAL_PROFILE },
        ],
      },
    ), { maxSearchBytes: messageByteLength * 2 - 1 })
    expect(messageResult.issues).toEqual([expect.objectContaining({
      code: 'history-scan.search-byte-budget-exhausted',
      value: `required=${messageByteLength * 2};limit=${messageByteLength * 2 - 1}`,
    })])

    const blobRepository = initializeRepository()
    const invalidBytes = Buffer.from([0x6e, 0x65, 0x65, 0x64, 0x6c, 0x65, 0xc3, 0x28])
    const invalidBlob = execFileSync('git', ['hash-object', '-w', '--stdin'], {
      cwd: blobRepository,
      encoding: 'utf8',
      input: invalidBytes,
    }).trim()
    const blobTree = createScopedBlobTree(blobRepository, invalidBlob)
    const invalidBlobCommit = execFileSync('git', ['commit-tree', blobTree, '-m', 'root'], {
      cwd: blobRepository,
      encoding: 'utf8',
    }).trim()
    const blobResult = scanExactGitHistory(blobRepository, touchset(
      invalidBlobCommit,
      invalidBlobCommit,
      {
        queries: [{ id: 'query.blob', literal: 'needle', profile: CHANGED_BLOB_LITERAL_PROFILE }],
      },
    ), { maxSearchBytes: invalidBytes.length - 1 })
    expect(blobResult.issues).toEqual([expect.objectContaining({
      code: 'history-scan.search-byte-budget-exhausted',
      value: `required=${invalidBytes.length};limit=${invalidBytes.length - 1}`,
    })])
    expect(blobResult.issues.some(issue => issue.code === 'history-scan.changed-blob-invalid-utf8')).toBe(false)
  })

  it('charges repeated blob objects once per query and reuses offsets in each change context', () => {
    const repository = initializeRepository()
    const needleSource = 'needle\n'
    const otherSource = 'other\n'
    write(repository, 'scope/file.txt', needleSource)
    commit(repository, 'root')
    write(repository, 'scope/file.txt', otherSource)
    const second = commit(repository, 'second')
    write(repository, 'scope/file.txt', needleSource)
    const third = commit(repository, 'third')
    const input = touchset(second, third, {
      queries: [{ id: 'query.blob', literal: 'needle', profile: CHANGED_BLOB_LITERAL_PROFILE }],
    })
    const uniqueSearchBytes = Buffer.byteLength(needleSource) + Buffer.byteLength(otherSource)

    const result = scanExactGitHistory(repository, input, { maxSearchBytes: uniqueSearchBytes })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('blob occurrence cache fixture did not scan')
    const contextualHits = result.result.queryHits.map(hit => ({
      commitId: hit.commitId,
      parentCommitId: hit.parentCommitId,
      side: hit.side,
    }))
    expect(contextualHits).toHaveLength(2)
    expect(contextualHits).toEqual(expect.arrayContaining([
      { commitId: second, parentCommitId: expect.any(String), side: 'before' },
      { commitId: third, parentCommitId: second, side: 'after' },
    ]))

    const exhausted = scanExactGitHistory(repository, input, { maxSearchBytes: uniqueSearchBytes - 1 })
    expect(exhausted.issues).toEqual([expect.objectContaining({
      code: 'history-scan.search-byte-budget-exhausted',
      value: `required=${uniqueSearchBytes};limit=${uniqueSearchBytes - 1}`,
    })])
  })

  it('fails closed when commit-message hits cannot resolve a declared path scope', () => {
    const repository = initializeRepository()
    write(repository, 'scope/file.txt', 'present\n')
    const root = commit(repository, 'needle')
    const result = scanExactGitHistory(repository, touchset(root, root, {
      pathScopes: ['scope', 'scope-typo'],
    }))

    expect(result).toEqual(expect.objectContaining({ ok: false, result: null }))
    expect(result.issues).toEqual([expect.objectContaining({
      code: 'history-scan.path-scope-unresolved',
      path: 'scope-typo',
      value: 'scope-typo',
    })])
    expect(result.issues.some(item => item.code === 'history-scan.query-zero-hits')).toBe(false)
  })

  it('fails closed when a traversed direct parent object is missing', () => {
    const repository = initializeRepository()
    const tree = execFileSync('git', ['mktree'], {
      cwd: repository,
      encoding: 'utf8',
      input: '',
    }).trim()
    const missingParent = 'f'.repeat(40)
    const commitId = createRawCommit(repository, tree, Buffer.from('needle\n'), [missingParent])
    const result = scanExactGitHistory(repository, touchset(commitId, commitId))

    expect(result).toEqual(expect.objectContaining({ ok: false, result: null }))
    expect(result.issues).toContainEqual(expect.objectContaining({
      code: 'history-scan.commit-unavailable',
      commitId: missingParent,
    }))

    const missingTreeCommit = createRawCommit(
      repository,
      'e'.repeat(40),
      Buffer.from('needle\n'),
    )
    const treeResult = scanExactGitHistory(
      repository,
      touchset(missingTreeCommit, missingTreeCommit),
    )
    expect(treeResult).toEqual(expect.objectContaining({ ok: false, result: null }))
    expect(treeResult.issues).toContainEqual(expect.objectContaining({
      code: 'history-scan.tree-unavailable',
      commitId: missingTreeCommit,
    }))
  })

  it('fails closed when a changed or unchanged in-scope blob object is missing', () => {
    const repository = initializeRepository()
    const missingBlob = 'f'.repeat(40)
    const tree = createScopedBlobTree(repository, missingBlob, true)
    const commitId = execFileSync('git', ['commit-tree', tree, '-m', 'needle'], {
      cwd: repository,
      encoding: 'utf8',
    }).trim()
    const result = scanExactGitHistory(repository, touchset(commitId, commitId))

    expect(result).toEqual(expect.objectContaining({ ok: false, result: null }))
    expect(result.issues).toContainEqual(expect.objectContaining({
      code: 'history-scan.blobs-unavailable',
    }))

    const childCommit = execFileSync('git', [
      'commit-tree',
      tree,
      '-p',
      commitId,
      '-m',
      'child needle',
    ], {
      cwd: repository,
      encoding: 'utf8',
    }).trim()
    const unchangedResult = scanExactGitHistory(repository, touchset(childCommit, childCommit))
    expect(unchangedResult).toEqual(expect.objectContaining({ ok: false, result: null }))
    expect(unchangedResult.issues).toContainEqual(expect.objectContaining({
      code: 'history-scan.blobs-unavailable',
    }))
  })

  it('fails closed on invalid UTF-8 in commit messages and scanned blobs', () => {
    const messageRepository = initializeRepository()
    const emptyTree = execFileSync('git', ['mktree'], {
      cwd: messageRepository,
      encoding: 'utf8',
      input: '',
    }).trim()
    const invalidMessageCommit = createRawCommit(
      messageRepository,
      emptyTree,
      Buffer.from([0x6e, 0x65, 0x65, 0x64, 0x6c, 0x65, 0xc3, 0x28]),
    )
    const budgetedMessageResult = scanExactGitHistory(
      messageRepository,
      touchset(invalidMessageCommit, invalidMessageCommit),
      { maxCommitBytes: 0 },
    )
    expect(budgetedMessageResult.issues).toEqual([expect.objectContaining({
      code: 'history-scan.commit-byte-budget-exhausted',
    })])
    expect(budgetedMessageResult.issues.some(
      item => item.code === 'history-scan.commit-message-invalid-utf8',
    )).toBe(false)

    const messageResult = scanExactGitHistory(
      messageRepository,
      touchset(invalidMessageCommit, invalidMessageCommit),
    )
    expect(messageResult.issues).toContainEqual(expect.objectContaining({
      code: 'history-scan.commit-message-invalid-utf8',
      commitId: invalidMessageCommit,
    }))

    const blobRepository = initializeRepository()
    const invalidBlob = execFileSync('git', ['hash-object', '-w', '--stdin'], {
      cwd: blobRepository,
      encoding: 'utf8',
      input: Buffer.from([0x6e, 0x65, 0x65, 0x64, 0x6c, 0x65, 0xc3, 0x28]),
    }).trim()
    const blobTree = createScopedBlobTree(blobRepository, invalidBlob)
    const invalidBlobCommit = execFileSync('git', ['commit-tree', blobTree, '-m', 'root'], {
      cwd: blobRepository,
      encoding: 'utf8',
    }).trim()
    const blobResult = scanExactGitHistory(blobRepository, touchset(
      invalidBlobCommit,
      invalidBlobCommit,
      {
        queries: [{
          id: 'query.blob',
          literal: 'needle',
          profile: CHANGED_BLOB_LITERAL_PROFILE,
        }],
      },
    ))
    expect(blobResult).toEqual(expect.objectContaining({ ok: false, result: null }))
    expect(blobResult.issues).toContainEqual(expect.objectContaining({
      code: 'history-scan.changed-blob-invalid-utf8',
      path: 'scope/file.txt',
    }))
  })

  it('rejects ranges whose exact from commit is not an ancestor of through', () => {
    const repository = initializeRepository()
    write(repository, 'scope/file.txt', 'first\n')
    const first = commit(repository, 'first needle')
    const tree = execFileSync('git', ['rev-parse', `${first}^{tree}`], {
      cwd: repository,
      encoding: 'utf8',
    }).trim()
    const unrelated = execFileSync('git', ['commit-tree', tree, '-m', 'unrelated needle'], {
      cwd: repository,
      encoding: 'utf8',
    }).trim()

    const result = scanExactGitHistory(repository, touchset(first, unrelated))
    expect(result).toEqual(expect.objectContaining({ ok: false, result: null }))
    expect(result.issues).toContainEqual(expect.objectContaining({
      code: 'history-scan.non-ancestor-range',
      commitId: unrelated,
      value: first,
    }))
  })

  it('rejects duplicate or empty query identity, literals, paths, and touchset identity before Git reads', () => {
    const result = scanExactGitHistory('/not/a/repository', {
      fromCommit: 'a'.repeat(40),
      id: ' ',
      pathScopes: ['', '../escape', 'back\\slash', `control${String.fromCharCode(1)}path`],
      queries: [
        { id: 'duplicate', literal: 'one', profile: COMMIT_MESSAGE_LITERAL_PROFILE },
        { id: 'duplicate', literal: 'two', profile: CHANGED_BLOB_LITERAL_PROFILE },
        { id: '', literal: '', profile: COMMIT_MESSAGE_LITERAL_PROFILE },
      ],
      throughCommit: 'b'.repeat(40),
    })

    expect(result).toEqual(expect.objectContaining({ ok: false, result: null }))
    expect(result.issues.map(item => item.code)).toEqual(expect.arrayContaining([
      'history-scan.path-scope-empty',
      'history-scan.path-scope-invalid',
      'history-scan.query-id-duplicate',
      'history-scan.query-id-empty',
      'history-scan.query-literal-empty',
      'history-scan.touchset-id-empty',
    ]))
    expect(result.issues.some(item => item.code === 'history-scan.commit-unavailable')).toBe(false)
  })

  it('is canonical across input ordering and isolated from HEAD and worktree mutations', () => {
    const repository = initializeRepository()
    write(repository, 'scope/file.txt', 'alpha\n')
    const root = commit(repository, 'root')
    write(repository, 'scope/file.txt', 'alpha changed\n')
    write(repository, 'scope/nested/file.txt', 'nested alpha\n')
    const second = commit(repository, 'beta needle')

    const firstTouchset = touchset(second, second, {
      pathScopes: ['scope/nested', 'scope'],
      queries: [
        {
          id: 'query.message',
          literal: 'beta',
          profile: COMMIT_MESSAGE_LITERAL_PROFILE,
        },
        {
          id: 'query.blob',
          literal: 'alpha',
          profile: CHANGED_BLOB_LITERAL_PROFILE,
        },
      ],
    })
    const first = scanExactGitHistory(repository, firstTouchset)
    expect(first.ok).toBe(true)

    execFileSync('git', ['checkout', '--quiet', '--detach', root], { cwd: repository })
    write(repository, 'scope/file.txt', 'worktree-only needle\n')
    write(repository, 'scope/untracked.txt', 'untracked needle\n')
    const secondScan = scanExactGitHistory(repository, touchset(second, second, {
      pathScopes: [...firstTouchset.pathScopes].reverse(),
      queries: [...firstTouchset.queries].reverse(),
    }))

    expect(secondScan).toEqual(first)
  })
})
