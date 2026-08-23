import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { validateReleaseConfiguration } from './release-config.ts'
import type { JsonObject, ValidationContext } from './types.ts'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true })
  }
})

function createPolicyTarget(
  id: string,
  platform: 'linux' | 'macos' | 'windows',
  architectures: string[],
  packageFormats: string[],
  sourceRefs: JsonObject[] = [],
): JsonObject {
  return { architectures, id, packageFormats, platform, sourceRefs }
}

function createContext(targets: JsonObject[], builderConfiguration: string): ValidationContext {
  const appRoot = mkdtempSync(path.join(tmpdir(), 'cat-catch-release-config-'))
  temporaryDirectories.push(appRoot)
  writeFileSync(path.join(appRoot, 'electron-builder.json5'), builderConfiguration)
  return {
    appRoot,
    catCatchDirectory: path.join(appRoot, 'docs/cat-catch'),
    documents: new Map([['release-targets.json', { targets }]]),
    inputHashes: {},
    schemas: new Map(),
    upstreamRoot: appRoot,
  }
}

function codes(context: ValidationContext): string[] {
  return validateReleaseConfiguration(context).map(finding => finding.code)
}

describe('Cat Catch release configuration', () => {
  it('accepts a bidirectional platform, format, and explicit architecture match', () => {
    const context = createContext([
      createPolicyTarget('macos-arm64', 'macos', ['arm64'], ['dmg', 'zip'], [
        { path: 'electron-builder.json5', selector: '$.mac.target' },
      ]),
      createPolicyTarget('windows-x64', 'windows', ['x64'], ['nsis'], [
        { path: 'electron-builder.json5', selector: '$.win.target' },
      ]),
      createPolicyTarget('linux-x64', 'linux', ['x64'], ['appimage'], [
        { path: 'electron-builder.json5', selector: '$.linux.target' },
      ]),
    ], `{
      // The parser must accept the actual JSON5 format without executing it.
      mac: { target: [
        { target: 'dmg', arch: ['arm64'] },
        { target: 'zip', arch: 'arm64' },
      ] },
      win: { target: [{ target: 'NSIS', arch: ['X64'] }] },
      linux: { target: [{ target: 'AppImage', arch: ['x64'] }] },
    }`)

    expect(validateReleaseConfiguration(context)).toEqual([])
  })

  it('detects a policy platform missing from electron-builder', () => {
    const context = createContext([
      createPolicyTarget('macos-arm64', 'macos', ['arm64'], ['dmg']),
    ], `{ win: { target: [{ target: 'nsis', arch: ['x64'] }] } }`)

    expect(codes(context)).toContain('release-policy-target-missing-from-builder')
  })

  it('detects an electron-builder platform missing from policy', () => {
    const context = createContext([
      createPolicyTarget('macos-arm64', 'macos', ['arm64'], ['dmg']),
    ], `{
      mac: { target: [{ target: 'dmg', arch: ['arm64'] }] },
      win: { target: [{ target: 'nsis', arch: ['x64'] }] },
    }`)

    expect(codes(context)).toContain('release-builder-target-missing-from-policy')
  })

  it('compares package formats in both directions', () => {
    const context = createContext([
      createPolicyTarget('macos-arm64', 'macos', ['arm64'], ['dmg', 'zip']),
    ], `{ mac: { target: [
      { target: 'dmg', arch: ['arm64'] },
      { target: 'pkg', arch: ['arm64'] },
    ] } }`)

    const finding = validateReleaseConfiguration(context).find(value => (
      value.code === 'release-target-format-mismatch'
    ))
    expect(finding?.message).toContain('policy [dmg, zip]')
    expect(finding?.message).toContain('electron-builder [dmg, pkg]')
  })

  it('does not infer an architecture from the host or artifact path', () => {
    const context = createContext([
      createPolicyTarget('macos-arm64', 'macos', ['arm64'], ['dmg']),
    ], `{ mac: { target: ['dmg'], artifactName: 'release/mac-arm64/app.dmg' } }`)

    expect(codes(context)).toContain('release-target-architecture-mismatch')
  })

  it('detects architecture differences after normalization', () => {
    const context = createContext([
      createPolicyTarget('windows-x64', 'windows', ['x64'], ['nsis']),
    ], `{ win: { target: [{ target: 'NSIS', arch: ['arm64'] }] } }`)

    expect(codes(context)).toContain('release-target-architecture-mismatch')
  })

  it('detects duplicate normalized builder targets', () => {
    const context = createContext([
      createPolicyTarget('windows-x64', 'windows', ['x64'], ['nsis']),
    ], `{ win: { target: [
      { target: 'nsis', arch: ['x64'] },
      { target: 'NSIS', arch: ['X64'] },
    ] } }`)

    expect(codes(context)).toContain('release-target-duplicate')
  })

  it('reports malformed and unsupported builder declarations without executing them', () => {
    const malformed = createContext([
      createPolicyTarget('macos-arm64', 'macos', ['arm64'], ['dmg']),
    ], `{ mac: { target: [ } }`)
    const unsupported = createContext([
      createPolicyTarget('macos-arm64', 'macos', ['arm64'], ['dmg']),
    ], `{ mac: { target: [{ target: 'dmg', arch: { value: 'arm64' } }] } }`)

    expect(codes(malformed)).toEqual(['release-builder-config-invalid'])
    expect(codes(unsupported)).toContain('release-builder-target-shape-unsupported')
  })

  it('accepts an exact release script anchor with a literal architecture flag', () => {
    const selector = "run('npm', ['run', 'build:mac', '--', '--arm64'])"
    const context = createContext([
      createPolicyTarget('macos-arm64', 'macos', ['arm64'], ['dmg'], [
        { path: 'electron-builder.json5', selector: '$.mac.target' },
        { path: 'tools/release-mac.mjs', selector },
      ]),
    ], `{ mac: { target: ['dmg'] } }`)
    mkdirSync(path.join(context.appRoot, 'tools'))
    writeFileSync(path.join(context.appRoot, 'tools/release-mac.mjs'), `${selector}\n`)

    expect(validateReleaseConfiguration(context)).toEqual([])
  })

  it('rejects a stale release script selector and leaves architecture unproven', () => {
    const context = createContext([
      createPolicyTarget('macos-arm64', 'macos', ['arm64'], ['dmg'], [
        { path: 'electron-builder.json5', selector: '$.mac.target' },
        {
          path: 'tools/release-mac.mjs',
          selector: "run('npm', ['run', 'build:mac', '--', '--arm64'])",
        },
      ]),
    ], `{ mac: { target: ['dmg'] } }`)
    mkdirSync(path.join(context.appRoot, 'tools'))
    writeFileSync(
      path.join(context.appRoot, 'tools/release-mac.mjs'),
      "run('npm', ['run', 'build:mac'])\n",
    )

    expect(codes(context)).toEqual(expect.arrayContaining([
      'release-source-ref-selector-unresolved',
      'release-target-architecture-mismatch',
    ]))
  })

  it('does not treat an architecture mentioned outside command arguments as explicit', () => {
    const selector = '// build:mac --arm64'
    const context = createContext([
      createPolicyTarget('macos-arm64', 'macos', ['arm64'], ['dmg'], [
        { path: 'tools/release-mac.mjs', selector },
      ]),
    ], `{ mac: { target: ['dmg'] } }`)
    mkdirSync(path.join(context.appRoot, 'tools'))
    writeFileSync(path.join(context.appRoot, 'tools/release-mac.mjs'), `${selector}\n`)

    expect(codes(context)).toContain('release-target-architecture-mismatch')
  })
})
