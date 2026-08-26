import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { validateExactCommitClosureInvariants } from './exact-closure-invariants.ts'
import { DEFAULT_EXACT_HISTORY_SCAN_BUDGETS } from './exact-history-scan.ts'
import { sha256Bytes } from './json.ts'
import type { JsonObject } from './types.ts'

type TestDeclarations = {
  capabilityLedger: {
    capabilities: JsonObject[]
    cutoverUnits: JsonObject[]
  }
  inventory: {
    approvedExclusions: JsonObject[]
    bootstrapRoots: JsonObject[]
    declaredDynamicEdges: JsonObject[]
    entries: JsonObject[]
    historicalCandidates: JsonObject[]
    historicalTouchsets: JsonObject[]
    semanticScanRules: JsonObject[]
  }
}

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true })
  }
})

function commitAll(repository: string, message: string): string {
  execFileSync('git', ['add', '-A'], { cwd: repository })
  execFileSync('git', ['commit', '--quiet', '-m', message], { cwd: repository })
  return execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: repository,
    encoding: 'utf8',
  }).trim()
}

function writeDeclarations(repository: string, declarations: TestDeclarations): void {
  const contractDirectory = path.join(repository, 'docs/cat-catch')
  mkdirSync(contractDirectory, { recursive: true })
  writeFileSync(
    path.join(contractDirectory, 'capability-ledger.json'),
    `${JSON.stringify(declarations.capabilityLedger, null, 2)}\n`,
  )
  writeFileSync(
    path.join(contractDirectory, 'legacy-inventory.json'),
    `${JSON.stringify(declarations.inventory, null, 2)}\n`,
  )
}

function createDeclarations(lastKnownCommit: string, sourceHash: string): TestDeclarations {
  return {
    capabilityLedger: {
      capabilities: [{
        id: 'capture.capability',
        cutoverUnitId: 'capture',
        fixtures: ['closure.edge'],
        ownerRefs: {
          candidate: [],
          legacy: ['src/source.ts#sourceOwner'],
          targetProduction: ['src/target-owner.ts#TargetOwner'],
        },
      }],
      cutoverUnits: [{
        id: 'capture',
        dependsOn: [],
      }],
    },
    inventory: {
      approvedExclusions: [],
      bootstrapRoots: [{
        id: 'root.source',
        path: 'src/source.ts',
        symbol: 'sourceOwner',
      }],
      declaredDynamicEdges: [{
        id: 'edge.source-target',
        fixtureId: 'closure.edge',
        kind: 'event-dispatch',
        resolutionRule: 'Resolve the declared event dispatch.',
        source: { path: 'src/source.ts', symbol: 'sourceOwner' },
        sourceHash,
        target: { path: 'src/target.ts', symbol: 'targetOwner' },
      }],
      entries: [
        {
          id: 'node.source',
          entryType: 'current-node',
          path: 'src/source.ts',
          symbol: 'sourceOwner',
          sourceHash,
          capabilityId: 'capture.capability',
          cutoverUnitId: 'capture',
        },
        {
          id: 'node.target',
          entryType: 'current-node',
          path: 'src/target.ts',
          symbol: 'targetOwner',
          sourceHash: `sha256:${'2'.repeat(64)}`,
          capabilityId: 'capture.capability',
          cutoverUnitId: 'capture',
        },
      ],
      historicalCandidates: [{
        id: 'historical.source',
        discoveryEvidence: {
          kind: 'changed-blob-query-hit',
          queryId: 'history.capture.source',
          queryHit: {
            byteEnd: 27,
            byteStart: 16,
            commitId: lastKnownCommit,
            parentCommitId: null,
            path: 'src/source.ts',
            rawSourceHash: sourceHash,
            side: 'after',
          },
        },
        lastKnownCommit,
        path: 'src/source.ts',
        resolution: { kind: 'current-node', refId: 'node.source' },
        sourceHash,
        symbol: 'sourceOwner',
        touchsetId: 'history.capture',
      }],
      historicalTouchsets: [{
        id: 'history.capture',
        fromCommit: lastKnownCommit,
        pathScopes: ['src'],
        queries: [{
          id: 'history.capture.source',
          literal: 'sourceOwner',
          profile: 'changed-blob-literal-v1',
        }],
        throughCommit: lastKnownCommit,
      }],
      semanticScanRules: [{ id: 'scan.capture' }],
    },
  }
}

function createSnapshot(
  mutate?: (declarations: TestDeclarations) => void,
): { commit: string; declarations: TestDeclarations; repository: string } {
  const repository = mkdtempSync(path.join(tmpdir(), 'cat-catch-exact-invariants-'))
  temporaryDirectories.push(repository)
  execFileSync('git', ['init', '--quiet'], { cwd: repository })
  execFileSync('git', ['config', 'user.email', 'validator@example.invalid'], { cwd: repository })
  execFileSync('git', ['config', 'user.name', 'Validator Test'], { cwd: repository })
  const historicalSource = 'export function sourceOwner(): void {}\n'
  mkdirSync(path.join(repository, 'src'), { recursive: true })
  writeFileSync(path.join(repository, 'src/source.ts'), historicalSource)
  commitAll(repository, 'historical baseline')
  const historicalCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: repository,
    encoding: 'utf8',
  }).trim()
  const declarations = createDeclarations(historicalCommit, sha256Bytes(historicalSource))
  mutate?.(declarations)
  writeDeclarations(repository, declarations)
  return {
    commit: commitAll(repository, 'closure declarations'),
    declarations,
    repository,
  }
}

function addRetiredTombstone(
  repository: string,
  declarations: TestDeclarations,
  deletionKind: 'linear' | 'merge' = 'linear',
): { commit: string; deletionCommit: string; tombstone: JsonObject } {
  const retiredPath = path.join(repository, 'src/retired.ts')
  const retiredSource = 'export function retiredOwner(): void {}\n'
  writeFileSync(retiredPath, retiredSource)
  commitAll(repository, 'add retired owner')

  let deletionCommit: string
  if (deletionKind === 'merge') {
    const mainBranch = execFileSync('git', ['branch', '--show-current'], {
      cwd: repository,
      encoding: 'utf8',
    }).trim()
    execFileSync('git', ['checkout', '--quiet', '-b', 'retirement-side'], { cwd: repository })
    writeFileSync(path.join(repository, 'src/retirement-side.ts'), 'export const retirementSide = true\n')
    commitAll(repository, 'add retirement side')
    execFileSync('git', ['checkout', '--quiet', mainBranch], { cwd: repository })
    writeFileSync(path.join(repository, 'src/retirement-main.ts'), 'export const retirementMain = true\n')
    commitAll(repository, 'add retirement main')
    execFileSync('git', ['merge', '--quiet', '--no-commit', '--no-ff', 'retirement-side'], {
      cwd: repository,
    })
    rmSync(retiredPath)
    deletionCommit = commitAll(repository, 'merge retired owner deletion')
  } else {
    rmSync(retiredPath)
    deletionCommit = commitAll(repository, 'delete retired owner')
  }

  const tombstone: JsonObject = {
    id: 'node.retired-owner',
    entryType: 'retired-tombstone',
    path: 'src/retired.ts',
    symbol: 'retiredOwner',
    locatorKind: 'declaration',
    deletedSourceHash: sha256Bytes(retiredSource),
    capabilityId: 'capture.capability',
    cutoverUnitId: 'capture',
    deletionCommit,
    deletionEvidenceRef: {
      artifactId: 'evidence.retired-owner',
      artifactSchemaId: 'https://omniflow.local/schemas/cat-catch/evidence-artifact.schema.json',
      contentHash: sha256Bytes('retired owner evidence'),
    },
    provenanceRefs: ['test:retired-owner'],
  }
  declarations.inventory.entries.push(tombstone)
  writeDeclarations(repository, declarations)
  return {
    commit: commitAll(repository, 'declare retired owner tombstone'),
    deletionCommit,
    tombstone,
  }
}

function issueCodes(repository: string, commit: string): string[] {
  return validateExactCommitClosureInvariants(repository, commit).issues.map(issue => issue.code)
}

describe('exact-commit Cat Catch closure invariants', () => {
  it('accepts a structurally coherent exact-commit declaration snapshot', () => {
    const { commit, repository } = createSnapshot()

    expect(validateExactCommitClosureInvariants(repository, commit)).toEqual({
      canGenerateReport: true,
      exactCommit: commit,
      issues: [],
    })
  })

  it('accepts a lower-bound modify before-side source proven by the exact change', () => {
    const snapshot = createSnapshot()
    const beforeSource = [
      'export function sourceOwner(): void {}',
      'export const lowerBoundMarker = true',
      '',
    ].join('\n')
    const afterSource = [
      'export function sourceOwner(): void {}',
      'export const currentMarker = true',
      '',
    ].join('\n')
    writeFileSync(path.join(snapshot.repository, 'src/source.ts'), beforeSource)
    const beforeCommit = commitAll(snapshot.repository, 'add lower-bound marker')
    writeFileSync(path.join(snapshot.repository, 'src/source.ts'), afterSource)
    const changeCommit = commitAll(snapshot.repository, 'replace lower-bound marker')

    const candidate = snapshot.declarations.inventory.historicalCandidates[0]
    const touchset = snapshot.declarations.inventory.historicalTouchsets[0]
    const sourceEntry = snapshot.declarations.inventory.entries[0]
    const dynamicEdge = snapshot.declarations.inventory.declaredDynamicEdges[0]
    if (!candidate || !touchset || !sourceEntry || !dynamicEdge) {
      throw new Error('lower-bound modify fixtures are unavailable')
    }
    const literal = 'lowerBoundMarker'
    const byteStart = beforeSource.indexOf(literal)
    const beforeSourceHash = sha256Bytes(beforeSource)
    candidate.lastKnownCommit = beforeCommit
    candidate.sourceHash = beforeSourceHash
    candidate.discoveryEvidence = {
      kind: 'changed-blob-query-hit',
      queryId: 'history.capture.lower-bound-modify',
      queryHit: {
        byteEnd: byteStart + literal.length,
        byteStart,
        commitId: changeCommit,
        parentCommitId: beforeCommit,
        path: 'src/source.ts',
        rawSourceHash: beforeSourceHash,
        side: 'before',
      },
    }
    touchset.fromCommit = changeCommit
    touchset.throughCommit = changeCommit
    touchset.queries = [{
      id: 'history.capture.lower-bound-modify',
      literal,
      profile: 'changed-blob-literal-v1',
    }]
    sourceEntry.sourceHash = sha256Bytes(afterSource)
    dynamicEdge.sourceHash = sha256Bytes(afterSource)
    writeDeclarations(snapshot.repository, snapshot.declarations)
    const selectedCommit = commitAll(snapshot.repository, 'bind lower-bound modify source')

    expect(validateExactCommitClosureInvariants(snapshot.repository, selectedCommit)).toEqual({
      canGenerateReport: true,
      exactCommit: selectedCommit,
      issues: [],
    })
  })

  it('accepts a lower-bound delete before-side source resolved by an exclusion', () => {
    const snapshot = createSnapshot()
    const deletedSource = 'export function deletedOwner(): void {}\n'
    const deletedPath = path.join(snapshot.repository, 'src/deleted.ts')
    writeFileSync(deletedPath, deletedSource)
    const beforeCommit = commitAll(snapshot.repository, 'add lower-bound deleted source')
    rmSync(deletedPath)
    const deletionCommit = commitAll(snapshot.repository, 'delete lower-bound source')
    const literal = 'deletedOwner'
    const byteStart = deletedSource.indexOf(literal)
    const deletedSourceHash = sha256Bytes(deletedSource)

    snapshot.declarations.inventory.historicalTouchsets.push({
      id: 'history.lower-bound-delete',
      fromCommit: deletionCommit,
      throughCommit: deletionCommit,
      pathScopes: ['src/deleted.ts'],
      queries: [{
        id: 'history.lower-bound-delete.source',
        literal,
        profile: 'changed-blob-literal-v1',
      }],
    })
    snapshot.declarations.inventory.historicalCandidates.push({
      id: 'historical.lower-bound-deleted-source',
      touchsetId: 'history.lower-bound-delete',
      path: 'src/deleted.ts',
      symbol: 'deletedOwner',
      lastKnownCommit: beforeCommit,
      sourceHash: deletedSourceHash,
      discoveryEvidence: {
        kind: 'changed-blob-query-hit',
        queryId: 'history.lower-bound-delete.source',
        queryHit: {
          byteEnd: byteStart + literal.length,
          byteStart,
          commitId: deletionCommit,
          parentCommitId: beforeCommit,
          path: 'src/deleted.ts',
          rawSourceHash: deletedSourceHash,
          side: 'before',
        },
      },
      resolution: {
        kind: 'approved-exclusion',
        refId: 'exclusion.lower-bound-deleted-source',
      },
    })
    snapshot.declarations.inventory.approvedExclusions.push({
      id: 'exclusion.lower-bound-deleted-source',
      candidateKind: 'historical',
      path: 'src/deleted.ts',
      symbol: 'deletedOwner',
    })
    writeDeclarations(snapshot.repository, snapshot.declarations)
    const selectedCommit = commitAll(snapshot.repository, 'bind lower-bound deleted source')

    expect(validateExactCommitClosureInvariants(snapshot.repository, selectedCommit)).toEqual({
      canGenerateReport: true,
      exactCommit: selectedCommit,
      issues: [],
    })
  })

  it('rejects duplicate inventory ids and typed locators', () => {
    const { commit, repository } = createSnapshot(declarations => {
      declarations.inventory.entries.push({
        ...declarations.inventory.entries[0],
      })
    })

    expect(issueCodes(repository, commit)).toEqual(expect.arrayContaining([
      'exact-closure-duplicate-id',
      'exact-closure-duplicate-locator',
    ]))
    expect(validateExactCommitClosureInvariants(repository, commit).canGenerateReport).toBe(false)
  })

  it('rejects legacy owner refs attributed to another capability', () => {
    const { commit, repository } = createSnapshot(declarations => {
      declarations.capabilityLedger.capabilities.push({
        id: 'other.capability',
        cutoverUnitId: 'capture',
        fixtures: ['closure.edge'],
        ownerRefs: { candidate: [], legacy: [], targetProduction: [] },
      })
      const source = declarations.inventory.entries[0]
      if (source) source.capabilityId = 'other.capability'
    })

    expect(issueCodes(repository, commit)).toContain(
      'exact-closure-legacy-owner-capability-mismatch',
    )
  })

  it.each([
    ['missing ref', (candidate: JsonObject) => {
      candidate.resolution = { kind: 'current-node', refId: 'node.missing' }
    }, 'exact-closure-historical-resolution-ref-invalid'],
    ['wrong locator', (candidate: JsonObject) => {
      candidate.resolution = { kind: 'current-node', refId: 'node.target' }
    }, 'exact-closure-historical-resolution-locator-mismatch'],
  ] as const)('rejects a historical resolution with %s', (_label, mutate, expectedCode) => {
    const { commit, repository } = createSnapshot(declarations => {
      const candidate = declarations.inventory.historicalCandidates[0]
      if (candidate) mutate(candidate)
    })

    expect(issueCodes(repository, commit)).toContain(expectedCode)
  })

  it.each([
    ['missing', (declarations: TestDeclarations) => {
      const candidate = declarations.inventory.historicalCandidates[0]
      if (candidate) delete candidate.touchsetId
    }],
    ['dangling', (declarations: TestDeclarations) => {
      const candidate = declarations.inventory.historicalCandidates[0]
      if (candidate) candidate.touchsetId = 'history.missing'
    }],
    ['duplicate', (declarations: TestDeclarations) => {
      declarations.inventory.historicalTouchsets.push({
        id: 'history.capture',
        variant: 'duplicate-id',
      })
    }],
  ] as const)('rejects a %s historical touchset reference', (_label, mutate) => {
    const { commit, repository } = createSnapshot(mutate)

    expect(issueCodes(repository, commit)).toContain(
      'exact-closure-historical-touchset-ref-invalid',
    )
    expect(validateExactCommitClosureInvariants(repository, commit).canGenerateReport).toBe(false)
  })

  it.each([
    ['query id', (evidence: JsonObject) => {
      evidence.queryId = 'history.missing'
    }, 'exact-closure-historical-evidence-query-ref-invalid'],
    ['hit side', (evidence: JsonObject) => {
      const hit = evidence.queryHit as JsonObject
      hit.side = 'before'
    }, 'exact-closure-historical-evidence-query-hit-unproven'],
    ['hit hash', (evidence: JsonObject) => {
      const hit = evidence.queryHit as JsonObject
      hit.rawSourceHash = `sha256:${'0'.repeat(64)}`
    }, 'exact-closure-historical-evidence-query-hit-unproven'],
  ] as const)('rejects historical discovery evidence with the wrong %s', (
    _label,
    mutate,
    expectedCode,
  ) => {
    const { commit, repository } = createSnapshot(declarations => {
      const candidate = declarations.inventory.historicalCandidates[0]
      const evidence = candidate?.discoveryEvidence
      if (!candidate || !evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
        throw new Error('historical evidence fixture is unavailable')
      }
      mutate(evidence as JsonObject)
    })

    expect(issueCodes(repository, commit)).toContain(expectedCode)
  })

  it('rejects two historical candidates that reuse one exact query hit', () => {
    const { commit, repository } = createSnapshot(declarations => {
      const candidate = declarations.inventory.historicalCandidates[0]
      if (!candidate) throw new Error('historical candidate fixture is unavailable')
      declarations.inventory.historicalCandidates.push({
        ...structuredClone(candidate),
        id: 'historical.source-duplicate-hit',
      })
    })

    expect(issueCodes(repository, commit)).toContain(
      'exact-closure-historical-evidence-query-hit-reused',
    )
  })

  it('rejects one physical historical hit reused through a different query id', () => {
    const { commit, repository } = createSnapshot(declarations => {
      const candidate = declarations.inventory.historicalCandidates[0]
      const touchset = declarations.inventory.historicalTouchsets[0]
      const query = touchset?.queries
      if (!candidate || !touchset || !Array.isArray(query) || !query[0]) {
        throw new Error('historical query-hit fixtures are unavailable')
      }
      const aliasQueryId = 'history.capture.source-alias'
      query.push({ ...structuredClone(query[0]), id: aliasQueryId })
      const duplicateCandidate = structuredClone(candidate)
      duplicateCandidate.id = 'historical.source-query-alias'
      const duplicateEvidence = duplicateCandidate.discoveryEvidence
      if (!duplicateEvidence || typeof duplicateEvidence !== 'object' || Array.isArray(duplicateEvidence)) {
        throw new Error('historical discovery evidence fixture is unavailable')
      }
      (duplicateEvidence as JsonObject).queryId = aliasQueryId
      declarations.inventory.historicalCandidates.push(duplicateCandidate)
    })

    expect(issueCodes(repository, commit)).toContain(
      'exact-closure-historical-evidence-query-hit-reused',
    )
  })

  it('rejects one physical historical hit reused through a different touchset', () => {
    const { commit, repository } = createSnapshot(declarations => {
      const candidate = declarations.inventory.historicalCandidates[0]
      const touchset = declarations.inventory.historicalTouchsets[0]
      const query = touchset?.queries
      if (!candidate || !touchset || !Array.isArray(query) || !query[0]) {
        throw new Error('historical query-hit fixtures are unavailable')
      }
      const aliasTouchsetId = 'history.capture-alias'
      const aliasQueryId = 'history.capture-alias.source'
      declarations.inventory.historicalTouchsets.push({
        ...structuredClone(touchset),
        id: aliasTouchsetId,
        queries: [{ ...structuredClone(query[0]), id: aliasQueryId }],
      })
      const duplicateCandidate = structuredClone(candidate)
      duplicateCandidate.id = 'historical.source-touchset-alias'
      duplicateCandidate.touchsetId = aliasTouchsetId
      const duplicateEvidence = duplicateCandidate.discoveryEvidence
      if (!duplicateEvidence || typeof duplicateEvidence !== 'object' || Array.isArray(duplicateEvidence)) {
        throw new Error('historical discovery evidence fixture is unavailable')
      }
      (duplicateEvidence as JsonObject).queryId = aliasQueryId
      declarations.inventory.historicalCandidates.push(duplicateCandidate)
    })

    expect(issueCodes(repository, commit)).toContain(
      'exact-closure-historical-evidence-query-hit-reused',
    )
  })

  it.each([
    'changed-blob-literal-v1',
    'commit-message-literal-v1',
  ] as const)('rejects one merge source occurrence reused through multiple parents for %s', profile => {
    const snapshot = createSnapshot()
    const mainBranch = execFileSync('git', ['branch', '--show-current'], {
      cwd: snapshot.repository,
      encoding: 'utf8',
    }).trim()
    execFileSync('git', ['checkout', '--quiet', '-b', 'physical-hit-side'], {
      cwd: snapshot.repository,
    })
    writeFileSync(
      path.join(snapshot.repository, 'src/physical-hit-side.ts'),
      'export const physicalHitSide = true\n',
    )
    const sideCommit = commitAll(snapshot.repository, 'add physical hit side')
    execFileSync('git', ['checkout', '--quiet', mainBranch], { cwd: snapshot.repository })
    writeFileSync(
      path.join(snapshot.repository, 'src/physical-hit-main.ts'),
      'export const physicalHitMain = true\n',
    )
    const mainCommit = commitAll(snapshot.repository, 'add physical hit main')
    execFileSync('git', [
      'merge',
      '--quiet',
      '--no-commit',
      '--no-ff',
      'physical-hit-side',
    ], { cwd: snapshot.repository })
    const mergedSource = [
      'export function sourceOwner(): void {}',
      'export const mergeMarker = true',
      '',
    ].join('\n')
    writeFileSync(path.join(snapshot.repository, 'src/source.ts'), mergedSource)
    const mergeMessage = 'merge physical occurrence'
    const mergeCommit = commitAll(snapshot.repository, mergeMessage)

    const candidate = snapshot.declarations.inventory.historicalCandidates[0]
    const touchset = snapshot.declarations.inventory.historicalTouchsets[0]
    const sourceEntry = snapshot.declarations.inventory.entries[0]
    const dynamicEdge = snapshot.declarations.inventory.declaredDynamicEdges[0]
    if (!candidate || !touchset || !sourceEntry || !dynamicEdge) {
      throw new Error('merge physical-hit fixtures are unavailable')
    }
    const queryId = `history.capture.merge-${profile}`
    const mergedSourceHash = sha256Bytes(mergedSource)
    const literal = profile === 'changed-blob-literal-v1'
      ? 'mergeMarker'
      : mergeMessage
    const byteStart = profile === 'changed-blob-literal-v1'
      ? mergedSource.indexOf(literal)
      : 0
    const rawSourceHash = profile === 'changed-blob-literal-v1'
      ? mergedSourceHash
      : sha256Bytes(`${mergeMessage}\n`)
    const evidenceForParent = (parentCommitId: string): JsonObject => (
      profile === 'changed-blob-literal-v1'
        ? {
            kind: 'changed-blob-query-hit',
            queryId,
            queryHit: {
              byteEnd: byteStart + literal.length,
              byteStart,
              commitId: mergeCommit,
              parentCommitId,
              path: 'src/source.ts',
              rawSourceHash,
              side: 'after',
            },
          }
        : {
            kind: 'commit-message-query-hit-with-path-change',
            queryId,
            queryHit: {
              byteEnd: byteStart + literal.length,
              byteStart,
              commitId: mergeCommit,
              parentCommitId,
              path: null,
              rawSourceHash,
              side: 'commit-message',
            },
            candidateSource: {
              changeCommitId: mergeCommit,
              parentCommitId,
              side: 'after',
            },
          }
    )
    candidate.lastKnownCommit = mergeCommit
    candidate.sourceHash = mergedSourceHash
    candidate.discoveryEvidence = evidenceForParent(mainCommit)
    touchset.fromCommit = mergeCommit
    touchset.throughCommit = mergeCommit
    touchset.pathScopes = ['src/source.ts']
    touchset.queries = [{ id: queryId, literal, profile }]
    sourceEntry.sourceHash = mergedSourceHash
    dynamicEdge.sourceHash = mergedSourceHash
    snapshot.declarations.inventory.historicalCandidates.push({
      ...structuredClone(candidate),
      id: `historical.source-merge-${profile}`,
      discoveryEvidence: evidenceForParent(sideCommit),
    })
    writeDeclarations(snapshot.repository, snapshot.declarations)
    const selectedCommit = commitAll(snapshot.repository, 'bind merge physical hit aliases')

    expect(issueCodes(snapshot.repository, selectedCommit)).toContain(
      'exact-closure-historical-evidence-query-hit-reused',
    )
  })

  it('rejects an exact query hit from an unrelated candidate path', () => {
    const snapshot = createSnapshot()
    const unrelatedSource = 'export const unrelatedMarker = true\n'
    writeFileSync(path.join(snapshot.repository, 'src/unrelated.ts'), unrelatedSource)
    const unrelatedCommit = commitAll(snapshot.repository, 'add unrelated historical marker')
    const candidate = snapshot.declarations.inventory.historicalCandidates[0]
    const touchset = snapshot.declarations.inventory.historicalTouchsets[0]
    if (!candidate || !touchset) throw new Error('historical evidence fixtures are unavailable')
    const literal = 'unrelatedMarker'
    const byteStart = unrelatedSource.indexOf(literal)
    touchset.throughCommit = unrelatedCommit
    touchset.queries = [{
      id: 'history.capture.unrelated',
      literal,
      profile: 'changed-blob-literal-v1',
    }]
    candidate.discoveryEvidence = {
      kind: 'changed-blob-query-hit',
      queryId: 'history.capture.unrelated',
      queryHit: {
        byteEnd: byteStart + literal.length,
        byteStart,
        commitId: unrelatedCommit,
        parentCommitId: snapshot.commit,
        path: 'src/unrelated.ts',
        rawSourceHash: sha256Bytes(unrelatedSource),
        side: 'after',
      },
    }
    writeDeclarations(snapshot.repository, snapshot.declarations)
    const selectedCommit = commitAll(snapshot.repository, 'bind unrelated historical hit')

    expect(issueCodes(snapshot.repository, selectedCommit)).toEqual(expect.arrayContaining([
      'exact-closure-historical-evidence-candidate-path-mismatch',
      'exact-closure-historical-evidence-candidate-source-unproven',
    ]))
  })

  it('rejects a candidate path that does not match its exact changed-blob hit', () => {
    const { commit, repository } = createSnapshot(declarations => {
      const candidate = declarations.inventory.historicalCandidates[0]
      if (candidate) candidate.path = 'src/target.ts'
    })

    expect(issueCodes(repository, commit)).toContain(
      'exact-closure-historical-evidence-candidate-path-mismatch',
    )
  })

  it('accepts commit-message evidence only with an exact candidate-path change selector', () => {
    const { commit, repository } = createSnapshot(declarations => {
      const candidate = declarations.inventory.historicalCandidates[0]
      const touchset = declarations.inventory.historicalTouchsets[0]
      if (!candidate || !touchset || typeof candidate.lastKnownCommit !== 'string') {
        throw new Error('historical evidence fixtures are unavailable')
      }
      touchset.queries = [{
        id: 'history.capture.commit',
        literal: 'historical baseline',
        profile: 'commit-message-literal-v1',
      }]
      candidate.discoveryEvidence = {
        kind: 'commit-message-query-hit-with-path-change',
        queryId: 'history.capture.commit',
        queryHit: {
          byteEnd: 19,
          byteStart: 0,
          commitId: candidate.lastKnownCommit,
          parentCommitId: null,
          path: null,
          rawSourceHash: sha256Bytes('historical baseline\n'),
          side: 'commit-message',
        },
        candidateSource: {
          changeCommitId: candidate.lastKnownCommit,
          parentCommitId: null,
          side: 'after',
        },
      }
    })

    expect(validateExactCommitClosureInvariants(repository, commit)).toEqual({
      canGenerateReport: true,
      exactCommit: commit,
      issues: [],
    })
  })

  it('rejects commit-message evidence correlated to a different change', () => {
    const { commit, repository } = createSnapshot(declarations => {
      const candidate = declarations.inventory.historicalCandidates[0]
      const touchset = declarations.inventory.historicalTouchsets[0]
      if (!candidate || !touchset || typeof candidate.lastKnownCommit !== 'string') {
        throw new Error('historical evidence fixtures are unavailable')
      }
      touchset.queries = [{
        id: 'history.capture.commit',
        literal: 'historical baseline',
        profile: 'commit-message-literal-v1',
      }]
      candidate.discoveryEvidence = {
        kind: 'commit-message-query-hit-with-path-change',
        queryId: 'history.capture.commit',
        queryHit: {
          byteEnd: 19,
          byteStart: 0,
          commitId: candidate.lastKnownCommit,
          parentCommitId: null,
          path: null,
          rawSourceHash: sha256Bytes('historical baseline\n'),
          side: 'commit-message',
        },
        candidateSource: {
          changeCommitId: 'f'.repeat(40),
          parentCommitId: null,
          side: 'after',
        },
      }
    })

    expect(issueCodes(repository, commit)).toContain(
      'exact-closure-historical-evidence-message-change-mismatch',
    )
  })

  it('rejects even an unreferenced touchset throughCommit on an unrelated branch', () => {
    const snapshot = createSnapshot()
    const mainBranch = execFileSync('git', ['branch', '--show-current'], {
      cwd: snapshot.repository,
      encoding: 'utf8',
    }).trim()
    execFileSync('git', ['checkout', '--quiet', '-b', 'future-touchset'], {
      cwd: snapshot.repository,
    })
    writeFileSync(
      path.join(snapshot.repository, 'src/future-touchset.ts'),
      'export const futureTouchset = true\n',
    )
    const unrelatedThroughCommit = commitAll(snapshot.repository, 'add future touchset branch')
    execFileSync('git', ['checkout', '--quiet', mainBranch], { cwd: snapshot.repository })
    snapshot.declarations.inventory.historicalTouchsets.push({
      id: 'history.future-unreferenced',
      fromCommit: unrelatedThroughCommit,
      throughCommit: unrelatedThroughCommit,
      pathScopes: ['src/future-touchset.ts'],
      queries: [{
        id: 'history.future-unreferenced.source',
        literal: 'futureTouchset',
        profile: 'changed-blob-literal-v1',
      }],
    })
    writeDeclarations(snapshot.repository, snapshot.declarations)
    const selectedCommit = commitAll(snapshot.repository, 'bind unrelated touchset through commit')

    expect(issueCodes(snapshot.repository, selectedCommit)).toContain(
      'exact-closure-historical-touchset-through-after-input',
    )
  })

  it('scans an unreferenced touchset and rejects its zero-hit query', () => {
    const snapshot = createSnapshot()
    const baselineTouchset = snapshot.declarations.inventory.historicalTouchsets[0]
    if (!baselineTouchset) throw new Error('historical touchset fixture is unavailable')
    snapshot.declarations.inventory.historicalTouchsets.push({
      id: 'history.unreferenced-zero-hit',
      fromCommit: baselineTouchset.fromCommit,
      throughCommit: baselineTouchset.throughCommit,
      pathScopes: ['src'],
      queries: [{
        id: 'history.unreferenced-zero-hit.query',
        literal: 'literal-that-does-not-exist-in-history',
        profile: 'changed-blob-literal-v1',
      }],
    })
    writeDeclarations(snapshot.repository, snapshot.declarations)
    const selectedCommit = commitAll(snapshot.repository, 'declare unreferenced zero-hit touchset')

    expect(issueCodes(snapshot.repository, selectedCommit)).toContain(
      'exact-closure-historical-touchset-scan-failed',
    )
  })

  it('apportions one fixed scan budget and skips candidate Git reads after scan failure', () => {
    const snapshot = createSnapshot()
    const candidate = snapshot.declarations.inventory.historicalCandidates[0]
    const touchset = snapshot.declarations.inventory.historicalTouchsets[0]
    if (!candidate || !touchset) throw new Error('history budget fixtures are unavailable')
    const touchsetCount = DEFAULT_EXACT_HISTORY_SCAN_BUDGETS.maxQueries + 1
    for (let index = 1; index < touchsetCount; index += 1) {
      snapshot.declarations.inventory.historicalTouchsets.push({
        ...structuredClone(touchset),
        id: `history.scan-budget-${index}`,
      })
    }
    candidate.lastKnownCommit = 'f'.repeat(40)
    writeDeclarations(snapshot.repository, snapshot.declarations)
    const selectedCommit = commitAll(snapshot.repository, 'exhaust total historical scan budget')

    const result = validateExactCommitClosureInvariants(snapshot.repository, selectedCommit)
    expect(result.issues).toContainEqual(expect.objectContaining({
      code: 'exact-closure-historical-touchset-scan-failed',
      message: expect.stringContaining('history-scan.query-budget-exhausted'),
    }))
    const codes = result.issues.map(item => item.code)
    expect(codes).not.toContain('exact-closure-historical-commit-invalid')
    expect(codes).not.toContain('exact-closure-historical-commit-unavailable')
    expect(codes).not.toContain('exact-closure-historical-source-missing')
    expect(codes).not.toContain('exact-closure-historical-source-unavailable')
  })

  it('requires a historical candidate path to match an exact touchset scope boundary', () => {
    const { commit, repository } = createSnapshot(declarations => {
      const touchset = declarations.inventory.historicalTouchsets[0]
      if (touchset) touchset.pathScopes = ['src-other']
    })

    expect(issueCodes(repository, commit)).toContain(
      'exact-closure-historical-touchset-path-mismatch',
    )
  })

  it('rejects candidates not proven by the referenced touchset scan', () => {
    const beforeRange = createSnapshot()
    const beforeTouchset = beforeRange.declarations.inventory.historicalTouchsets[0]
    if (!beforeTouchset) throw new Error('historical touchset fixture is unavailable')
    beforeTouchset.fromCommit = beforeRange.commit
    beforeTouchset.throughCommit = beforeRange.commit
    writeDeclarations(beforeRange.repository, beforeRange.declarations)
    const beforeCommit = commitAll(beforeRange.repository, 'move touchset after candidate')
    expect(issueCodes(beforeRange.repository, beforeCommit)).toContain(
      'exact-closure-historical-touchset-scan-failed',
    )

    const afterRange = createSnapshot()
    const afterCandidate = afterRange.declarations.inventory.historicalCandidates[0]
    if (!afterCandidate) throw new Error('historical candidate fixture is unavailable')
    afterCandidate.lastKnownCommit = afterRange.commit
    writeDeclarations(afterRange.repository, afterRange.declarations)
    const afterCommit = commitAll(afterRange.repository, 'move candidate after touchset')
    expect(issueCodes(afterRange.repository, afterCommit)).toContain(
      'exact-closure-historical-evidence-candidate-source-unproven',
    )
  })

  it('accepts a side-branch candidate included by from-parent-excluded merge semantics', () => {
    const snapshot = createSnapshot()
    const mainBranch = execFileSync('git', ['branch', '--show-current'], {
      cwd: snapshot.repository,
      encoding: 'utf8',
    }).trim()
    execFileSync('git', ['checkout', '--quiet', '-b', 'historical-side'], {
      cwd: snapshot.repository,
    })
    const sideSource = [
      'export function sourceOwner(): void {}',
      'export const historicalSide = true',
      '',
    ].join('\n')
    writeFileSync(path.join(snapshot.repository, 'src/source.ts'), sideSource)
    writeFileSync(
      path.join(snapshot.repository, 'src/historical-side.ts'),
      'export const historicalSide = true\n',
    )
    const sideCommit = commitAll(snapshot.repository, 'add historical side')

    execFileSync('git', ['checkout', '--quiet', mainBranch], { cwd: snapshot.repository })
    writeFileSync(
      path.join(snapshot.repository, 'src/historical-main.ts'),
      'export const historicalMain = true\n',
    )
    const fromCommit = commitAll(snapshot.repository, 'add historical main')
    execFileSync('git', [
      'merge',
      '--quiet',
      '--no-ff',
      'historical-side',
      '-m',
      'merge historical side',
    ], { cwd: snapshot.repository })
    const throughCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: snapshot.repository,
      encoding: 'utf8',
    }).trim()

    const candidate = snapshot.declarations.inventory.historicalCandidates[0]
    const touchset = snapshot.declarations.inventory.historicalTouchsets[0]
    if (!candidate || !touchset) throw new Error('historical range fixtures are unavailable')
    candidate.lastKnownCommit = sideCommit
    candidate.sourceHash = sha256Bytes(sideSource)
    candidate.discoveryEvidence = {
      kind: 'changed-blob-query-hit',
      queryId: 'history.capture.side-source',
      queryHit: {
        byteEnd: 27,
        byteStart: 16,
        commitId: sideCommit,
        parentCommitId: snapshot.commit,
        path: 'src/source.ts',
        rawSourceHash: sha256Bytes(sideSource),
        side: 'after',
      },
    }
    touchset.fromCommit = fromCommit
    touchset.queries = [{
      id: 'history.capture.side-source',
      literal: 'sourceOwner',
      profile: 'changed-blob-literal-v1',
    }]
    touchset.throughCommit = throughCommit
    writeDeclarations(snapshot.repository, snapshot.declarations)
    const selectedCommit = commitAll(snapshot.repository, 'bind merge historical candidate')

    expect(validateExactCommitClosureInvariants(snapshot.repository, selectedCommit)).toEqual({
      canGenerateReport: true,
      exactCommit: selectedCommit,
      issues: [],
    })
  })

  it('fails closed when a historical touchset range commit is unavailable', () => {
    const { commit, repository } = createSnapshot(declarations => {
      const touchset = declarations.inventory.historicalTouchsets[0]
      if (touchset) touchset.fromCommit = 'f'.repeat(40)
    })

    expect(issueCodes(repository, commit)).toContain(
      'exact-closure-historical-touchset-scan-failed',
    )
    expect(validateExactCommitClosureInvariants(repository, commit).canGenerateReport).toBe(false)
  })

  it('rejects stale historical source evidence', () => {
    const { commit, repository } = createSnapshot(declarations => {
      const candidate = declarations.inventory.historicalCandidates[0]
      if (candidate) candidate.sourceHash = `sha256:${'0'.repeat(64)}`
    })

    expect(issueCodes(repository, commit)).toContain(
      'exact-closure-historical-source-hash-mismatch',
    )
  })

  it('requires nested historical references to identify exact commit objects', () => {
    const relativeRevision = createSnapshot(declarations => {
      const candidate = declarations.inventory.historicalCandidates[0]
      if (candidate) candidate.lastKnownCommit = 'HEAD~1'
    })
    expect(issueCodes(relativeRevision.repository, relativeRevision.commit)).toContain(
      'exact-closure-historical-commit-invalid',
    )

    const tagged = createSnapshot()
    const historical = tagged.declarations.inventory.historicalCandidates[0]
    if (!historical || typeof historical.lastKnownCommit !== 'string') {
      throw new Error('historical commit fixture is unavailable')
    }
    execFileSync('git', [
      'tag',
      '-a',
      '-m',
      'historical tag fixture',
      'historical-tag-fixture',
      historical.lastKnownCommit,
    ], { cwd: tagged.repository })
    historical.lastKnownCommit = execFileSync('git', ['rev-parse', 'historical-tag-fixture^{tag}'], {
      cwd: tagged.repository,
      encoding: 'utf8',
    }).trim()
    writeDeclarations(tagged.repository, tagged.declarations)
    const taggedCommit = commitAll(tagged.repository, 'declare tag object as historical commit')
    expect(issueCodes(tagged.repository, taggedCommit)).toContain(
      'exact-closure-historical-commit-invalid',
    )
  })

  it('accepts linear and merge tombstones with exact parent source proof', () => {
    for (const deletionKind of ['linear', 'merge'] as const) {
      const snapshot = createSnapshot()
      const retired = addRetiredTombstone(
        snapshot.repository,
        snapshot.declarations,
        deletionKind,
      )
      expect(validateExactCommitClosureInvariants(snapshot.repository, retired.commit)).toEqual({
        canGenerateReport: true,
        exactCommit: retired.commit,
        issues: [],
      })
    }
  })

  it('requires tombstone deletionCommit to identify an exact commit object', () => {
    const snapshot = createSnapshot()
    const retired = addRetiredTombstone(snapshot.repository, snapshot.declarations)
    retired.tombstone.deletionCommit = 'HEAD~1'
    writeDeclarations(snapshot.repository, snapshot.declarations)
    const commit = commitAll(snapshot.repository, 'replace deletion proof with a relative revision')

    expect(issueCodes(snapshot.repository, commit)).toContain(
      'exact-closure-tombstone-deletion-commit-invalid',
    )
  })

  it('rejects a tombstone whose locator was not actually deleted', () => {
    const { commit, repository } = createSnapshot(declarations => {
      const historical = declarations.inventory.historicalCandidates[0]
      const source = declarations.inventory.entries[0]
      if (!historical || !source) throw new Error('tombstone fixture inputs are unavailable')
      declarations.inventory.entries.push({
        id: 'node.retired-source',
        entryType: 'retired-tombstone',
        path: source.path,
        symbol: source.symbol,
        deletedSourceHash: historical.sourceHash,
        capabilityId: source.capabilityId,
        cutoverUnitId: source.cutoverUnitId,
        deletionCommit: historical.lastKnownCommit,
      })
    })

    expect(issueCodes(repository, commit)).toEqual(expect.arrayContaining([
      'exact-closure-tombstone-locator-not-deleted',
      'exact-closure-tombstone-locator-current',
      'exact-closure-tombstone-parent-history-unavailable',
    ]))
  })

  it('rejects dynamic edge fixtures absent from an endpoint capability', () => {
    const { commit, repository } = createSnapshot(declarations => {
      declarations.capabilityLedger.capabilities.push({
        id: 'target.capability',
        cutoverUnitId: 'capture',
        fixtures: [],
        ownerRefs: { candidate: [], legacy: [], targetProduction: [] },
      })
      const target = declarations.inventory.entries[1]
      if (target) target.capabilityId = 'target.capability'
    })

    expect(issueCodes(repository, commit)).toContain(
      'exact-closure-dynamic-fixture-capability-mismatch',
    )
  })

  it('rejects dynamic endpoints that do not resolve to current inventory nodes', () => {
    const { commit, repository } = createSnapshot(declarations => {
      const edge = declarations.inventory.declaredDynamicEdges[0]
      if (edge) edge.target = { path: 'src/missing.ts', symbol: 'missingTarget' }
    })

    expect(issueCodes(repository, commit)).toContain(
      'exact-closure-dynamic-target-ref-invalid',
    )
  })

  it('rejects external process virtual node ids that collide with current nodes', () => {
    const { commit, repository } = createSnapshot(declarations => {
      const edge = declarations.inventory.declaredDynamicEdges[0]
      const target = declarations.inventory.entries[1]
      if (!edge || !target) throw new Error('dynamic edge fixture is unavailable')
      edge.kind = 'process-handoff'
      edge.target = { path: 'external-process/ffmpeg', symbol: null }
      target.id = 'external-process.ffmpeg'
    })

    expect(issueCodes(repository, commit)).toContain(
      'exact-closure-external-process-node-id-conflict',
    )
  })

  it('reads the selected commit instead of worktree files or HEAD', () => {
    const { commit, declarations, repository } = createSnapshot()
    declarations.inventory.entries.push({ ...declarations.inventory.entries[0] })
    writeDeclarations(repository, declarations)

    expect(validateExactCommitClosureInvariants(repository, commit).canGenerateReport).toBe(true)

    const invalidHead = commitAll(repository, 'invalid later declarations')
    expect(validateExactCommitClosureInvariants(repository, invalidHead).canGenerateReport).toBe(false)
    expect(validateExactCommitClosureInvariants(repository, commit).canGenerateReport).toBe(true)
  })

  it('requires an exact full commit id', () => {
    const { commit, repository } = createSnapshot()
    const result = validateExactCommitClosureInvariants(repository, commit.slice(0, 12))

    expect(result.canGenerateReport).toBe(false)
    expect(result.exactCommit).toBeNull()
    expect(result.issues).toContainEqual(expect.objectContaining({
      code: 'exact-closure-commit-not-exact',
      severity: 'error',
    }))
  })
})
