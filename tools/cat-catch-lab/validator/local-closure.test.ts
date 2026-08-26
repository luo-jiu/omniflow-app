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
    expect(report.schemaVersion).toBe(2)
    expect(report.bootstrapRoots.length).toBeLessThanOrEqual(roots.length)
    expect(report.discoveredNodes.length).toBeLessThanOrEqual(currentNodes.length)
    expect(report.bootstrapRoots.every(root => (
      typeof root.rootId === 'string'
      && typeof root.category === 'string'
      && typeof root.traversal === 'string'
    ))).toBe(true)
    const rootNodeIds = new Set(report.bootstrapRoots.map(root => root.nodeId))
    expect(report.discoveredNodes.every(node => (
      node.reachability === (rootNodeIds.has(node.nodeId) ? 'reachable' : 'unknown')
    ))).toBe(true)
    const currentNodeIds = new Set(currentNodes.map(node => node.id))
    expect(report.discoveredNodes.every(node => currentNodeIds.has(node.nodeId))).toBe(true)
    const blockerRefIds = new Set(report.blockers.map(blocker => blocker.refId))
    for (const node of currentNodes) {
      if (typeof node.id !== 'string') continue
      expect(
        report.discoveredNodes.some(discovered => discovered.nodeId === node.id)
        || blockerRefIds.has(node.id),
      ).toBe(true)
    }
    const emittedRootIds = new Set(report.bootstrapRoots.map(root => root.rootId))
    for (const root of roots) {
      if (typeof root.id !== 'string') continue
      expect(emittedRootIds.has(root.id) || blockerRefIds.has(root.id)).toBe(true)
    }
    expect(report.discoveredNodes.every(node => (
      typeof node.classification === 'string' && Array.isArray(node.provenanceRefs)
    ))).toBe(true)
    expect(report.counts.unmappedInScopeNodes).toBe(0)
    expect(report.findings.unmappedInScopeNodes).toEqual([])
    const undeterminedReachability = report.blockers.filter(blocker => (
      blocker.code === 'closure.current-node-reachability-undetermined'
    ))
    expect(undeterminedReachability).toHaveLength(
      report.discoveredNodes.filter(node => node.reachability === 'unknown').length,
    )
    const undeterminedIds = new Set(undeterminedReachability.map(blocker => blocker.refId))
    for (const node of report.discoveredNodes) {
      if (node.reachability === 'unknown') {
        expect(undeterminedIds.has(node.nodeId)).toBe(true)
      }
    }
    expect(report.declaredDynamicEdges.length + report.unresolvedDynamicEdges.length).toBe(dynamicEdges.length)
    expect(report.declaredDynamicEdges.every(edge => (
      typeof edge.fixtureId === 'string'
      && typeof edge.resolutionRule === 'string'
      && typeof edge.source.path === 'string'
      && typeof edge.target.path === 'string'
    ))).toBe(true)
    expect(report.edges).toEqual([])
    expect(report.semanticCandidates).toEqual([])
    expect(report.historicalCandidates).toHaveLength(historicalCandidates.length)
    expect(report.historicalCandidates.every(candidate => (
      candidate.candidateKind === 'historical'
      && candidate.discoveryRuleIds.length === 0
      && typeof candidate.lastKnownCommit === 'string'
      && typeof candidate.touchsetId === 'string'
      && candidate.discoveryEvidence !== null
    ))).toBe(true)
    for (const candidate of report.historicalCandidates) {
      const declaration = historicalCandidates.find(value => value.id === candidate.candidateId)
      expect(declaration).toBeDefined()
      expect(candidate.touchsetId).toBe(declaration?.touchsetId)
      expect(candidate.discoveryEvidence).toEqual(declaration?.discoveryEvidence)
    }
    expect(report.discoveryCoverage).toEqual({
      cutoverDependencyGraph: 'pending',
      declaredDynamicEdges: 'complete',
      historicalTouchsetScan: 'pending',
      leastFixedPoint: 'pending',
      reverseDependencyGraph: 'pending',
      semanticScan: 'pending',
      staticDependencyGraph: 'pending',
    })
    expect(report.blockers.map(blocker => blocker.code)).toEqual(expect.arrayContaining([
      'closure.candidate-untrusted',
      'closure.discovery-engine-unimplemented',
    ]))
    expect(report.blockers.some(blocker => blocker.code === 'closure.schema-projection-incomplete')).toBe(false)
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
    expect(new Set(report.externalProcessEndpoints.map(endpoint => endpoint.nodeId))).toEqual(
      new Set(externalTargets),
    )
    for (const endpoint of report.externalProcessEndpoints) {
      expect(endpoint.path).toMatch(/^external-process\//)
      expect(endpoint.symbol).toBeNull()
      expect(endpoint.locatorKind).toBeNull()
      expect(endpoint.attributions.length).toBeGreaterThan(0)
      expect(endpoint.attributions.every(attribution => (
        typeof attribution.edgeId === 'string'
        && typeof attribution.sourceNodeId === 'string'
        && typeof attribution.capabilityId === 'string'
        && typeof attribution.cutoverUnitId === 'string'
        && ['reachable', 'unknown'].includes(attribution.sourceReachability)
      ))).toBe(true)
    }
  })

  it('returns schema issues instead of throwing for a malformed candidate report', () => {
    const issues = validateCandidateLocalClosureReportAtCommit(
      appRoot,
      currentHead(),
      {} as CandidateLocalClosureReport,
    )

    expect(issues.length).toBeGreaterThan(0)
    expect(issues.every(issue => issue.severity === 'error')).toBe(true)
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
    ['historicalCommit', (report: CandidateLocalClosureReport) => {
      const candidate = report.historicalCandidates[0]
      if (candidate) candidate.lastKnownCommit = '0'.repeat(40)
    }],
    ['historicalTouchset', (report: CandidateLocalClosureReport) => {
      const candidate = report.historicalCandidates[0]
      if (candidate?.candidateKind === 'historical') candidate.touchsetId = 'history.tampered'
    }],
    ['historicalEvidence', (report: CandidateLocalClosureReport) => {
      const candidate = report.historicalCandidates[0]
      if (candidate?.candidateKind === 'historical') {
        candidate.discoveryEvidence.queryId = 'history.tampered'
      }
    }],
    ['rootTraversal', (report: CandidateLocalClosureReport) => {
      const root = report.bootstrapRoots[0]
      if (root) root.traversal = root.traversal === 'both' ? 'forward' : 'both'
    }],
    ['locatorKind', (report: CandidateLocalClosureReport) => {
      const node = report.discoveredNodes.find(candidate => candidate.locatorKind !== null)
      if (node) node.locatorKind = node.locatorKind === 'member' ? 'declaration' : 'member'
    }],
    ['classification', (report: CandidateLocalClosureReport) => {
      const node = report.discoveredNodes[0]
      if (node) node.classification = node.classification === 'legacy' ? 'target' : 'legacy'
    }],
    ['provenanceRefs', (report: CandidateLocalClosureReport) => {
      const node = report.discoveredNodes[0]
      if (node) node.provenanceRefs = ['test:tampered']
    }],
    ['discoveryCoverage', (report: CandidateLocalClosureReport) => {
      report.discoveryCoverage.staticDependencyGraph = 'complete'
    }],
    ['dynamicFixture', (report: CandidateLocalClosureReport) => {
      const edge = report.declaredDynamicEdges[0]
      if (edge) edge.fixtureId = 'fixture.tampered'
    }],
    ['externalAttribution', (report: CandidateLocalClosureReport) => {
      const endpoint = report.externalProcessEndpoints[0]
      const attribution = endpoint?.attributions[0]
      if (attribution) attribution.capabilityId = 'capture.tampered'
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

  it('refuses to project structurally contradictory exact-commit declarations', () => {
    const repository = cloneRepository()
    const head = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repository,
      encoding: 'utf8',
    }).trim()
    const inventoryState = readGitPathAtCommit(repository, head, 'docs/cat-catch/legacy-inventory.json')
    if (inventoryState.status !== 'present') throw new Error('fixture inventory is unavailable')
    const inventory = JSON.parse(inventoryState.bytes.toString('utf8')) as JsonObject
    const node = objectArray(inventory.entries).find(entry => entry.entryType === 'current-node')
    if (!node || typeof node.id !== 'string') throw new Error('fixture current node is unavailable')
    objectArray(inventory.entries).push({
      ...node,
      path: 'electron/service/__duplicateInventoryIdFixture.ts',
      symbol: '__duplicateInventoryIdFixture',
    })
    writeFileSync(
      path.join(repository, 'docs/cat-catch/legacy-inventory.json'),
      `${JSON.stringify(inventory, null, 2)}\n`,
    )
    const commit = commitAll(repository, 'add contradictory inventory id')

    const result = generateCandidateLocalClosureReport(repository, commit, generatedAt)
    expect(result.report).toBeNull()
    expect(result.issues).toContainEqual(expect.objectContaining({
      code: 'exact-closure-duplicate-id',
      severity: 'error',
    }))
  })

  it('preserves full unresolved edge evidence when declarations are coherently stale', () => {
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

    const staleHash = `sha256:${'0'.repeat(64)}`
    node.sourceHash = staleHash
    const affectedDeclarations = declarations.filter(candidate => {
      const candidateSource = candidate.source
      return typeof candidateSource === 'object'
        && candidateSource !== null
        && !Array.isArray(candidateSource)
        && (candidateSource as JsonObject).path === source.path
        && (candidateSource as JsonObject).symbol === source.symbol
        && ((candidateSource as JsonObject).locatorKind || 'declaration') === (source.locatorKind || 'declaration')
    })
    for (const affected of affectedDeclarations) affected.sourceHash = staleHash
    writeFileSync(
      path.join(repository, 'docs/cat-catch/legacy-inventory.json'),
      `${JSON.stringify(inventory, null, 2)}\n`,
    )
    const commit = commitAll(repository, 'make dynamic source declarations coherently stale')
    const result = generateCandidateLocalClosureReport(repository, commit, generatedAt)
    expect(result.issues).toEqual([])
    if (!result.report) throw new Error('candidate local-closure report was not generated')
    for (const affected of affectedDeclarations) {
      expect(result.report.declaredDynamicEdges.some(edge => edge.edgeId === affected.id)).toBe(false)
      expect(result.report.unresolvedDynamicEdges).toContainEqual(expect.objectContaining({
        actualSourceHash: expect.stringMatching(/^sha256:/),
        declaredSourceHash: staleHash,
        edgeId: affected.id,
        fixtureId: affected.fixtureId,
        resolutionRule: affected.resolutionRule,
        sourceNodeId: node.id,
      }))
      expect(result.report.findings.unresolvedEdges).toContainEqual(expect.objectContaining({
        code: 'closure.declared-dynamic-edge-source-hash-mismatch',
        refId: affected.id,
      }))
    }
  })

  it('rejects a declared dynamic edge whose source hash contradicts its inventory node', () => {
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
    expect(result.report).toBeNull()
    expect(result.issues).toContainEqual(expect.objectContaining({
      code: 'exact-closure-dynamic-source-hash-ref-mismatch',
      severity: 'error',
    }))
  })

  it('binds a historical approved exclusion back to the matching candidate', () => {
    const repository = cloneRepository()
    const head = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repository,
      encoding: 'utf8',
    }).trim()
    const candidatePath = 'electron/service/__historicalExclusionFixture.ts'
    const candidateSymbol = 'historicalExclusionFixture'
    const candidateSource = `export function ${candidateSymbol}(): void {}\n`
    writeFileSync(path.join(repository, candidatePath), candidateSource)
    const historicalCommit = commitAll(repository, 'add historical exclusion source fixture')
    const inventoryState = readGitPathAtCommit(
      repository,
      historicalCommit,
      'docs/cat-catch/legacy-inventory.json',
    )
    if (inventoryState.status !== 'present') throw new Error('fixture inventory is unavailable')
    const inventory = JSON.parse(inventoryState.bytes.toString('utf8')) as JsonObject
    const candidateId = 'candidate.historical-exclusion-test'
    const exclusionId = 'exclusion.historical-test'
    const touchsetId = 'history.historical-exclusion-test'
    const literal = candidateSymbol
    const byteStart = candidateSource.indexOf(literal)
    const sourceHash = sha256Bytes(candidateSource)
    inventory.historicalTouchsets = [{
      id: touchsetId,
      fromCommit: historicalCommit,
      throughCommit: historicalCommit,
      pathScopes: [candidatePath],
      queries: [{
        id: 'historical-exclusion.source',
        profile: 'changed-blob-literal-v1',
        literal,
      }],
    }]
    inventory.historicalCandidates = [{
      id: candidateId,
      touchsetId,
      discoveryEvidence: {
        kind: 'changed-blob-query-hit',
        queryId: 'historical-exclusion.source',
        queryHit: {
          byteEnd: byteStart + literal.length,
          byteStart,
          commitId: historicalCommit,
          parentCommitId: head,
          path: candidatePath,
          rawSourceHash: sourceHash,
          side: 'after',
        },
      },
      path: candidatePath,
      symbol: candidateSymbol,
      locatorKind: 'declaration',
      lastKnownCommit: historicalCommit,
      sourceHash,
      resolution: { kind: 'approved-exclusion', refId: exclusionId },
    }]
    inventory.approvedExclusions = [{
      id: exclusionId,
      candidateKind: 'historical',
      path: candidatePath,
      symbol: candidateSymbol,
      locatorKind: 'declaration',
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
    expect(result.report.historicalCandidates).toContainEqual(expect.objectContaining({
      candidateId,
      discoveryEvidence: expect.objectContaining({
        kind: 'changed-blob-query-hit',
        queryId: 'historical-exclusion.source',
      }),
      touchsetId,
    }))
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
    inventory.approvedExclusions = [{
      id: 'exclusion.current-without-candidate',
      candidateKind: 'current',
      path: 'electron/service/__excludedCurrentCandidateFixture.ts',
      symbol: '__excludedCurrentCandidateFixture',
      locatorKind: 'declaration',
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

  it('preserves retired tombstone attribution and historical resolution', () => {
    const repository = cloneRepository()
    const sourcePath = 'electron/service/__localClosureRetiredFixture.ts'
    const source = 'export function localClosureRetiredFixture(): void {}\n'
    writeFileSync(path.join(repository, sourcePath), source)
    const lastKnownCommit = commitAll(repository, 'add local closure retirement fixture')
    const historicalParentCommit = execFileSync('git', ['rev-parse', `${lastKnownCommit}^`], {
      cwd: repository,
      encoding: 'utf8',
    }).trim()
    rmSync(path.join(repository, sourcePath))
    const deletionCommit = commitAll(repository, 'delete local closure retirement fixture')

    const inventoryPath = path.join(repository, 'docs/cat-catch/legacy-inventory.json')
    const inventory = JSON.parse(readFileSync(inventoryPath, 'utf8')) as JsonObject
    const mappedNode = objectArray(inventory.entries).find(entry => (
      entry.entryType === 'current-node'
      && typeof entry.capabilityId === 'string'
      && typeof entry.cutoverUnitId === 'string'
    ))
    if (!mappedNode || typeof mappedNode.capabilityId !== 'string' || typeof mappedNode.cutoverUnitId !== 'string') {
      throw new Error('mapped inventory fixture node is unavailable')
    }
    const tombstoneId = 'node.retired.local-closure-fixture'
    const touchsetId = 'history.local-closure-retirement-fixture'
    const sourceHash = sha256Bytes(source)
    objectArray(inventory.entries).push({
      id: tombstoneId,
      entryType: 'retired-tombstone',
      path: sourcePath,
      symbol: 'localClosureRetiredFixture',
      locatorKind: 'declaration',
      deletedSourceHash: sourceHash,
      capabilityId: mappedNode.capabilityId,
      cutoverUnitId: mappedNode.cutoverUnitId,
      deletionCommit,
      deletionEvidenceRef: {
        artifactId: 'evidence.local-closure-retirement-fixture',
        artifactSchemaId: 'https://omniflow.local/schemas/cat-catch/evidence-artifact.schema.json',
        contentHash: `sha256:${'3'.repeat(64)}`,
      },
      provenanceRefs: ['test:local-closure-retirement-fixture'],
    })
    objectArray(inventory.historicalCandidates).push({
      id: 'historical.local-closure-retirement-fixture',
      touchsetId,
      path: sourcePath,
      symbol: 'localClosureRetiredFixture',
      locatorKind: 'declaration',
      lastKnownCommit,
      sourceHash,
      discoveryEvidence: {
        kind: 'changed-blob-query-hit',
        queryId: 'local-closure-retirement.source',
        queryHit: {
          byteEnd: source.indexOf('localClosureRetiredFixture') + 'localClosureRetiredFixture'.length,
          byteStart: source.indexOf('localClosureRetiredFixture'),
          commitId: lastKnownCommit,
          parentCommitId: historicalParentCommit,
          path: sourcePath,
          rawSourceHash: sourceHash,
          side: 'after',
        },
      },
      resolution: { kind: 'retired-tombstone', refId: tombstoneId },
    })
    objectArray(inventory.historicalTouchsets).push({
      id: touchsetId,
      fromCommit: lastKnownCommit,
      throughCommit: lastKnownCommit,
      pathScopes: [sourcePath],
      queries: [{
        id: 'local-closure-retirement.source',
        profile: 'changed-blob-literal-v1',
        literal: 'localClosureRetiredFixture',
      }],
    })
    writeFileSync(inventoryPath, `${JSON.stringify(inventory, null, 2)}\n`)
    const commit = commitAll(repository, 'inventory local closure retirement fixture')

    const result = generateCandidateLocalClosureReport(repository, commit, generatedAt)
    expect(result.issues).toEqual([])
    expect(result.report?.retiredTombstones).toContainEqual({
      capabilityId: mappedNode.capabilityId,
      cutoverUnitId: mappedNode.cutoverUnitId,
      deletedSourceHash: sourceHash,
      deletionCommit,
      deletionEvidenceRef: {
        artifactId: 'evidence.local-closure-retirement-fixture',
        artifactSchemaId: 'https://omniflow.local/schemas/cat-catch/evidence-artifact.schema.json',
        contentHash: `sha256:${'3'.repeat(64)}`,
      },
      inventoryEntryId: tombstoneId,
      locatorKind: 'declaration',
      path: sourcePath,
      provenanceRefs: ['test:local-closure-retirement-fixture'],
      symbol: 'localClosureRetiredFixture',
    })
    expect(result.report?.historicalCandidates).toContainEqual(expect.objectContaining({
      candidateId: 'historical.local-closure-retirement-fixture',
      candidateKind: 'historical',
      discoveryEvidence: expect.objectContaining({
        kind: 'changed-blob-query-hit',
        queryId: 'local-closure-retirement.source',
      }),
      lastKnownCommit,
      resolutionKind: 'retired-tombstone',
      resolutionRefId: tombstoneId,
      touchsetId,
    }))
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
