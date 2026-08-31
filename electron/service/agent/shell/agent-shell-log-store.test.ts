import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type { AgentShellProcessOutputEvent } from './agent-shell-process-supervisor';
import { createAgentShellLogFileStore } from './agent-shell-log-file-store';
import { createSQLiteAgentShellLogPersistence } from './agent-shell-log-sqlite';
import { createAgentShellLogStore } from './agent-shell-log-store';

const OWNER = Object.freeze({
  accountScope: 'user:7',
  backendScope: 'https://example.com/api',
  sessionId: 'session-1',
});
const IDENTITY = Object.freeze({
  executionId: 'execution-1',
  owner: OWNER,
  runId: 'run-1',
  sessionId: 'session-1',
  toolRunId: 'tool-run-1',
});

function output(
  text: string,
  stream: 'stdout' | 'stderr' = 'stdout',
  sequence = 0,
): AgentShellProcessOutputEvent {
  return {
    byteLength: Buffer.byteLength(text, 'utf8'),
    executionId: IDENTITY.executionId,
    kind: 'output',
    sequence,
    stream,
    text,
    timestamp: Date.now(),
  };
}

function createFixture(options: Parameters<typeof createAgentShellLogStore>[0] = {}) {
  const store = createAgentShellLogStore({
    createId: (() => {
      let next = 0;
      return () => `id-${next += 1}`;
    })(),
    ...options,
  });
  const handle = store.create(IDENTITY);
  return { handle, store };
}

describe('Agent Shell log store', () => {
  it('strips ANSI and OSC sequences across chunks before assigning ordered frames', async () => {
    const { handle, store } = createFixture();
    handle.appendSupervisorOutput(output('hello \u001b[31'));
    handle.appendSupervisorOutput(output('mred\u001b]8;;https://example.test\u0007link\u001b]8;;\u001b\\!'));
    handle.finish();
    const page = await store.readPage({ ...IDENTITY, logRef: handle.logRef });
    expect(page.frames.map(frame => frame.text).join('')).toBe('hello redlink!');
    expect(page.frames.map(frame => frame.sequence)).toEqual([1, 2]);
  });

  it('redacts a secret split between output chunks', async () => {
    const { handle, store } = createFixture();
    handle.appendSupervisorOutput(output('apiKey=sk-1234567890'));
    handle.appendSupervisorOutput(output('abcdefghij\n'));
    handle.finish();
    const page = await store.readPage({ ...IDENTITY, logRef: handle.logRef });
    const text = page.frames.map(frame => frame.text).join('');
    expect(text).toContain('apiKey=[REDACTED]');
    expect(text).not.toContain('sk-1234567890');
  });

  it('does not leak a short secret prefix when another stream arrives before completion', async () => {
    const { handle, store } = createFixture();
    handle.appendSupervisorOutput(output('apiKey=sk-123', 'stdout'));
    handle.appendSupervisorOutput(output('warning\n', 'stderr'));
    handle.appendSupervisorOutput(output('4567890\n', 'stdout'));
    handle.finish();
    const page = await store.readPage({ ...IDENTITY, logRef: handle.logRef });
    expect(page.frames.map(frame => frame.text).join('')).toContain('apiKey=[REDACTED]');
    expect(page.frames.map(frame => frame.text).join('')).not.toContain('sk-1234567890');
    expect(page.frames.map(frame => frame.stream)).toEqual(['stderr', 'stdout']);
  });

  it('keeps stdout and stderr in one monotonic sequence and preserves Unicode frame boundaries', async () => {
    const { handle, store } = createFixture({ maxDetailedBytes: 64 * 1024 });
    const text = `${'界'.repeat(8_000)}\n`;
    handle.appendSupervisorOutput(output(text));
    handle.appendSupervisorOutput(output('warning', 'stderr', 99));
    handle.finish();
    const page = await store.readPage({ ...IDENTITY, logRef: handle.logRef });
    expect(page.frames.map(frame => frame.sequence)).toEqual(
      page.frames.map((_, index) => index + 1),
    );
    expect(page.frames.at(-1)?.stream).toBe('stderr');
    expect(page.frames.map(frame => frame.text).join('')).toBe(`${text}warning`);
  });

  it('keeps an independent bounded tail and reports dropped detailed bytes as a gap', async () => {
    const { handle, store } = createFixture({
      maxDetailedBytes: 16 * 1024,
      maxTailBytes: 16 * 1024,
      maxTailFrames: 128,
    });
    handle.appendSupervisorOutput(output(`${'a'.repeat(12_000)}\n`));
    handle.appendSupervisorOutput(output(`${'b'.repeat(12_000)}\n`, 'stderr'));
    handle.appendSupervisorOutput(output(`${'c'.repeat(12_000)}\n`));
    handle.finish();
    const tail = handle.getTail();
    expect(tail.truncatedBefore).toBe(3);
    const page = await store.readPage({ ...IDENTITY, logRef: handle.logRef, afterSequence: 1 });
    expect(page.unavailableThrough).toBe(2);
    expect(page.frames[0]?.sequence).toBe(3);
  });

  it('supports bounded paging and opaque cursor continuation', async () => {
    const { handle, store } = createFixture({ maxPageFrames: 2 });
    handle.appendSupervisorOutput(output('one\n'));
    handle.appendSupervisorOutput(output('two\n', 'stderr'));
    handle.appendSupervisorOutput(output('three\n'));
    handle.finish();
    const first = await store.readPage({ ...IDENTITY, logRef: handle.logRef, maxFrames: 2 });
    expect(first.frames.map(frame => frame.text).join('')).toBe('one\ntwo\n');
    expect(first.nextCursor).toMatch(/^cursor:v1:/u);
    const second = await store.readPage({ ...IDENTITY, logRef: handle.logRef, cursor: first.nextCursor });
    expect(second.frames.map(frame => frame.text).join('')).toBe('three\n');
    await expect(store.readPage({ ...IDENTITY, logRef: handle.logRef, cursor: 'cursor:v1:bad' }))
      .rejects.toThrow('cursor 无效');
  });

  it('rejects identity mismatches and cursor reuse after disposal', async () => {
    const { handle, store } = createFixture();
    handle.appendSupervisorOutput(output('value'));
    const cursorPage = await store.readPage({ ...IDENTITY, logRef: handle.logRef, maxFrames: 1 });
    await handle.dispose();
    await expect(store.readPage({
      ...IDENTITY,
      logRef: handle.logRef,
      cursor: cursorPage.nextCursor,
    })).rejects.toThrow('logRef 不存在');
    const otherIdentity = { ...IDENTITY, toolRunId: 'other-tool-run' };
    const second = createFixture();
    await expect(second.store.readPage({ ...otherIdentity, logRef: second.handle.logRef }))
      .rejects.toThrow('身份不匹配');
  });

  it('returns an expired terminal projection and does not expose expired正文', async () => {
    let currentTime = 10_000;
    const { handle, store } = createFixture({ now: () => currentTime, ttlMs: 100 });
    handle.appendSupervisorOutput(output('before expiry'));
    currentTime += 101;
    expect(store.sweep()).toBe(1);
    expect(handle.getTail().frames).toEqual([]);
    const page = await store.readPage({ ...IDENTITY, logRef: handle.logRef });
    expect(page.expired).toBe(true);
    expect(page.frames).toEqual([]);
    expect(handle.finish().frames).toEqual([]);
  });

  it('freezes a finished log against late Supervisor output', () => {
    const { handle } = createFixture();
    handle.appendSupervisorOutput(output('done'));
    handle.finish();
    expect(() => handle.appendSupervisorOutput(output('late'))).toThrow('已经结束');
    expect(handle.finish().frames).toEqual([]);
  });

  it('restores bounded records through the injectable persistence adapter', async () => {
    let saved: readonly unknown[] = [];
    const persistence = {
      load: vi.fn(async () => saved as never),
      replace: vi.fn(async (records: readonly unknown[]) => {
        saved = records;
      }),
    };
    const first = createFixture({ persistence });
    first.handle.appendSupervisorOutput(output('persisted'));
    first.handle.finish();
    await first.store.flush();
    const second = createAgentShellLogStore({ persistence, createId: () => 'second-id' });
    await second.ready;
    const restored = second.getTail({ ...IDENTITY, logRef: first.handle.logRef });
    expect(restored.frames.map(frame => frame.text).join('')).toBe('persisted');
  });

  it('stores detailed frames in the physical log store and restores them by offset', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'omniflow-agent-shell-log-store-'));
    const physicalStore = createAgentShellLogFileStore({ rootPath: root });
    const store = createAgentShellLogStore({ physicalStore });
    try {
      await physicalStore.ready;
      const handle = store.create(IDENTITY);
      handle.appendSupervisorOutput(output('physical\n'));
      handle.finish();
      await store.flush();

      const page = await store.readPage({ ...IDENTITY, logRef: handle.logRef });
      expect(page.frames.map(frame => frame.text).join('')).toBe('physical\n');
      const file = await readFile(path.join(root, `agent-shell-log-${handle.logRef.slice('log:v1:'.length)}`, 'detailed.ndjson'), 'utf8');
      expect(file).toContain('physical\\n');
      expect(file).toContain('"sequence":1');
    } finally {
      await store.dispose();
      await physicalStore.dispose();
      await rm(root, { recursive: true, force: true });
    }
  });

  it('waits for an in-flight physical append before disposing the log handle', async () => {
    let resolveAppend: (() => void) | undefined;
    let appendStarted = false;
    const appendGate = new Promise<void>(resolve => {
      resolveAppend = resolve;
    });
    const physicalHandle = {
      append: async (data: Uint8Array | string) => {
        appendStarted = true;
        await appendGate;
        const bytes = typeof data === 'string' ? Buffer.byteLength(data, 'utf8') : data.byteLength;
        return { acceptedBytes: bytes, droppedBytes: 0, sizeBytes: bytes };
      },
      getSize: async () => 0,
      logRef: 'physical-handle',
      read: async () => ({
        data: new Uint8Array(),
        eof: true,
        nextOffset: 0,
        offset: 0,
        sizeBytes: 0,
      }),
    };
    const physicalStore = {
      create: async () => physicalHandle,
      open: async () => physicalHandle,
    };
    const store = createAgentShellLogStore({ physicalStore });
    const handle = store.create(IDENTITY);
    handle.appendSupervisorOutput(output('pending'));
    for (let attempt = 0; attempt < 10 && !appendStarted; attempt += 1) await Promise.resolve();
    expect(appendStarted).toBe(true);

    let disposed = false;
    const disposing = handle.dispose().then(() => {
      disposed = true;
    });
    await Promise.resolve();
    expect(disposed).toBe(false);

    resolveAppend?.();
    await disposing;
    expect(disposed).toBe(true);
    await store.dispose();
  });

  it('flushes only the current handle after an in-flight physical append', async () => {
    let resolveAppend: (() => void) | undefined;
    let appendStarted = false;
    let physicalSize = 0;
    const appendGate = new Promise<void>(resolve => {
      resolveAppend = resolve;
    });
    const physicalHandle = {
      append: async (data: Uint8Array | string) => {
        appendStarted = true;
        await appendGate;
        const bytes = typeof data === 'string' ? Buffer.byteLength(data, 'utf8') : data.byteLength;
        physicalSize += bytes;
        return { acceptedBytes: bytes, droppedBytes: 0, sizeBytes: physicalSize };
      },
      getSize: async () => physicalSize,
      logRef: 'physical-handle',
      read: async () => ({
        data: new Uint8Array(),
        eof: true,
        nextOffset: 0,
        offset: 0,
        sizeBytes: physicalSize,
      }),
    };
    const physicalStore = {
      create: async () => physicalHandle,
      open: async () => physicalHandle,
    };
    const store = createAgentShellLogStore({ physicalStore });
    const handle = store.create(IDENTITY);
    handle.appendSupervisorOutput(output('flush me'));
    for (let attempt = 0; attempt < 10 && !appendStarted; attempt += 1) await Promise.resolve();
    expect(appendStarted).toBe(true);

    let flushed = false;
    const flushing = handle.flush().then(() => {
      flushed = true;
    });
    await Promise.resolve();
    expect(flushed).toBe(false);
    resolveAppend?.();
    await flushing;
    expect(flushed).toBe(true);
    await store.dispose();
  });

  it('restores a physical log through SQLite metadata without copying detailed text into the snapshot', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'omniflow-agent-shell-log-restart-'));
    const databasePath = path.join(root, 'agent.sqlite3');
    const physicalStore = createAgentShellLogFileStore({ rootPath: path.join(root, 'logs') });
    const persistence = await createSQLiteAgentShellLogPersistence(databasePath);
    const first = createAgentShellLogStore({ physicalStore, persistence });
    let logRef = '';
    try {
      await physicalStore.ready;
      const handle = first.create(IDENTITY);
      logRef = handle.logRef;
      handle.appendSupervisorOutput(output('restart-safe'));
      handle.finish();
      await first.flush();
      await persistence.close?.();
      await physicalStore.dispose();

      const restoredPhysicalStore = createAgentShellLogFileStore({ rootPath: path.join(root, 'logs') });
      const restoredPersistence = await createSQLiteAgentShellLogPersistence(databasePath);
      const second = createAgentShellLogStore({
        physicalStore: restoredPhysicalStore,
        persistence: restoredPersistence,
      });
      try {
        await restoredPhysicalStore.ready;
        await second.ready;
        const page = await second.readPage({ ...IDENTITY, logRef });
        expect(page.frames.map(frame => frame.text).join('')).toBe('restart-safe');
      } finally {
        await second.dispose();
        await restoredPhysicalStore.dispose();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('reserves detailed-log quota, coalesces growth, and commits the final byte count', async () => {
    const calls: string[] = [];
    const quota = {
      reserve: vi.fn(async (input: { resourceRef: string; expectedBytes: number }) => {
        calls.push(`reserve:${input.expectedBytes}`);
        return { reservationId: 'reservation-1', resourceRef: input.resourceRef };
      }),
      adjust: vi.fn(async (input: { bytes: number }) => {
        calls.push(`adjust:${input.bytes}`);
      }),
      commit: vi.fn(async (input: { actualBytes: number }) => {
        calls.push(`commit:${input.actualBytes}`);
      }),
      markDeleting: vi.fn(async () => {
        calls.push('mark-deleting');
      }),
      release: vi.fn(async () => {
        calls.push('release');
      }),
    };
    const { handle, store } = createFixture({
      maxDetailedBytes: 64 * 1024,
      quota,
    });
    handle.appendSupervisorOutput(output('abc'));
    handle.appendSupervisorOutput(output('def'));
    await store.flush();
    expect(calls).toEqual(['reserve:65536', 'adjust:6']);

    handle.finish();
    await store.flush();
    expect(calls).toEqual(['reserve:65536', 'adjust:6', 'commit:6']);
    expect(quota.adjust).toHaveBeenCalledTimes(1);
    expect(quota.commit).toHaveBeenCalledWith(expect.objectContaining({
      actualBytes: 6,
      reservationId: 'reservation-1',
      resourceRef: handle.logRef,
    }));
  });

  it('commits directly when a log finishes before its asynchronous reservation resolves', async () => {
    let resolveReservation: ((value: { reservationId: string; resourceRef: string }) => void) | undefined;
    const quota = {
      reserve: vi.fn((input: { resourceRef: string }) => new Promise<{ reservationId: string; resourceRef: string }>((resolve) => {
        resolveReservation = value => resolve({
          ...value,
          resourceRef: value.resourceRef || input.resourceRef,
        });
      })),
      adjust: vi.fn(async () => undefined),
      commit: vi.fn(async () => undefined),
      markDeleting: vi.fn(async () => undefined),
      release: vi.fn(async () => undefined),
    };
    const { handle, store } = createFixture({ quota });
    handle.appendSupervisorOutput(output('finished'));
    handle.finish();
    await Promise.resolve();
    resolveReservation?.({ reservationId: 'reservation-2', resourceRef: handle.logRef });
    await store.flush();
    expect(quota.adjust).not.toHaveBeenCalled();
    expect(quota.commit).toHaveBeenCalledWith(expect.objectContaining({ actualBytes: 8 }));
  });

  it('keeps draining when detailed quota is full and only accounts accepted bytes', async () => {
    const quota = {
      reserve: vi.fn(async (input: { resourceRef: string; expectedBytes: number }) => ({
        reservationId: 'reservation-3',
        resourceRef: input.resourceRef,
      })),
      adjust: vi.fn(async () => undefined),
      commit: vi.fn(async () => undefined),
      markDeleting: vi.fn(async () => undefined),
      release: vi.fn(async () => undefined),
    };
    const { handle, store } = createFixture({
      maxDetailedBytes: 16 * 1024,
      quota,
    });
    const result = handle.appendSupervisorOutput(output(`${'x'.repeat(20 * 1024)}\n`));
    expect(result.frames.length).toBeGreaterThan(0);
    expect(result.droppedDetailedBytes).toBeGreaterThan(0);
    handle.finish();
    await store.flush();
    expect(quota.commit).toHaveBeenCalledWith(expect.objectContaining({ actualBytes: 16 * 1024 }));
  });

  it('does not block synchronous Supervisor output when quota admission fails', async () => {
    const quota = {
      reserve: vi.fn(async () => {
        throw new Error('quota unavailable');
      }),
      adjust: vi.fn(async () => undefined),
      commit: vi.fn(async () => undefined),
      markDeleting: vi.fn(async () => undefined),
      release: vi.fn(async () => undefined),
    };
    const { handle, store } = createFixture({ quota });
    expect(handle.appendSupervisorOutput(output('still drains')).frames).toHaveLength(1);
    await expect(store.flush()).rejects.toThrow('quota unavailable');
  });

  it('marks and releases quota after TTL expiry and during explicit disposal', async () => {
    let currentTime = 20_000;
    const quota = {
      reserve: vi.fn(async (input: { resourceRef: string }) => ({
        reservationId: 'reservation-4',
        resourceRef: input.resourceRef,
      })),
      adjust: vi.fn(async () => undefined),
      commit: vi.fn(async () => undefined),
      markDeleting: vi.fn(async () => undefined),
      release: vi.fn(async () => undefined),
    };
    const { handle, store } = createFixture({ now: () => currentTime, quota, ttlMs: 100 });
    handle.appendSupervisorOutput(output('expire me'));
    await store.flush();
    currentTime += 101;
    expect(store.sweep()).toBe(1);
    await store.flush();
    expect(quota.markDeleting).toHaveBeenCalledWith(expect.objectContaining({
      observedBytes: 9,
      reservationId: 'reservation-4',
    }));
    expect(quota.release).toHaveBeenCalledWith(expect.objectContaining({
      reservationId: 'reservation-4',
      resourceRef: handle.logRef,
    }));

    const second = createFixture({ quota });
    second.handle.appendSupervisorOutput(output('dispose me'));
    await second.handle.dispose();
    expect(quota.markDeleting).toHaveBeenCalledWith(expect.objectContaining({
      resourceRef: second.handle.logRef,
    }));
  });
});
