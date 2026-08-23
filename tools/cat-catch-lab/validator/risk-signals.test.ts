import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { deriveCapabilityRiskSignals } from './risk-signals.ts'
import type { JsonObject, ValidationContext } from './types.ts'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true })
  }
})

function createContext(): ValidationContext {
  const repository = mkdtempSync(path.join(tmpdir(), 'cat-catch-risk-source-'))
  temporaryDirectories.push(repository)
  execFileSync('git', ['init', '--quiet'], { cwd: repository })
  execFileSync('git', ['config', 'user.email', 'validator@example.invalid'], { cwd: repository })
  execFileSync('git', ['config', 'user.name', 'Validator Test'], { cwd: repository })
  writeFileSync(path.join(repository, 'neutral.ts'), [
    "ipcMain.handle('neutral', async () => {",
    "  const headers = { Authorization: 'Bearer token', Cookie: 'session=secret' }",
    '  const workDirectory = mkdtemp(tmpdir())',
    "  return spawn('ffmpeg', ['-i', workDirectory, String(MediaSource), JSON.stringify(headers)])",
    '})',
    '',
  ].join('\n'))
  execFileSync('git', ['add', 'neutral.ts'], { cwd: repository })
  execFileSync('git', ['commit', '--quiet', '-m', 'neutral source'], { cwd: repository })
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' }).trim()
  return {
    appRoot: repository,
    catCatchDirectory: path.join(repository, 'docs/cat-catch'),
    documents: new Map<string, JsonObject>([
      ['upstream-state.json', { observedHead: head }],
      ['legacy-inventory.json', {
        entries: [{
          id: 'neutral-node',
          entryType: 'current-node',
          capabilityId: 'neutral.capability',
          path: 'neutral.ts',
          symbol: "ipcMain.handle('neutral'",
        }],
      }],
    ]),
    inputHashes: {},
    schemas: new Map(),
    upstreamRoot: repository,
  }
}

describe('Cat Catch source-derived risk signals', () => {
  it('detects cross-process, credential, temp, process, and media risk under a neutral name', () => {
    const context = createContext()
    const signals = deriveCapabilityRiskSignals(context, {
      id: 'neutral.capability',
      boundary: 'neutral.boundary',
      origin: 'omniflow-integration',
      additionalRiskTags: [],
      auditedThrough: null,
      upstreamSources: [],
      localContractRefs: [{ path: 'neutral.ts', anchor: "ipcMain.handle('neutral'" }],
      ownerRefs: { targetProduction: [], candidate: [], legacy: [] },
    })

    expect([...signals]).toEqual(expect.arrayContaining([
      'cross-process',
      'credentials',
      'external-process',
      'large-media',
      'long-task',
      'security-boundary',
      'temp-file',
    ]))
  })
})
