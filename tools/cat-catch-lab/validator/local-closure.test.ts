import { execFileSync } from 'node:child_process'
import {
  appendFileSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  hashValidatorSourceManifest,
  listGitCommitTreeEntries,
  readGitPathAtCommit,
  tryReadGitHead,
} from './git-input.ts'
import {
  createLocalClosureSchemaProjectionBlocker,
  generateCandidateLocalClosureReport,
  hashLocalClosureSourceManifestContent,
  validateCandidateLocalClosureReportAtCommit,
} from './local-closure.ts'
import { sha256Bytes } from './json.ts'
import type {
  CandidateLocalClosureReport,
  JsonObject,
  LocalClosureManifestEntry,
} from './types.ts'

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const generatedAt = '2026-08-24T00:00:00.000Z'
const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true })
  }
})

function currentHead(): string {
  const head = tryReadGitHead(appRoot)
  if (!head) throw new Error('fixture HEAD is unavailable')
  return head
}

function generate(commit = currentHead()): CandidateLocalClosureReport {
  const result = generateCandidateLocalClosureReport(appRoot, commit, generatedAt)
  expect(result.issues).toEqual([])
  if (!result.report) throw new Error('candidate local-closure report was not generated')
  return result.report
}

function exactInventory(commit: string): JsonObject {
  const state = readGitPathAtCommit(appRoot, commit, 'docs/cat-catch/legacy-inventory.json')
  if (state.status !== 'present') throw new Error('exact inventory is unavailable')
  return JSON.parse(state.bytes.toString('utf8')) as JsonObject
}

function objectArray(value: unknown): JsonObject[] {
  if (!Array.isArray(value)) throw new Error('expected an array')
  return value as JsonObject[]
}

function cloneRepository(): string {
  const parent = mkdtempSync(path.join(tmpdir(), 'cat-catch-local-closure-'))
  temporaryDirectories.push(parent)
  const repository = path.join(parent, 'repository')
  execFileSync('git', ['clone', '--quiet', '--shared', appRoot, repository])
  execFileSync('git', ['config', 'user.email', 'validator@example.invalid'], { cwd: repository })
  execFileSync('git', ['config', 'user.name', 'Validator Test'], { cwd: repository })
  return repository
}

function commitAll(repository: string, message: string): string {
  execFileSync('git', ['add', '-A'], { cwd: repository })
  execFileSync('git', ['commit', '--quiet', '-m', message], { cwd: repository })
  return execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: repository,
    encoding: 'utf8',
  }).trim()
}

describe('Cat Catch candidate local-closure generator', () => {
  it('emits a schema-valid blocked projection from exact commit blobs', () => {
    const commit = currentHead()
    const inventory = exactInventory(commit)
    const report = generate(commit)
    const currentNodes = objectArray(inventory.entries).filter(entry => entry.entryType === 'current-node')
    const roots = objectArray(inventory.bootstrapRoots)
    const dynamicEdges = objectArray(inventory.declaredDynamicEdges)
    const historicalCandidates = objectArray(inventory.historicalCandidates)

    expect(report.status).toBe('blocked')
    expect(report.validator).toEqual(expect.objectContaining({
      approvalRef: null,
      trustClassification: 'candidate-untrusted',
    }))
    expect(report.bootstrapRoots).toHaveLength(roots.length)
    expect(report.discoveredNodes).toHaveLength(roots.length)
    expect(report.discoveredNodes.every(node => node.reachability === 'reachable')).toBe(true)
    expect(new Set(report.discoveredNodes.map(node => node.nodeId))).toEqual(
      new Set(report.bootstrapRoots.map(root => root.nodeId)),
    )
    expect(report.counts.unmappedInScopeNodes).toBe(0)
    expect(report.findings.unmappedInScopeNodes).toEqual([])
    const undeterminedReachability = report.blockers.filter(blocker => (
      blocker.code === 'closure.current-node-reachability-undetermined'
    ))
    expect(undeterminedReachability).toHaveLength(currentNodes.length - roots.length)
    const undeterminedIds = new Set(undeterminedReachability.map(blocker => blocker.refId))
    for (const node of currentNodes) {
      if (
        typeof node.id === 'string'
        && typeof node.capabilityId === 'string'
        && typeof node.cutoverUnitId === 'string'
        && !report.discoveredNodes.some(discovered => discovered.nodeId === node.id)
      ) {
        expect(undeterminedIds.has(node.id)).toBe(true)
      }
    }
    expect(report.declaredDynamicEdges).toHaveLength(dynamicEdges.length)
    expect(report.edges).toEqual([])
    expect(report.semanticCandidates).toEqual([])
    expect(report.historicalCandidates).toHaveLength(historicalCandidates.length)
    expect(report.blockers.map(blocker => blocker.code)).toEqual(expect.arrayContaining([
      'closure.candidate-untrusted',
      'closure.discovery-engine-unimplemented',
      'closure.schema-projection-incomplete',
    ]))
    expect(report.blockers.find(blocker => blocker.code === 'closure.schema-projection-incomplete')?.message)
      .toContain('locatorKind')
    expect(report.blockers.find(blocker => blocker.code === 'closure.schema-projection-incomplete')?.message)
      .toContain('lastKnownCommit')
    expect(report.blockers.find(blocker => blocker.code === 'closure.schema-projection-incomplete')?.message)
      .toContain('external-process virtual endpoint')
    for (const group of Object.keys(report.counts) as Array<keyof typeof report.counts>) {
      expect(report.counts[group]).toBe(report.findings[group].length)
    }
    expect(validateCandidateLocalClosureReportAtCommit(appRoot, commit, report)).toEqual([])
  })

  it('covers every exact-commit blob except report-index with stable raw metadata', () => {
    const commit = currentHead()
    const first = generate(commit)
    const second = generate(commit)
    expect(second).toEqual(first)
    expect(first.sourceManifest.entries.some(entry => (
      entry.path.startsWith('docs/cat-catch/report-index/')
    ))).toBe(false)
    expect(first.sourceManifest.exclusions).toContainEqual(expect.objectContaining({
      pathPattern: 'docs/cat-catch/report-index/**',
    }))
    const paths = first.sourceManifest.entries.map(entry => entry.path)
    const codeUnitSortedPaths = [...paths].sort((left, right) => left < right ? -1 : left > right ? 1 : 0)
    expect(paths).toEqual(codeUnitSortedPaths)
    const tree = listGitCommitTreeEntries(appRoot, commit)
    if (tree.status !== 'present') throw new Error('exact commit tree is unavailable')
    const expectedBlobs = tree.entries
      .filter(entry => (
        entry.objectType === 'blob'
        && entry.relativePath !== 'docs/cat-catch/report-index'
        && !entry.relativePath.startsWith('docs/cat-catch/report-index/')
      ))
      .sort((left, right) => (
        left.relativePath < right.relativePath ? -1 : left.relativePath > right.relativePath ? 1 : 0
      ))
      .map(entry => ({ mode: entry.mode, path: entry.relativePath }))
    expect(first.sourceManifest.entries).toHaveLength(expectedBlobs.length)
    expect(first.sourceManifest.entries.map(entry => ({ mode: entry.mode, path: entry.path })))
      .toEqual(expectedBlobs)

    const inventoryState = readGitPathAtCommit(appRoot, commit, 'docs/cat-catch/legacy-inventory.json')
    if (inventoryState.status !== 'present') throw new Error('exact inventory is unavailable')
    const manifestEntry = first.sourceManifest.entries.find(entry => (
      entry.path === 'docs/cat-catch/legacy-inventory.json'
    ))
    expect(manifestEntry).toEqual(expect.objectContaining({
      byteLength: inventoryState.bytes.length,
      contentHash: first.inputHashes.legacyInventory,
      mode: '100644',
    }))
  })

  it('does not let missing or malformed report-index data control local closure', () => {
    const repository = cloneRepository()
    const head = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repository,
      encoding: 'utf8',
    }).trim()
    const baseline = generateCandidateLocalClosureReport(repository, head, generatedAt)
    expect(baseline.issues).toEqual([])
    if (!baseline.report) throw new Error('baseline local-closure report was not generated')
    const indexPath = path.join(repository, 'docs/cat-catch/report-index/index.json')

    writeFileSync(indexPath, '{"malformed"')
    const malformedCommit = commitAll(repository, 'malform derived report index')
    const malformed = generateCandidateLocalClosureReport(repository, malformedCommit, generatedAt)
    expect(malformed.issues).toEqual([])
    expect(malformed.report?.evidenceInputTreeHash).toBe(baseline.report.evidenceInputTreeHash)
    expect(malformed.report?.sourceManifest).toEqual(baseline.report.sourceManifest)

    rmSync(indexPath)
    const missingCommit = commitAll(repository, 'remove derived report index')
    const missing = generateCandidateLocalClosureReport(repository, missingCommit, generatedAt)
    expect(missing.issues).toEqual([])
    expect(missing.report?.evidenceInputTreeHash).toBe(baseline.report.evidenceInputTreeHash)
    expect(missing.report?.sourceManifest).toEqual(baseline.report.sourceManifest)
  })

  it('uses code-unit ordering when hashing non-ASCII manifest paths', () => {
    const contentHash = `sha256:${'1'.repeat(64)}`
    const entries: LocalClosureManifestEntry[] = [
      { byteLength: 1, contentHash, mode: '100644', path: 'src/é.ts' },
      { byteLength: 1, contentHash, mode: '100644', path: 'src/z.ts' },
    ]
    const exclusions: CandidateLocalClosureReport['sourceManifest']['exclusions'] = []
    expect(hashLocalClosureSourceManifestContent({ entries, exclusions })).toBe(
      hashLocalClosureSourceManifestContent({ entries: [...entries].reverse(), exclusions }),
    )
  })

  it('keeps external process edge targets virtual and outside discovered nodes', () => {
    const report = generate()
    const externalTargets = report.declaredDynamicEdges
      .map(edge => edge.toNodeId)
      .filter(nodeId => nodeId.startsWith('external-process.'))
    expect(externalTargets.length).toBeGreaterThan(0)
    expect(report.discoveredNodes.some(node => externalTargets.includes(node.nodeId))).toBe(false)
  })

  it.each([
    ['reportId', (report: CandidateLocalClosureReport) => { report.reportId = 'local-closure.tampered' }],
    ['discoveryRulesVersion', (report: CandidateLocalClosureReport) => { report.discoveryRulesVersion = 'tampered' }],
    ['inputHashes', (report: CandidateLocalClosureReport) => {
      report.inputHashes.legacyInventory = `sha256:${'0'.repeat(64)}`
    }],
    ['status', (report: CandidateLocalClosureReport) => {
      (report as JsonObject).status = 'passed'
    }],
    ['trust', (report: CandidateLocalClosureReport) => {
      (report.validator as JsonObject).trustClassification = 'trusted'
    }],
    ['historicalRef', (report: CandidateLocalClosureReport) => {
      const candidate = report.historicalCandidates[0]
      if (candidate) candidate.resolutionRefId = 'node.nonexistent'
    }],
    ['duplicateRoot', (report: CandidateLocalClosureReport) => {
      const root = report.bootstrapRoots[0]
      if (root) report.bootstrapRoots.push({ ...root })
    }],
  ] as const)('rejects semantic tampering of %s', (_label, mutate) => {
    const commit = currentHead()
    const report = structuredClone(generate(commit))
    mutate(report)
    expect(validateCandidateLocalClosureReportAtCommit(appRoot, commit, report).length).toBeGreaterThan(0)
  })

  it('reports exact-commit inventory source hash and missing-blob blockers', () => {
    const repository = cloneRepository()
    const head = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repository,
      encoding: 'utf8',
    }).trim()
    const inventoryState = readGitPathAtCommit(repository, head, 'docs/cat-catch/legacy-inventory.json')
    if (inventoryState.status !== 'present') throw new Error('fixture inventory is unavailable')
    const inventory = JSON.parse(inventoryState.bytes.toString('utf8')) as JsonObject
    const currentNode = objectArray(inventory.entries).find(entry => entry.entryType === 'current-node')
    if (!currentNode || typeof currentNode.path !== 'string') throw new Error('fixture current node is missing')
    const sourcePath = path.join(repository, currentNode.path)

    appendFileSync(sourcePath, '\n// local-closure stale hash fixture\n')
    const mismatchCommit = commitAll(repository, 'stale inventory hash')
    const mismatch = generateCandidateLocalClosureReport(repository, mismatchCommit, generatedAt)
    expect(mismatch.issues).toEqual([])
    expect(mismatch.report?.blockers).toContainEqual(expect.objectContaining({
      code: 'closure.inventory-source-hash-mismatch',
      refId: currentNode.id,
    }))

    rmSync(sourcePath)
    const missingCommit = commitAll(repository, 'missing inventory source')
    const missing = generateCandidateLocalClosureReport(repository, missingCommit, generatedAt)
    expect(missing.issues).toEqual([])
    expect(missing.report?.blockers).toContainEqual(expect.objectContaining({
      code: 'closure.inventory-source-blob-missing',
      refId: currentNode.id,
    }))
  })

  it('does not let synchronized root and inventory declarations invent a reachable symbol', () => {
    const repository = cloneRepository()
    const head = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repository,
      encoding: 'utf8',
    }).trim()
    const inventoryState = readGitPathAtCommit(repository, head, 'docs/cat-catch/legacy-inventory.json')
    if (inventoryState.status !== 'present') throw new Error('fixture inventory is unavailable')
    const inventory = JSON.parse(inventoryState.bytes.toString('utf8')) as JsonObject
    const roots = objectArray(inventory.bootstrapRoots)
    const currentNodes = objectArray(inventory.entries).filter(entry => entry.entryType === 'current-node')
    const root = roots.find(candidate => typeof candidate.symbol === 'string')
    if (!root) throw new Error('fixture symbol root is unavailable')
    const node = currentNodes.find(candidate => (
      candidate.path === root.path
      && candidate.symbol === root.symbol
      && (candidate.locatorKind || 'declaration') === (root.locatorKind || 'declaration')
    ))
    if (!node || typeof node.id !== 'string') throw new Error('fixture root inventory node is unavailable')

    const inventedSymbol = '__omniflow_missing_bootstrap_root_symbol__'
    root.symbol = inventedSymbol
    node.symbol = inventedSymbol
    writeFileSync(
      path.join(repository, 'docs/cat-catch/legacy-inventory.json'),
      `${JSON.stringify(inventory, null, 2)}\n`,
    )
    const commit = commitAll(repository, 'invent synchronized root locator')
    const result = generateCandidateLocalClosureReport(repository, commit, generatedAt)
    expect(result.issues).toEqual([])
    if (!result.report) throw new Error('candidate local-closure report was not generated')
    expect(result.report.blockers).toContainEqual(expect.objectContaining({
      code: 'closure.inventory-source-locator-missing',
      refId: node.id,
    }))
    expect(result.report.bootstrapRoots.some(candidate => candidate.nodeId === node.id)).toBe(false)
    expect(result.report.discoveredNodes.some(candidate => candidate.nodeId === node.id)).toBe(false)
  })

  it('fails closed when a current-node source blob is not valid UTF-8', () => {
    const repository = cloneRepository()
    const head = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repository,
      encoding: 'utf8',
    }).trim()
    const inventoryState = readGitPathAtCommit(repository, head, 'docs/cat-catch/legacy-inventory.json')
    if (inventoryState.status !== 'present') throw new Error('fixture inventory is unavailable')
    const inventory = JSON.parse(inventoryState.bytes.toString('utf8')) as JsonObject
    const root = objectArray(inventory.bootstrapRoots).find(candidate => typeof candidate.symbol === 'string')
    if (!root || typeof root.path !== 'string') throw new Error('fixture symbol root is unavailable')
    const sourcePath = path.join(repository, root.path)
    const invalidBytes = Buffer.concat([readFileSync(sourcePath), Buffer.from([0xff])])
    writeFileSync(sourcePath, invalidBytes)
    for (const node of objectArray(inventory.entries)) {
      if (node.entryType === 'current-node' && node.path === root.path) {
        node.sourceHash = sha256Bytes(invalidBytes)
      }
    }
    writeFileSync(
      path.join(repository, 'docs/cat-catch/legacy-inventory.json'),
      `${JSON.stringify(inventory, null, 2)}\n`,
    )

    const commit = commitAll(repository, 'add invalid UTF-8 source fixture')
    const result = generateCandidateLocalClosureReport(repository, commit, generatedAt)
    expect(result.issues).toEqual([])
    expect(result.report?.blockers).toContainEqual(expect.objectContaining({
      code: 'closure.inventory-source-encoding-invalid',
    }))
  })

  it('counts invalid inventory capability mappings as unmapped in-scope nodes', () => {
    const repository = cloneRepository()
    const head = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repository,
      encoding: 'utf8',
    }).trim()
    const inventoryState = readGitPathAtCommit(repository, head, 'docs/cat-catch/legacy-inventory.json')
    if (inventoryState.status !== 'present') throw new Error('fixture inventory is unavailable')
    const inventory = JSON.parse(inventoryState.bytes.toString('utf8')) as JsonObject
    const root = objectArray(inventory.bootstrapRoots)[0]
    const node = objectArray(inventory.entries).find(candidate => (
      candidate.entryType === 'current-node'
      && candidate.path === root?.path
      && candidate.symbol === root?.symbol
      && (candidate.locatorKind || 'declaration') === (root?.locatorKind || 'declaration')
    ))
    if (!node || typeof node.id !== 'string') throw new Error('fixture root inventory node is unavailable')
    node.capabilityId = null
    writeFileSync(
      path.join(repository, 'docs/cat-catch/legacy-inventory.json'),
      `${JSON.stringify(inventory, null, 2)}\n`,
    )

    const commit = commitAll(repository, 'remove root capability mapping')
    const result = generateCandidateLocalClosureReport(repository, commit, generatedAt)
    expect(result.issues).toEqual([])
    expect(result.report?.counts.unmappedInScopeNodes).toBe(1)
    expect(result.report?.findings.unmappedInScopeNodes).toContainEqual(expect.objectContaining({
      code: 'closure.inventory-node-unmapped',
      refId: node.id,
    }))
    expect(result.report?.blockers).toContainEqual(expect.objectContaining({
      code: 'closure.inventory-node-unmapped',
      refId: node.id,
    }))
  })

  it('keeps a declared dynamic edge unresolved when its synchronized endpoint locator is invented', () => {
    const repository = cloneRepository()
    const head = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repository,
      encoding: 'utf8',
    }).trim()
    const inventoryState = readGitPathAtCommit(repository, head, 'docs/cat-catch/legacy-inventory.json')
    if (inventoryState.status !== 'present') throw new Error('fixture inventory is unavailable')
    const inventory = JSON.parse(inventoryState.bytes.toString('utf8')) as JsonObject
    const currentNodes = objectArray(inventory.entries).filter(entry => entry.entryType === 'current-node')
    const declarations = objectArray(inventory.declaredDynamicEdges)
    const declaration = declarations.find(candidate => {
      const source = candidate.source
      return typeof source === 'object'
        && source !== null
        && !Array.isArray(source)
        && typeof (source as JsonObject).symbol === 'string'
    })
    if (!declaration || typeof declaration.id !== 'string') {
      throw new Error('fixture dynamic declaration is unavailable')
    }
    const source = declaration.source as JsonObject
    const node = currentNodes.find(candidate => (
      candidate.path === source.path
      && candidate.symbol === source.symbol
      && (candidate.locatorKind || 'declaration') === (source.locatorKind || 'declaration')
    ))
    if (!node || typeof node.id !== 'string') throw new Error('fixture dynamic source node is unavailable')

    const inventedSymbol = '__omniflow_missing_dynamic_edge_symbol__'
    source.symbol = inventedSymbol
    node.symbol = inventedSymbol
    writeFileSync(
      path.join(repository, 'docs/cat-catch/legacy-inventory.json'),
      `${JSON.stringify(inventory, null, 2)}\n`,
    )
    const commit = commitAll(repository, 'invent synchronized dynamic endpoint locator')
    const result = generateCandidateLocalClosureReport(repository, commit, generatedAt)
    expect(result.issues).toEqual([])
    if (!result.report) throw new Error('candidate local-closure report was not generated')
    expect(result.report.declaredDynamicEdges.some(edge => edge.edgeId === declaration.id)).toBe(false)
    expect(result.report.unresolvedDynamicEdges).toContainEqual(expect.objectContaining({
      edgeId: declaration.id,
      sourceNodeId: node.id,
    }))
    expect(result.report.findings.unresolvedEdges).toContainEqual(expect.objectContaining({
      code: 'closure.declared-dynamic-edge-unresolved',
      refId: declaration.id,
    }))
  })

  it('keeps a declared dynamic edge unresolved when its source hash is stale', () => {
    const repository = cloneRepository()
    const head = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repository,
      encoding: 'utf8',
    }).trim()
    const inventoryState = readGitPathAtCommit(repository, head, 'docs/cat-catch/legacy-inventory.json')
    if (inventoryState.status !== 'present') throw new Error('fixture inventory is unavailable')
    const inventory = JSON.parse(inventoryState.bytes.toString('utf8')) as JsonObject
    const declaration = objectArray(inventory.declaredDynamicEdges)[0]
    if (!declaration || typeof declaration.id !== 'string') {
      throw new Error('fixture dynamic declaration is unavailable')
    }
    declaration.sourceHash = `sha256:${'0'.repeat(64)}`
    writeFileSync(
      path.join(repository, 'docs/cat-catch/legacy-inventory.json'),
      `${JSON.stringify(inventory, null, 2)}\n`,
    )

    const commit = commitAll(repository, 'stale dynamic edge source hash')
    const result = generateCandidateLocalClosureReport(repository, commit, generatedAt)
    expect(result.issues).toEqual([])
    expect(result.report?.declaredDynamicEdges.some(edge => edge.edgeId === declaration.id)).toBe(false)
    expect(result.report?.unresolvedDynamicEdges).toContainEqual(expect.objectContaining({
      edgeId: declaration.id,
    }))
    expect(result.report?.findings.unresolvedEdges).toContainEqual(expect.objectContaining({
      code: 'closure.declared-dynamic-edge-source-hash-mismatch',
      refId: declaration.id,
    }))
    expect(result.report?.counts.unresolvedEdges).toBeGreaterThan(0)
  })

  it('binds a historical approved exclusion back to the matching candidate', () => {
    const repository = cloneRepository()
    const head = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repository,
      encoding: 'utf8',
    }).trim()
    const inventoryState = readGitPathAtCommit(repository, head, 'docs/cat-catch/legacy-inventory.json')
    if (inventoryState.status !== 'present') throw new Error('fixture inventory is unavailable')
    const inventory = JSON.parse(inventoryState.bytes.toString('utf8')) as JsonObject
    const node = objectArray(inventory.entries).find(entry => (
      entry.entryType === 'current-node' && typeof entry.symbol === 'string'
    ))
    if (!node || typeof node.path !== 'string' || typeof node.symbol !== 'string') {
      throw new Error('fixture typed inventory node is unavailable')
    }
    const candidateId = 'candidate.historical-exclusion-test'
    const exclusionId = 'exclusion.historical-test'
    inventory.historicalCandidates = [{
      id: candidateId,
      path: node.path,
      symbol: node.symbol,
      locatorKind: node.locatorKind || 'declaration',
      lastKnownCommit: head,
      sourceHash: node.sourceHash,
      resolution: { kind: 'approved-exclusion', refId: exclusionId },
    }]
    inventory.approvedExclusions = [{
      id: exclusionId,
      candidateKind: 'historical',
      path: node.path,
      symbol: node.symbol,
      locatorKind: node.locatorKind || 'declaration',
      decision: {
        schemaVersion: 1,
        decisionId: 'decision.historical-exclusion-test',
        type: 'intentional-exclusion',
        rationale: 'test rationale',
        userImpact: 'test impact',
        upstreamBehavior: 'test upstream behavior',
        omniflowBehavior: 'test OmniFlow behavior',
        fixtures: ['fixture.historical-exclusion-test'],
        fixtureWaiver: null,
        approvalRef: {
          kind: 'user-decision',
          locator: 'test:historical-exclusion',
          payloadHashProfile: 'decision-payload-jcs-v1',
          contentHash: `sha256:${'1'.repeat(64)}`,
        },
        approvedAt: generatedAt,
        revisitWhen: 'scope changes',
      },
    }]
    writeFileSync(
      path.join(repository, 'docs/cat-catch/legacy-inventory.json'),
      `${JSON.stringify(inventory, null, 2)}\n`,
    )

    const commit = commitAll(repository, 'add historical exclusion fixture')
    const result = generateCandidateLocalClosureReport(repository, commit, generatedAt)
    expect(result.issues).toEqual([])
    expect(result.report?.approvedExclusions).toContainEqual(expect.objectContaining({
      candidateId,
      exclusionId,
    }))
    if (!result.report) throw new Error('candidate local-closure report was not generated')
    expect(validateCandidateLocalClosureReportAtCommit(repository, commit, result.report)).toEqual([])
  })

  it('blocks an approved exclusion without exactly one matching candidate', () => {
    const repository = cloneRepository()
    const head = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repository,
      encoding: 'utf8',
    }).trim()
    const inventoryState = readGitPathAtCommit(repository, head, 'docs/cat-catch/legacy-inventory.json')
    if (inventoryState.status !== 'present') throw new Error('fixture inventory is unavailable')
    const inventory = JSON.parse(inventoryState.bytes.toString('utf8')) as JsonObject
    const node = objectArray(inventory.entries).find(entry => (
      entry.entryType === 'current-node' && typeof entry.symbol === 'string'
    ))
    if (!node || typeof node.path !== 'string' || typeof node.symbol !== 'string') {
      throw new Error('fixture typed inventory node is unavailable')
    }
    inventory.approvedExclusions = [{
      id: 'exclusion.current-without-candidate',
      candidateKind: 'current',
      path: node.path,
      symbol: node.symbol,
      locatorKind: node.locatorKind || 'declaration',
      decision: {
        schemaVersion: 1,
        decisionId: 'decision.current-without-candidate',
        type: 'intentional-exclusion',
        rationale: 'test rationale',
        userImpact: 'test impact',
        upstreamBehavior: 'test upstream behavior',
        omniflowBehavior: 'test OmniFlow behavior',
        fixtures: ['fixture.current-without-candidate'],
        fixtureWaiver: null,
        approvalRef: {
          kind: 'user-decision',
          locator: 'test:current-without-candidate',
          payloadHashProfile: 'decision-payload-jcs-v1',
          contentHash: `sha256:${'2'.repeat(64)}`,
        },
        approvedAt: generatedAt,
        revisitWhen: 'scope changes',
      },
    }]
    writeFileSync(
      path.join(repository, 'docs/cat-catch/legacy-inventory.json'),
      `${JSON.stringify(inventory, null, 2)}\n`,
    )

    const commit = commitAll(repository, 'add unresolved current exclusion fixture')
    const result = generateCandidateLocalClosureReport(repository, commit, generatedAt)
    expect(result.issues).toEqual([])
    expect(result.report?.approvedExclusions).toEqual([])
    expect(result.report?.blockers).toContainEqual(expect.objectContaining({
      code: 'closure.approved-exclusion-candidate-unresolved',
      refId: 'exclusion.current-without-candidate',
    }))
  })

  it('binds validator provenance to the executing tool instead of the target clone', () => {
    const repository = cloneRepository()
    appendFileSync(
      path.join(repository, 'tools/cat-catch-lab/validator/cli.ts'),
      '\n// target-only validator bundle fixture\n',
    )
    const commit = commitAll(repository, 'change target validator bundle')
    const result = generateCandidateLocalClosureReport(repository, commit, generatedAt)
    expect(result.issues).toEqual([])
    if (!result.report) throw new Error('candidate local-closure report was not generated')
    expect(result.report.validator.sourceManifestHash).toBe(hashValidatorSourceManifest(appRoot))
    expect(result.report.blockers).toContainEqual(expect.objectContaining({
      code: 'closure.validator-bundle-not-at-input-commit',
      refId: 'validator.executing-bundle',
    }))
  })

  it('keeps tombstone attribution loss explicit until the schema can encode it', () => {
    const blocker = createLocalClosureSchemaProjectionBlocker(1, 1, 1)
    expect(blocker.message).toContain('locatorKind')
    expect(blocker.message).toContain('lastKnownCommit')
    expect(blocker.message).toContain('capabilityId/cutoverUnitId/provenanceRefs')
    expect(blocker.message).toContain('external-process virtual endpoint')
  })

  it('fails closed for a non-full commit', () => {
    const result = generateCandidateLocalClosureReport(appRoot, currentHead().slice(0, 12), generatedAt)
    expect(result.report).toBeNull()
    expect(result.issues).toContainEqual(expect.objectContaining({
      code: 'contract-commit-not-full',
      severity: 'error',
    }))
  })
})
