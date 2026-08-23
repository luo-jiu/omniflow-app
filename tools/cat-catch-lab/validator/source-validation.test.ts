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

function initializeRepository(): string {
  const repository = mkdtempSync(path.join(tmpdir(), 'cat-catch-source-ref-'))
  temporaryDirectories.push(repository)
  execFileSync('git', ['init', '--quiet'], { cwd: repository })
  execFileSync('git', ['config', 'user.email', 'validator@example.invalid'], { cwd: repository })
  execFileSync('git', ['config', 'user.name', 'Validator Test'], { cwd: repository })
  return repository
}

function createRepository(): { current: string; introducedBy: string; repository: string } {
  const repository = initializeRepository()
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

  it('rejects a later path change masquerading as the anchor introduction', () => {
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
    })).toContainEqual(expect.objectContaining({ code: 'source-anchor-preexisting-in-parent' }))
    expect(current).not.toBe(unrelatedCommit)
  })

  it('peels annotated tags before proving introduction parents', () => {
    const { current, repository } = createRepository()
    execFileSync('git', ['tag', '-a', 'false-introduction', '-m', 'annotated', current], { cwd: repository })
    const tagObject = execFileSync('git', ['rev-parse', 'refs/tags/false-introduction'], {
      cwd: repository,
      encoding: 'utf8',
    }).trim()
    const source = 'export const anchor = true\nexport const current = true\n'

    expect(validateGitSourceReference({
      commit: current,
      hashField: 'blobHash',
      issuePath: 'source',
      repositoryRoot: repository,
      requireIntroducedBy: true,
      source: {
        path: 'source.ts',
        anchor: 'anchor',
        blobHash: sha256Bytes(source),
        introducedBy: tagObject,
      },
    })).toContainEqual(expect.objectContaining({ code: 'source-anchor-preexisting-in-parent' }))
  })

  it('ignores replace refs that forge an introduction commit as a root', () => {
    const { current, repository } = createRepository()
    const currentTree = execFileSync('git', ['rev-parse', `${current}^{tree}`], {
      cwd: repository,
      encoding: 'utf8',
    }).trim()
    const forgedRoot = execFileSync('git', ['commit-tree', currentTree, '-m', 'forged root'], {
      cwd: repository,
      encoding: 'utf8',
    }).trim()
    execFileSync('git', ['replace', current, forgedRoot], { cwd: repository })
    const source = 'export const anchor = true\nexport const current = true\n'

    expect(validateGitSourceReference({
      commit: current,
      hashField: 'blobHash',
      issuePath: 'source',
      repositoryRoot: repository,
      requireIntroducedBy: true,
      source: {
        path: 'source.ts',
        anchor: 'anchor',
        blobHash: sha256Bytes(source),
        introducedBy: current,
      },
    })).toContainEqual(expect.objectContaining({ code: 'source-anchor-preexisting-in-parent' }))
  })

  it('blocks when missing history makes introduction ancestry unavailable', () => {
    const repository = initializeRepository()
    const introducedBy = commit(repository, 'export const anchor = true\n', 'introduce source')
    const missingParent = commit(
      repository,
      'export const anchor = true\nexport const middle = true\n',
      'middle source',
    )
    const currentSource = [
      'export const anchor = true',
      'export const middle = true',
      'export const current = true',
      '',
    ].join('\n')
    const current = commit(repository, currentSource, 'current source')
    rmSync(path.join(
      repository,
      '.git',
      'objects',
      missingParent.slice(0, 2),
      missingParent.slice(2),
    ))

    const issues = validateGitSourceReference({
      commit: current,
      hashField: 'blobHash',
      issuePath: 'source',
      repositoryRoot: repository,
      requireIntroducedBy: true,
      source: {
        path: 'source.ts',
        anchor: 'anchor',
        blobHash: sha256Bytes(currentSource),
        introducedBy,
      },
    })

    expect(issues).toContainEqual(expect.objectContaining({
      code: 'source-introduction-ancestry-unavailable',
      severity: 'blocker',
    }))
    expect(issues).not.toContainEqual(expect.objectContaining({
      code: 'source-introduction-after-snapshot',
    }))
  })

  it('accepts a rename as a path-local introduction when the parent path is absent', () => {
    const repository = initializeRepository()
    writeFileSync(path.join(repository, 'old-source.ts'), 'export const anchor = true\n')
    execFileSync('git', ['add', 'old-source.ts'], { cwd: repository })
    execFileSync('git', ['commit', '--quiet', '-m', 'old path'], { cwd: repository })
    execFileSync('git', ['mv', 'old-source.ts', 'source.ts'], { cwd: repository })
    execFileSync('git', ['commit', '--quiet', '-m', 'rename source'], { cwd: repository })
    const introducedBy = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repository,
      encoding: 'utf8',
    }).trim()

    expect(validateGitSourceReference({
      commit: introducedBy,
      hashField: 'blobHash',
      issuePath: 'source',
      repositoryRoot: repository,
      requireIntroducedBy: true,
      source: {
        path: 'source.ts',
        anchor: 'anchor',
        blobHash: sha256Bytes('export const anchor = true\n'),
        introducedBy,
      },
    })).toEqual([])
  })

  it('checks every direct merge parent for a preexisting anchor', () => {
    const repository = initializeRepository()
    commit(repository, 'export const baseline = true\n', 'baseline')
    const primaryBranch = execFileSync('git', ['branch', '--show-current'], {
      cwd: repository,
      encoding: 'utf8',
    }).trim()
    execFileSync('git', ['checkout', '--quiet', '-b', 'anchor-side'], { cwd: repository })
    commit(repository, 'export const baseline = true\nexport const anchor = true\n', 'side anchor')
    execFileSync('git', ['checkout', '--quiet', primaryBranch], { cwd: repository })
    writeFileSync(path.join(repository, 'main-only.ts'), 'export const mainOnly = true\n')
    execFileSync('git', ['add', 'main-only.ts'], { cwd: repository })
    execFileSync('git', ['commit', '--quiet', '-m', 'main change'], { cwd: repository })
    execFileSync('git', ['merge', '--quiet', '--no-ff', 'anchor-side', '-m', 'merge anchor'], { cwd: repository })
    const mergeCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repository,
      encoding: 'utf8',
    }).trim()
    const source = 'export const baseline = true\nexport const anchor = true\n'

    expect(validateGitSourceReference({
      commit: mergeCommit,
      hashField: 'blobHash',
      issuePath: 'source',
      repositoryRoot: repository,
      requireIntroducedBy: true,
      source: {
        path: 'source.ts',
        anchor: 'anchor',
        blobHash: sha256Bytes(source),
        introducedBy: mergeCommit,
      },
    })).toContainEqual(expect.objectContaining({ code: 'source-anchor-preexisting-in-parent' }))
  })

  it('distinguishes declarations, members, and runtime literals without substring fallbacks', () => {
    const { repository } = createRepository()
    const source = [
      'export const declaredNode = true',
      'export { reExported } from "./other.js"',
      'const object = { memberNode() { return true } }',
      'target.memberAssignment = true',
      'object.memberNode()',
      'callOnly()',
      'const stringValue = "stringOnly"',
      'const generated = `const id = \'generatedLiteral\'`',
      'const generatedRegex = `const matcher = /"regexOnly"/`',
      'const generatedDivision = `const ratio = value / "divisionLiteral"`',
      'const generatedDynamicString = `const value = "${dynamicStringOnly}"`',
      'const malformedGenerated = `this is invalid "malformedGeneratedLiteral"`',
      'const unclosedGenerated = `const value = "unclosedGeneratedLiteral`',
      'const interpolated = `${interpolatedOnly}`',
      'const prefixSimilarLong = true',
      '// commentOnly',
      '',
    ].join('\n')
    const current = commit(repository, source, 'locator source')
    const validateSymbol = (symbol: string, locatorKind?: 'declaration' | 'member' | 'runtime-literal') => (
      validateGitSourceReference({
        anchorField: 'symbol',
        commit: current,
        hashField: 'sourceHash',
        issuePath: 'source',
        repositoryRoot: repository,
        source: {
          path: 'source.ts',
          symbol,
          ...(locatorKind ? { locatorKind } : {}),
          sourceHash: sha256Bytes(source),
        },
      })
    )

    expect(validateSymbol('declaredNode')).toEqual([])
    expect(validateSymbol('reExported')).toEqual([])
    expect(validateSymbol('memberNode', 'member')).toEqual([])
    expect(validateSymbol('target.memberAssignment', 'member')).toEqual([])
    expect(validateSymbol('stringOnly', 'runtime-literal')).toEqual([])
    expect(validateSymbol('generatedLiteral', 'runtime-literal')).toEqual([])
    expect(validateSymbol('divisionLiteral', 'runtime-literal')).toEqual([])
    expect(validateSymbol('malformedGeneratedLiteral', 'runtime-literal')).toContainEqual(
      expect.objectContaining({ code: 'source-locator-unverifiable' }),
    )
    expect(validateSymbol('unclosedGeneratedLiteral', 'runtime-literal')).toContainEqual(
      expect.objectContaining({ code: 'source-locator-unverifiable' }),
    )

    for (const [symbol, locatorKind] of [
      ['memberNode', 'declaration'],
      ['callOnly', 'declaration'],
      ['stringOnly', 'declaration'],
      ['commentOnly', 'declaration'],
      ['object.memberNode', 'member'],
      ['interpolatedOnly', 'runtime-literal'],
      ['dynamicStringOnly', 'runtime-literal'],
      ['regexOnly', 'runtime-literal'],
      ['prefixSimilar', 'declaration'],
    ] as const) {
      expect(validateSymbol(symbol, locatorKind)).toContainEqual(expect.objectContaining({
        code: 'source-symbol-missing',
      }))
    }
  })

  it('rejects ambiguous declaration scopes while accepting an overload group', () => {
    const { repository } = createRepository()
    const source = [
      'export const duplicateNode = true',
      'function nestedScope() { const duplicateNode = false; return duplicateNode }',
      'const duplicateSameScope = true',
      'const duplicateSameScope = false',
      'const duplicateMembers = { repeatedMember() {}, repeatedMember() {} }',
      'function overloaded(value: string): string',
      'function overloaded(value: number): number',
      'function overloaded(value: string | number) { return value }',
      'class Accessors { get value() { return 1 } set value(next: number) { void next } }',
      '',
    ].join('\n')
    const current = commit(repository, source, 'ambiguous locators')
    const validateSymbol = (symbol: string) => validateGitSourceReference({
      anchorField: 'symbol',
      commit: current,
      hashField: 'sourceHash',
      issuePath: 'source',
      repositoryRoot: repository,
      source: {
        path: 'source.ts',
        symbol,
        sourceHash: sha256Bytes(source),
      },
    })

    expect(validateSymbol('duplicateNode')).toContainEqual(expect.objectContaining({
      code: 'source-locator-ambiguous',
    }))
    expect(validateSymbol('duplicateSameScope')).toContainEqual(expect.objectContaining({
      code: 'source-locator-ambiguous',
    }))
    expect(validateGitSourceReference({
      anchorField: 'symbol',
      commit: current,
      hashField: 'sourceHash',
      issuePath: 'source',
      repositoryRoot: repository,
      source: {
        path: 'source.ts',
        symbol: 'repeatedMember',
        locatorKind: 'member',
        sourceHash: sha256Bytes(source),
      },
    })).toContainEqual(expect.objectContaining({ code: 'source-locator-ambiguous' }))
    expect(validateSymbol('overloaded')).toEqual([])
    expect(validateGitSourceReference({
      anchorField: 'symbol',
      commit: current,
      hashField: 'sourceHash',
      issuePath: 'source',
      repositoryRoot: repository,
      source: {
        path: 'source.ts',
        symbol: 'value',
        locatorKind: 'member',
        sourceHash: sha256Bytes(source),
      },
    })).toEqual([])
  })
})
