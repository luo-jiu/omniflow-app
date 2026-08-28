import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import {
  defaultAppRoot,
  loadDocuments,
  validateDocuments,
  validateUpstream,
} from './validate.mjs'

function clone(value) {
  return structuredClone(value)
}

function loadClonedDocuments() {
  return clone(loadDocuments(defaultAppRoot))
}

function completeEveryUnitForTarget(documents, testId) {
  const verifiedUnits = new Set()
  for (const capability of documents.capabilityMap.capabilities) {
    capability.syncedThrough = documents.state.migrationTarget
    if (!verifiedUnits.has(capability.cutoverUnitId)) {
      verifiedUnits.add(capability.cutoverUnitId)
      capability.syncState = 'verified'
      capability.targetRefs = ['package.json#cat-catch:validate']
      capability.plannedTestIds = [testId]
      capability.testRefs = [`tools/cat-catch-sync/validate.test.mjs#${testId}`]
      capability.acceptedDifferences = []
      continue
    }
    capability.syncState = 'excluded'
    capability.targetRefs = []
    capability.testRefs = []
    capability.acceptedDifferences = ['Explicitly outside the OmniFlow product boundary.']
  }
}

test('accepts the checked-in Cat Catch sync metadata', () => {
  const documents = loadDocuments(defaultAppRoot)
  assert.deepEqual(validateDocuments({ appRoot: defaultAppRoot, ...documents }), [])
})

test('rejects duplicate capability identities', () => {
  const documents = loadClonedDocuments()
  documents.capabilityMap.capabilities.push(clone(documents.capabilityMap.capabilities[0]))

  assert(validateDocuments({ appRoot: defaultAppRoot, ...documents })
    .some(issue => issue.includes('duplicate id')))
})

test('reports invalid planned test values without crashing', () => {
  const documents = loadClonedDocuments()
  documents.capabilityMap.capabilities[0].plannedTestIds = [42]

  assert(validateDocuments({ appRoot: defaultAppRoot, ...documents })
    .some(issue => issue.includes('plannedTestIds[0] must be a non-empty string')))
})

test('checks target symbols once a port exists', () => {
  const documents = loadClonedDocuments()
  const capability = documents.capabilityMap.capabilities[0]
  capability.syncState = 'ported-unverified'
  capability.syncedThrough = documents.state.migrationTarget
  capability.targetRefs = ['package.json#DefinitelyMissingCatCatchSymbol']

  assert(validateDocuments({ appRoot: defaultAppRoot, ...documents })
    .some(issue => issue.includes('targetRefs symbol does not exist')))
})

test('binds every verified planned test to a real test ref', () => {
  const documents = loadClonedDocuments()
  const capability = documents.capabilityMap.capabilities[0]
  capability.syncState = 'verified'
  capability.syncedThrough = documents.state.migrationTarget
  capability.targetRefs = ['package.json#cat-catch:validate']
  capability.plannedTestIds = ['missing.behavior-proof']
  capability.testRefs = [
    'tools/cat-catch-sync/validate.test.mjs#binds every verified planned test to a real test ref',
  ]

  assert(validateDocuments({ appRoot: defaultAppRoot, ...documents })
    .some(issue => issue.includes('planned test has no matching testRef: missing.behavior-proof')))
})

test('rejects partial unit verification', () => {
  const documents = loadClonedDocuments()
  const capability = documents.capabilityMap.capabilities
    .find(item => item.cutoverUnitId === 'deep-search-runtime')
  capability.syncState = 'verified'
  capability.syncedThrough = documents.state.migrationTarget
  capability.targetRefs = ['package.json#cat-catch:validate']
  capability.testRefs = [
    'tools/cat-catch-sync/validate.test.mjs#rejects partial unit verification',
  ]

  assert(validateDocuments({ appRoot: defaultAppRoot, ...documents })
    .some(issue => issue.includes('cannot contain verified capabilities before the whole unit closes')))
})

test('rejects a closed unit while removable legacy symbols remain', () => {
  const documents = loadClonedDocuments()
  for (const capability of documents.capabilityMap.capabilities) {
    if (capability.cutoverUnitId !== 'deep-search-runtime') continue
    capability.syncState = 'verified'
    capability.syncedThrough = documents.state.migrationTarget
    capability.targetRefs = ['package.json#cat-catch:validate']
    capability.testRefs = [
      'tools/cat-catch-sync/validate.test.mjs#rejects a closed unit while removable legacy symbols remain',
    ]
  }

  assert(validateDocuments({ appRoot: defaultAppRoot, ...documents })
    .some(issue => issue.includes('symbol must be removed')))
})

test('binds every cleanup entry to its capability unit', () => {
  const documents = loadClonedDocuments()
  documents.legacyCleanup.entries[0].cutoverUnitId = 'dash-engine'

  assert(validateDocuments({ appRoot: defaultAppRoot, ...documents })
    .some(issue => issue.includes('cutover unit must match capability')))
})

test('prevents legacy cleanup entries from being relabeled as retained integration', () => {
  const documents = loadClonedDocuments()
  const legacyEntry = documents.legacyCleanup.entries
    .find(entry => entry.classification === 'legacy')
  legacyEntry.cleanupAction = 'retain-or-adapt'

  assert(validateDocuments({ appRoot: defaultAppRoot, ...documents })
    .some(issue => issue.includes('legacy code must use cleanupAction=remove-after-cutover')))
})

test('classifies every current implementation ref during initial cutover', () => {
  const documents = loadClonedDocuments()
  const currentRef = documents.capabilityMap.capabilities[0].currentImplementationRefs[0]
  documents.legacyCleanup.entries = documents.legacyCleanup.entries.filter(entry => (
    `${entry.path}#${entry.symbol}` !== currentRef
  ))

  assert(validateDocuments({ appRoot: defaultAppRoot, ...documents })
    .some(issue => issue.includes(`has no legacy cleanup classification: ${currentRef}`)))
})

test('prevents a cutover unit from closing entirely through exclusions', () => {
  const documents = loadClonedDocuments()
  for (const capability of documents.capabilityMap.capabilities) {
    if (capability.cutoverUnitId !== 'network-capture') continue
    capability.syncState = 'excluded'
    capability.syncedThrough = documents.state.migrationTarget
    capability.targetRefs = []
    capability.acceptedDifferences = ['Explicitly outside the OmniFlow product boundary.']
  }

  assert(validateDocuments({ appRoot: defaultAppRoot, ...documents })
    .some(issue => issue.includes('cannot close with every capability excluded')))
})

test('requires portedThrough when every capability closes', () => {
  const documents = loadClonedDocuments()
  for (const capability of documents.capabilityMap.capabilities) {
    capability.syncState = 'excluded'
    capability.syncedThrough = documents.state.migrationTarget
    capability.targetRefs = []
    capability.acceptedDifferences = ['Explicitly outside the OmniFlow product boundary.']
  }

  assert(validateDocuments({ appRoot: defaultAppRoot, ...documents })
    .includes('upstream-state.portedThrough must equal migrationTarget when all capabilities close'))
})

test('requires the legacy cleanup map until the initial migration completes', () => {
  const documents = loadClonedDocuments()
  documents.legacyCleanup = null

  assert(validateDocuments({ appRoot: defaultAppRoot, ...documents })
    .includes('legacy-cleanup.json is required while initial cleanup validation is active'))
})

test('preserves the last completed cursor while a later migration batch is open', () => {
  const documents = loadClonedDocuments()
  const previousTarget = '1'.repeat(40)
  const nextTarget = '2'.repeat(40)
  documents.state.baselineCursor = previousTarget
  documents.state.observedHead = nextTarget
  documents.state.migrationTarget = nextTarget
  documents.state.reviewedThrough = nextTarget
  documents.state.portedThrough = previousTarget
  documents.legacyCleanup = null

  completeEveryUnitForTarget(
    documents,
    'preserves the last completed cursor while a later migration batch is open',
  )
  const affected = documents.capabilityMap.capabilities[0]
  affected.syncState = 'pending'
  affected.syncedThrough = previousTarget
  affected.targetRefs = ['package.json#cat-catch:validate']

  assert.deepEqual(validateDocuments({ appRoot: defaultAppRoot, ...documents }), [
    'legacy-cleanup.json is required while initial cleanup validation is active',
  ])
})

test('reopens a capability at the same upstream target without erasing cursors', () => {
  const documents = loadClonedDocuments()
  completeEveryUnitForTarget(
    documents,
    'reopens a capability at the same upstream target without erasing cursors',
  )
  documents.state.reviewedThrough = documents.state.migrationTarget
  documents.state.portedThrough = documents.state.migrationTarget
  documents.legacyCleanup = null

  const affected = documents.capabilityMap.capabilities[0]
  affected.syncState = 'pending'

  assert.deepEqual(validateDocuments({ appRoot: defaultAppRoot, ...documents }), [
    'legacy-cleanup.json is required while initial cleanup validation is active',
  ])
})

function git(sourceDir, args) {
  return execFileSync('git', args, { cwd: sourceDir, encoding: 'utf8' }).trim()
}

test('checks the upstream remote, branch head, ancestry, path, and anchor', () => {
  const sourceDir = mkdtempSync(path.join(tmpdir(), 'omniflow-cat-catch-upstream-'))
  try {
    git(sourceDir, ['init', '-q'])
    git(sourceDir, ['config', 'user.email', 'cat-catch-test@omniflow.invalid'])
    git(sourceDir, ['config', 'user.name', 'Cat Catch Test'])
    writeFileSync(path.join(sourceDir, 'source.js'), 'export const stableAnchor = true\n')
    git(sourceDir, ['add', 'source.js'])
    git(sourceDir, ['commit', '-q', '-m', 'fixture'])
    const baseline = git(sourceDir, ['rev-parse', 'HEAD'])
    writeFileSync(path.join(sourceDir, 'source.js'), [
      'export const stableAnchor = true',
      'export const migrationTarget = true',
      '',
    ].join('\n'))
    git(sourceDir, ['add', 'source.js'])
    git(sourceDir, ['commit', '-q', '-m', 'migration target'])
    const migrationTarget = git(sourceDir, ['rev-parse', 'HEAD'])
    writeFileSync(path.join(sourceDir, 'source.js'), [
      'export const stableAnchor = true',
      'export const migrationTarget = true',
      'export const observedLater = true',
      '',
    ].join('\n'))
    git(sourceDir, ['add', 'source.js'])
    git(sourceDir, ['commit', '-q', '-m', 'observed later'])
    const observedHead = git(sourceDir, ['rev-parse', 'HEAD'])
    git(sourceDir, ['remote', 'add', 'origin', 'https://github.com/xifangczy/cat-catch.git'])
    git(sourceDir, ['update-ref', 'refs/remotes/origin/master', observedHead])

    const state = {
      repository: 'https://github.com/xifangczy/cat-catch',
      branch: 'master',
      baselineCursor: baseline,
      observedHead,
      migrationTarget,
      reviewedThrough: migrationTarget,
      portedThrough: baseline,
    }
    const capabilityMap = {
      capabilities: [{
        id: 'test.capability',
        syncedThrough: baseline,
        upstreamRefs: [{ path: 'source.js', anchors: ['stableAnchor'] }],
      }],
    }
    assert.deepEqual(validateUpstream({ sourceDir, state, capabilityMap }), [])

    state.reviewedThrough = observedHead
    assert(validateUpstream({ sourceDir, state, capabilityMap })
      .some(issue => issue.includes('reviewedThrough must be an ancestor of migrationTarget')))

    state.reviewedThrough = migrationTarget
    capabilityMap.capabilities[0].upstreamRefs[0].anchors = ['missingAnchor']
    assert(validateUpstream({ sourceDir, state, capabilityMap })
      .some(issue => issue.includes('upstream anchor is missing')))
  } finally {
    rmSync(sourceDir, { recursive: true, force: true })
  }
})
