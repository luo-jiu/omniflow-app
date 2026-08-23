import { fileURLToPath } from 'node:url'
import path from 'node:path'

import { describe, expect, it } from 'vitest'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'

import { loadAndValidateContracts } from './schema-registry.ts'

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const catCatchDirectory = path.join(appRoot, 'docs/cat-catch')

describe('Cat Catch checked-in contracts', () => {
  it('strictly compiles every schema and validates every declaration input', () => {
    const { contracts, issues } = loadAndValidateContracts(catCatchDirectory)

    expect(contracts.schemas.size).toBe(17)
    expect(contracts.documents.size).toBe(9)
    expect(issues).toEqual([])
  })

  it('requires exactly one canonical location for every indexed artifact', () => {
    const { contracts, issues } = loadAndValidateContracts(catCatchDirectory)
    expect(issues).toEqual([])
    const ajv = new Ajv2020({ allErrors: true, strict: true })
    addFormats(ajv)
    for (const schema of contracts.schemas.values()) ajv.addSchema(schema)
    const validate = ajv.getSchema('https://omniflow.local/schemas/cat-catch/report-index-entry.schema.json')
    if (!validate) throw new Error('report-index entry validator missing')

    const entry = {
      schemaVersion: 1,
      artifactId: 'g0.test',
      artifactKind: 'gate',
      artifactSchemaId: 'https://omniflow.local/schemas/cat-catch/gate-report.schema.json',
      contentHash: `sha256:${'0'.repeat(64)}`,
      byteLength: 1,
      evidenceInputCommit: '0'.repeat(40),
      evidenceInputTreeHash: `sha256:${'0'.repeat(64)}`,
      locations: [
        { storeId: 'primary', uri: 'https://evidence.invalid/a', canonical: true },
        { storeId: 'mirror', uri: 'https://evidence.invalid/b', canonical: true },
      ],
      validationSummary: {
        schemaValidated: true,
        hashValidated: true,
        reportedStatus: 'passed',
        validatedAt: '2026-08-23T00:00:00.000Z',
        validatorSourceManifestHash: `sha256:${'0'.repeat(64)}`,
      },
      indexedAt: '2026-08-23T00:00:00.000Z',
    }

    expect(validate(entry)).toBe(false)
    entry.locations[1] = {
      storeId: 'mirror',
      uri: 'https://evidence.invalid/b',
      canonical: false,
    }
    expect(validate(entry)).toBe(true)
  })
})
