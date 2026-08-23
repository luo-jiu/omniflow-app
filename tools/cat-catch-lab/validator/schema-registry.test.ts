import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { loadAndValidateContracts } from './schema-registry.ts'

describe('Cat Catch required schema registry', () => {
  it('fails closed when a standalone report schema is absent', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'cat-catch-schema-registry-'))
    try {
      const { issues } = loadAndValidateContracts(directory)
      expect(issues).toContainEqual(expect.objectContaining({
        code: 'required-schema-missing',
        path: 'evidence-artifact.schema.json',
        severity: 'error',
      }))
    } finally {
      rmSync(directory, { force: true, recursive: true })
    }
  })
})
