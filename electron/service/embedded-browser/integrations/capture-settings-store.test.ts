import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => '/unused-user-data' },
}))

import { EmbeddedBrowserCaptureSettingsStore } from './capture-settings-store'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true })
  }
})

describe('EmbeddedBrowserCaptureSettingsStore', () => {
  it('network.capture-settings-persistence preserves defaults, normalization, and schema upgrades', () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'omniflow-capture-settings-'))
    temporaryDirectories.push(directory)
    const storePath = path.join(directory, 'nested', 'capture-rules.json')
    const store = new EmbeddedBrowserCaptureSettingsStore({
      createRuleId: () => 'generated-rule-id',
      storePath,
    })

    const updated = store.update({
      domainBlacklist: [' Blocked.Example ', 'blocked.example'],
      domainWhitelist: [' Allowed.Example '],
      extensions: ['.MP4', 'mp4'],
      mimeTypes: [' Video/MP4 '],
      regexRules: [
        {
          builtIn: false,
          enabled: true,
          flags: 'i',
          id: '',
          label: '',
          pattern: String.raw`https://allowed\.example/(.*)`,
        },
        {
          builtIn: false,
          enabled: true,
          flags: '[',
          id: 'invalid',
          label: 'invalid',
          pattern: '(',
        },
      ],
      version: 1,
    })

    expect(updated).toMatchObject({
      domainBlacklist: ['blocked.example'],
      domainWhitelist: ['allowed.example'],
      extensions: expect.arrayContaining(['mp4', 'lrc', 'webvtt']),
      mimeTypes: expect.arrayContaining(['video/mp4', 'text/vtt', 'application/ttml+xml']),
      regexRules: [{
        builtIn: false,
        enabled: true,
        flags: 'i',
        id: 'generated-rule-id',
        label: '未命名规则',
        pattern: String.raw`https://allowed\.example/(.*)`,
      }],
      version: 2,
    })

    const reloaded = new EmbeddedBrowserCaptureSettingsStore({ storePath }).list()
    expect(reloaded).toEqual(updated)

    const defaults = store.reset()
    expect(defaults.extensions).toEqual(expect.arrayContaining(['m3u8', 'mp4', 'ts', 'vtt', 'key']))
    expect(defaults.regexRules).toContainEqual(expect.objectContaining({
      blacklist: true,
      enabled: true,
      id: 'bilibili-live-m4s',
    }))
  })
})
