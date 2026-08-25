import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { validateExactCommitClosureInvariants } from './exact-closure-invariants.ts'
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
        lastKnownCommit,
        path: 'src/source.ts',
        resolution: { kind: 'current-node', refId: 'node.source' },
        sourceHash,
        symbol: 'sourceOwner',
      }],
      historicalTouchsets: [{ id: 'history.capture' }],
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
