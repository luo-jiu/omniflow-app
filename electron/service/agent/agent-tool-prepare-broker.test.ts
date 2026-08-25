import { describe, expect, it, vi } from 'vitest';

import { createAgentToolPrepareBroker } from './agent-tool-prepare-broker';

const OWNER_SCOPE = {
  accountScope: 'user:7',
  backendScope: 'https://example.com/api',
};

function prepareInput(signal: AbortSignal, onCancel = vi.fn()) {
  return {
    appContext: {
      currentDirectory: { id: 10, name: '视频' },
      libraryId: 3,
      platform: 'darwin' as const,
      selectedNodeIds: [8],
    },
    callId: 'call-1',
    inputHash: 'a'.repeat(64),
    onCancel,
    ownerScope: OWNER_SCOPE,
    ownerWebContentsId: 77,
    prepareInput: { libraryId: 3, nodeId: 8 },
    runId: 'run-1',
    sessionId: 'session-1',
    signal,
    toolRunId: 'tool-run-1',
    toolName: 'media.extractAudio',
  };
}

function completion(prepareId: string) {
  return {
    callId: 'call-1',
    inputHash: 'a'.repeat(64),
    libraryId: 3,
    ownerScope: OWNER_SCOPE,
    prepareId,
    result: { libraryReady: true, providerAlias: 'local-minio' },
    runId: 'run-1',
    sessionId: 'session-1',
    toolRunId: 'tool-run-1',
  };
}

describe('Agent tool prepare broker', () => {
  it('accepts one exact owner-bound result and rejects replay', async () => {
    const broker = createAgentToolPrepareBroker({ createId: () => 'prepare-1' });
    const prepared = broker.prepareRenderer(prepareInput(new AbortController().signal));
    const exact = completion(prepared.request.prepareId);

    const mismatches = [
      [88, exact],
      [77, { ...exact, libraryId: 4 }],
      [77, { ...exact, ownerScope: { ...OWNER_SCOPE, accountScope: 'user:8' } }],
      [77, { ...exact, callId: 'call-2' }],
      [77, { ...exact, inputHash: 'b'.repeat(64) }],
      [77, { ...exact, runId: 'run-2' }],
      [77, { ...exact, sessionId: 'session-2' }],
      [77, { ...exact, toolRunId: 'tool-run-2' }],
    ] as const;
    for (const [ownerWebContentsId, input] of mismatches) {
      expect(() => broker.completeRenderer(ownerWebContentsId, input))
        .toThrow('无权提交');
    }

    expect(broker.completeRenderer(77, exact)).toBe(true);
    await expect(prepared.outcome).resolves.toEqual({
      libraryReady: true,
      providerAlias: 'local-minio',
    });
    expect(() => broker.completeRenderer(77, exact)).toThrow('不存在或已经失效');
  });

  it('sanitizes sensitive values and enforces the 64 KB result limit', async () => {
    const broker = createAgentToolPrepareBroker({
      createId: vi.fn()
        .mockReturnValueOnce('prepare-sensitive')
        .mockReturnValueOnce('prepare-oversized'),
    });
    const sensitive = broker.prepareRenderer(prepareInput(new AbortController().signal));
    broker.completeRenderer(77, {
      ...completion(sensitive.request.prepareId),
      result: {
        authorization: 'Bearer private-token',
        providerAlias: 'local-minio',
      },
    });
    const sanitized = await sensitive.outcome;
    expect(JSON.stringify(sanitized)).not.toContain('private-token');

    const oversized = broker.prepareRenderer(prepareInput(new AbortController().signal));
    const rejected = expect(oversized.outcome).rejects.toThrow('超过安全上限');
    broker.completeRenderer(77, {
      ...completion(oversized.request.prepareId),
      result: { value: 'x'.repeat(64_001) },
    });
    await rejected;
  });

  it('cancels on abort and owner release', async () => {
    const broker = createAgentToolPrepareBroker({
      createId: vi.fn().mockReturnValueOnce('prepare-abort').mockReturnValueOnce('prepare-owner'),
    });
    const abortController = new AbortController();
    const abortCancel = vi.fn();
    const aborted = broker.prepareRenderer(prepareInput(abortController.signal, abortCancel));
    abortController.abort();
    await expect(aborted.outcome).rejects.toMatchObject({ name: 'AbortError' });
    expect(abortCancel).toHaveBeenCalledWith('prepare-abort');

    const ownerCancel = vi.fn();
    const released = broker.prepareRenderer(
      prepareInput(new AbortController().signal, ownerCancel),
    );
    broker.releaseOwner(77);
    await expect(released.outcome).rejects.toMatchObject({ name: 'AbortError' });
    expect(ownerCancel).toHaveBeenCalledWith('prepare-owner');
  });

  it('expires a preparation after its bounded timeout', async () => {
    vi.useFakeTimers();
    try {
      const onCancel = vi.fn();
      const broker = createAgentToolPrepareBroker({
        createId: () => 'prepare-timeout',
        timeoutMs: 1,
      });
      const prepared = broker.prepareRenderer(
        prepareInput(new AbortController().signal, onCancel),
      );
      const rejected = expect(prepared.outcome).rejects.toThrow('准备超时');

      await vi.advanceTimersByTimeAsync(1_000);

      await rejected;
      expect(onCancel).toHaveBeenCalledWith('prepare-timeout');
    } finally {
      vi.useRealTimers();
    }
  });
});
