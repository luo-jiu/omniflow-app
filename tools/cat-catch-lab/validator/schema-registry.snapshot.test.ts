import { execFileSync } from 'node:child_process'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { sha256Bytes } from './json.ts'
import {
  loadAndValidateContractsAtCommit,
  loadAndValidateLocalClosureContractsAtCommit,
} from './schema-registry.ts'

const SCHEMA_FILES = [
  'artifact-availability-report.schema.json',
  'automation-policy.schema.json',
  'capability-ledger.schema.json',
  'capability-state-report.schema.json',
  'decision-record.schema.json',
  'evidence-artifact.schema.json',
  'evidence-retention-policy.schema.json',
  'gate-report.schema.json',
  'legacy-inventory.schema.json',
  'local-closure-report.schema.json',
  'release-targets.schema.json',
  'report-index-entry.schema.json',
  'report-index.schema.json',
  'risk-policy.schema.json',
  'seal-report.schema.json',
  'upstream-state.schema.json',
  'validator-trust-policy.schema.json',
] as const

const DATA_FILES = [
  'upstream-state.json',
  'capability-ledger.json',
  'legacy-inventory.json',
  'release-targets.json',
  'risk-policy.json',
  'automation-policy.json',
  'evidence-retention-policy.json',
  'validator-trust-policy.json',
  'report-index/index.json',
] as const

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true })
  }
})

function schemaBytes(schemaFile: string): string {
  return `${JSON.stringify({
    $id: `https://validator.example.invalid/${schemaFile}`,
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    additionalProperties: true,
    type: 'object',
  }, null, 2)}\n`
}

function writeFixtureContracts(repository: string): void {
  const contractDirectory = path.join(repository, 'docs/cat-catch')
  mkdirSync(path.join(contractDirectory, 'report-index'), { recursive: true })
  for (const schemaFile of SCHEMA_FILES) {
    writeFileSync(path.join(contractDirectory, schemaFile), schemaBytes(schemaFile))
  }
  for (const dataFile of DATA_FILES) {
    writeFileSync(path.join(contractDirectory, dataFile), dataFile === 'upstream-state.json'
      ? '{\n  "snapshot": true\n}\n'
      : '{}\n')
  }
}

function commit(repository: string, message: string): string {
  execFileSync('git', ['add', '.'], { cwd: repository })
  execFileSync('git', ['commit', '--quiet', '-m', message], { cwd: repository })
  return execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: repository,
    encoding: 'utf8',
  }).trim()
}

function createRepository(): { commit: string; repository: string } {
  const repository = mkdtempSync(path.join(tmpdir(), 'cat-catch-contract-snapshot-'))
  temporaryDirectories.push(repository)
  execFileSync('git', ['init', '--quiet'], { cwd: repository })
  execFileSync('git', ['config', 'user.email', 'validator@example.invalid'], { cwd: repository })
  execFileSync('git', ['config', 'user.name', 'Validator Test'], { cwd: repository })
  writeFixtureContracts(repository)
  return { commit: commit(repository, 'contracts'), repository }
}

describe('Cat Catch exact-commit contract snapshots', () => {
  it('loads schema and declaration bytes only from the selected commit', () => {
    const fixture = createRepository()
    const schemaPath = path.join(fixture.repository, 'docs/cat-catch/evidence-artifact.schema.json')
    const dataPath = path.join(fixture.repository, 'docs/cat-catch/upstream-state.json')
    const expectedSchemaHash = sha256Bytes(readFileSync(schemaPath))
    const expectedDataHash = sha256Bytes(readFileSync(dataPath))

    writeFileSync(schemaPath, '{"worktree":"invalid"')
    writeFileSync(dataPath, '[]\n')
    writeFileSync(path.join(fixture.repository, 'docs/cat-catch/extra.schema.json'), 'not json\n')

    const { contracts, issues } = loadAndValidateContractsAtCommit(
      fixture.repository,
      fixture.commit,
    )

    expect(issues).toEqual([])
    expect(contracts.schemas.size).toBe(SCHEMA_FILES.length)
    expect(contracts.documents.size).toBe(DATA_FILES.length)
    expect(contracts.schemas.has('extra.schema.json')).toBe(false)
    expect(contracts.inputHashes['evidence-artifact.schema.json']).toBe(expectedSchemaHash)
    expect(contracts.inputHashes['upstream-state.json']).toBe(expectedDataHash)
    expect(contracts.documents.get('upstream-state.json')).toEqual({ snapshot: true })

    const upperCase = loadAndValidateContractsAtCommit(
      fixture.repository,
      fixture.commit.toUpperCase(),
    )
    expect(upperCase.issues).toEqual([])
    expect(upperCase.contracts.inputHashes).toEqual(contracts.inputHashes)
  })

  it('does not fill a schema missing from the commit with a worktree file', () => {
    const fixture = createRepository()
    const schemaPath = path.join(fixture.repository, 'docs/cat-catch/evidence-artifact.schema.json')
    rmSync(schemaPath)
    const commitWithoutSchema = commit(fixture.repository, 'remove schema')
    writeFileSync(schemaPath, schemaBytes('evidence-artifact.schema.json'))

    const { contracts, issues } = loadAndValidateContractsAtCommit(
      fixture.repository,
      commitWithoutSchema,
    )

    expect(contracts.schemas.has('evidence-artifact.schema.json')).toBe(false)
    expect(issues).toContainEqual(expect.objectContaining({
      code: 'required-schema-missing',
      path: 'evidence-artifact.schema.json',
      severity: 'error',
    }))
  })

  it('loads every schema but ignores missing or malformed report-index data for local closure', () => {
    for (const indexState of ['missing', 'malformed'] as const) {
      const fixture = createRepository()
      const indexPath = path.join(fixture.repository, 'docs/cat-catch/report-index/index.json')
      if (indexState === 'missing') {
        rmSync(indexPath)
      } else {
        writeFileSync(indexPath, '{"entries":[')
      }
      const inputCommit = commit(fixture.repository, `${indexState} report index`)

      const localClosure = loadAndValidateLocalClosureContractsAtCommit(
        fixture.repository,
        inputCommit,
      )
      expect(localClosure.issues).toEqual([])
      expect(localClosure.contracts.schemas.size).toBe(SCHEMA_FILES.length)
      expect(localClosure.contracts.schemas.has('report-index.schema.json')).toBe(true)
      expect(localClosure.contracts.documents.size).toBe(DATA_FILES.length - 1)
      expect(localClosure.contracts.documents.has('report-index/index.json')).toBe(false)
      expect(localClosure.contracts.inputHashes['report-index/index.json']).toBeUndefined()

      const defaultSnapshot = loadAndValidateContractsAtCommit(fixture.repository, inputCommit)
      expect(defaultSnapshot.issues).toContainEqual(expect.objectContaining({
        code: indexState === 'missing' ? 'required-data-missing' : 'declaration-load-failed',
        path: 'report-index/index.json',
        severity: 'error',
      }))
    }
  })

  it('fails closed when exact-commit JSON contains invalid UTF-8', () => {
    const fixture = createRepository()
    const dataPath = path.join(fixture.repository, 'docs/cat-catch/upstream-state.json')
    writeFileSync(dataPath, Buffer.concat([
      Buffer.from('{"value":"'),
      Buffer.from([0xff]),
      Buffer.from('"}\n'),
    ]))
    const inputCommit = commit(fixture.repository, 'invalid utf8 declaration')

    const { contracts, issues } = loadAndValidateContractsAtCommit(
      fixture.repository,
      inputCommit,
    )

    expect(contracts.documents.has('upstream-state.json')).toBe(false)
    expect(contracts.inputHashes['upstream-state.json']).toBeUndefined()
    expect(issues).toContainEqual(expect.objectContaining({
      code: 'declaration-load-failed',
      message: expect.stringContaining('is not valid UTF-8'),
      path: 'upstream-state.json',
      severity: 'error',
    }))
  })

  it('fails closed for abbreviated, unavailable, and non-commit object IDs', () => {
    const fixture = createRepository()
    const schemaBlob = execFileSync('git', [
      'hash-object',
      'docs/cat-catch/evidence-artifact.schema.json',
    ], {
      cwd: fixture.repository,
      encoding: 'utf8',
    }).trim()

    const abbreviated = loadAndValidateContractsAtCommit(
      fixture.repository,
      fixture.commit.slice(0, 12),
    )
    expect(abbreviated.contracts.schemas.size).toBe(0)
    expect(abbreviated.issues).toContainEqual(expect.objectContaining({
      code: 'contract-commit-not-full',
      severity: 'error',
    }))

    const unavailable = loadAndValidateContractsAtCommit(fixture.repository, 'f'.repeat(40))
    expect(unavailable.contracts.schemas.size).toBe(0)
    expect(unavailable.issues).toContainEqual(expect.objectContaining({
      code: 'contract-commit-unavailable',
      severity: 'error',
    }))

    const blob = loadAndValidateContractsAtCommit(fixture.repository, schemaBlob)
    expect(blob.contracts.schemas.size).toBe(0)
    expect(blob.issues).toContainEqual(expect.objectContaining({
      code: 'contract-commit-unavailable',
      severity: 'error',
    }))
  })
})
