import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { app } from 'electron';

import type {
  AgentShellPermissionMode,
  AgentShellSettingsSnapshot,
} from '../../../../src/shared/agent/shell/agent-shell.types';

const SETTINGS_SCHEMA_VERSION = 1 as const;
const SETTINGS_FILE_NAME = 'agent-shell-settings.json';

interface AgentShellSettingsStoreOptions {
  readonly storePath?: string;
}

function normalizePermissionMode(input: unknown): AgentShellPermissionMode {
  if (input === 'ask' || input === 'auto' || input === 'full-access') return input;
  throw new Error('Agent Shell 权限模式无效');
}

function defaultSettings(): AgentShellSettingsSnapshot {
  return Object.freeze({ permissionMode: 'ask', version: SETTINGS_SCHEMA_VERSION });
}

export function createAgentShellSettingsStore(options: AgentShellSettingsStoreOptions = {}) {
  let cached: AgentShellSettingsSnapshot | null = null;

  function resolveStorePath(): string | null {
    if (options.storePath) return options.storePath;
    if (!app || typeof app.getPath !== 'function') return null;
    return path.join(app.getPath('userData'), SETTINGS_FILE_NAME);
  }

  function load(): AgentShellSettingsSnapshot {
    if (cached) return cached;
    const storePath = resolveStorePath();
    if (!storePath) {
      cached = defaultSettings();
      return cached;
    }
    if (!existsSync(storePath)) {
      cached = defaultSettings();
      return cached;
    }
    try {
      const parsed = JSON.parse(readFileSync(storePath, 'utf8')) as Record<string, unknown>;
      if (Number(parsed.version) !== SETTINGS_SCHEMA_VERSION) {
        cached = defaultSettings();
        return cached;
      }
      cached = Object.freeze({
        permissionMode: normalizePermissionMode(parsed.permissionMode),
        version: SETTINGS_SCHEMA_VERSION,
      });
      return cached;
    } catch {
      cached = defaultSettings();
      return cached;
    }
  }

  function updatePermissionMode(input: unknown): AgentShellSettingsSnapshot {
    const next = Object.freeze({
      permissionMode: normalizePermissionMode(input),
      version: SETTINGS_SCHEMA_VERSION,
    });
    const storePath = resolveStorePath();
    if (!storePath) throw new Error('当前运行时不支持持久化 Agent Shell 设置');
    const directoryPath = path.dirname(storePath);
    mkdirSync(directoryPath, { recursive: true });
    const temporaryPath = `${storePath}.tmp`;
    writeFileSync(temporaryPath, `${JSON.stringify(next, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
    renameSync(temporaryPath, storePath);
    cached = next;
    return next;
  }

  return Object.freeze({ load, updatePermissionMode });
}

export const agentShellSettingsStore = createAgentShellSettingsStore();
