import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createSQLiteAgentShellLogPersistence } from './agent-shell-log-sqlite';

const OWNER = Object.freeze({
  accountScope: 'user:7',
  backendScope: 'https://example.com/api',
  sessionId: 'session-1',
});

describe('Agent Shell SQLite log persistence', () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map(directory => (
      rm(directory, { force: true, recursive: true })
    )));
  });

  it('round-trips metadata and physical frame references without inline detailed text', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'omniflow-agent-shell-log-sqlite-'));
    temporaryDirectories.push(directory);
    const persistence = await createSQLiteAgentShellLogPersistence(path.join(directory, 'agent.sqlite3'));
    const logRef = `log:v1:${'a'.repeat(64)}`;
    const record = {
      executionId: 'execution-1',
      owner: OWNER,
      runId: 'run-1',
      sessionId: OWNER.sessionId,
      toolRunId: 'tool-run-1',
      createdAt: 10,
      detailedBytes: 4,
      detailedFrameRefs: [{
        byteLength: 4,
        offset: 0,
        recordBytes: 120,
        sequence: 1,
        stream: 'stdout' as const,
        observedAt: '2026-08-29T00:00:00.000Z',
      }],
      droppedDetailedBytes: 0,
      expiresAt: 20,
      expired: false,
      finished: true,
      generation: 1,
      lastSequence: 1,
      logRef,
      tailBytes: 4,
      tailFrames: [{
        executionId: 'execution-1',
        sequence: 1,
        stream: 'stdout' as const,
        text: 'test',
        observedAt: '2026-08-29T00:00:00.000Z',
      }],
      truncatedBefore: null,
    };
    await persistence.replace([record]);
    await expect(persistence.load()).resolves.toEqual([record]);
    await persistence.close?.();
  });
});
