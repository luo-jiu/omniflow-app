import type { WebContents } from 'electron';
import { describe, expect, it, vi } from 'vitest';

import type {
  AgentFileAuthorityCompletionV1,
  AgentFileAuthorityNodeSnapshotV1,
  AgentFileAuthorityRequestV1,
} from '@/shared/agent/agent.types';
import { createAgentFileAuthorityBroker } from './agent-file-authority-broker';

it('binds metadata queries to their owner and library and strips physical storage fields', async () => {
  const broker = createAgentFileAuthorityBroker({ createId: () => 'metadata-query' });
  const pending = broker.request({ libraryId: 3, operation: { operation: 'query-library-metadata', query: { kind: 'stat', nodeId: 8 } },
    ownerScope: OWNER_SCOPE, runId: 'run-1', sessionId: 'session-1', toolRunId: 'tool-run-1', sender: sender(), signal: new AbortController().signal });
  const reply = completion('metadata-query', { result: { operation: 'query-library-metadata', version: 1, data: { libraryId: 3, node: { ...node(), path: '/source.txt' } } } });
  expect(() => broker.complete(99, reply)).toThrow('无权');
  expect(broker.complete(17, reply)).toBe(true);
  const result = await pending;
  expect(result).toMatchObject({ operation: 'query-library-metadata', data: { node: { id: 8, path: '/source.txt' } } });
  expect(JSON.stringify(result)).not.toContain('libraries/3/source.txt');
  expect(() => broker.complete(17, reply)).toThrow('失效');
});

const OWNER_SCOPE = Object.freeze({
  accountScope: 'user:7',
  backendScope: 'https://example.com/api',
});

function node(overrides: Partial<AgentFileAuthorityNodeSnapshotV1> = {}) {
  return {
    fileSize: 12,
    id: 8,
    libraryId: 3,
    name: 'source.txt',
    parentId: 2,
    storageKey: 'libraries/3/source.txt',
    storageProvider: 'local',
    type: 'file' as const,
    updatedAt: '2026-08-31T00:00:00Z',
    version: 1 as const,
    ...overrides,
  };
}

function sender(
  send: (channel: string, request: AgentFileAuthorityRequestV1) => void = vi.fn(),
  id = 17,
): WebContents {
  return {
    id,
    isDestroyed: () => false,
    send,
  } as unknown as WebContents;
}

function completion(
  authorityId: string,
  overrides: Partial<AgentFileAuthorityCompletionV1> = {},
): AgentFileAuthorityCompletionV1 {
  return {
    authorityId,
    libraryId: 3,
    ownerScope: OWNER_SCOPE,
    result: {
      node: node(),
      operation: 'stage-library-node',
      version: 1,
    },
    runId: 'run-1',
    sessionId: 'session-1',
    toolRunId: 'tool-run-1',
    version: 1,
    ...overrides,
  };
}

function request(
  broker: ReturnType<typeof createAgentFileAuthorityBroker>,
  requestSender: WebContents,
  signal = new AbortController().signal,
) {
  return broker.request({
    libraryId: 3,
    operation: {
      includeDownloadUrl: true,
      nodeId: 8,
      operation: 'stage-library-node',
    },
    ownerScope: OWNER_SCOPE,
    runId: 'run-1',
    sender: requestSender,
    sessionId: 'session-1',
    signal,
    toolRunId: 'tool-run-1',
  });
}

function resolveRequest(
  broker: ReturnType<typeof createAgentFileAuthorityBroker>,
  requestSender: WebContents,
  signal = new AbortController().signal,
) {
  return broker.request({
    libraryId: 3,
    operation: {
      directoryPath: '  /文档/提示词  ',
      operation: 'resolve-library-directory',
    },
    ownerScope: OWNER_SCOPE,
    runId: 'run-1',
    sender: requestSender,
    sessionId: 'session-1',
    signal,
    toolRunId: 'tool-run-1',
  });
}

function resolveCompletion(
  authorityId: string,
  overrides: Partial<AgentFileAuthorityCompletionV1> = {},
): AgentFileAuthorityCompletionV1 {
  return completion(authorityId, {
    result: {
      operation: 'resolve-library-directory',
      parent: node({
        fileSize: 0,
        id: 20,
        name: '提示词',
        parentId: 10,
        type: 'dir',
      }),
      version: 1,
    },
    ...overrides,
  });
}

describe('Agent file authority broker', () => {
  it('accepts one identity-bound completion and rejects replay', async () => {
    let delivered: AgentFileAuthorityRequestV1 | undefined;
    const broker = createAgentFileAuthorityBroker({ createId: () => 'authority-1' });
    const pending = request(broker, sender((_channel, payload) => {
      delivered = payload;
    }));

    expect(delivered).toMatchObject({
      authorityId: 'authority-1',
      nodeId: 8,
      operation: 'stage-library-node',
    });
    const input = completion('authority-1');
    expect(broker.complete(17, input)).toBe(true);
    await expect(pending).resolves.toEqual(input.result);
    expect(() => broker.complete(17, input)).toThrow('不存在或已经失效');
  });

  it('normalizes a library path request and accepts a strict directory result', async () => {
    let delivered: AgentFileAuthorityRequestV1 | undefined;
    const broker = createAgentFileAuthorityBroker({ createId: () => 'authority-resolve' });
    const pending = resolveRequest(broker, sender((_channel, payload) => {
      delivered = payload;
    }));

    expect(delivered).toMatchObject({
      authorityId: 'authority-resolve',
      directoryPath: '/文档/提示词',
      operation: 'resolve-library-directory',
    });
    const input = resolveCompletion('authority-resolve');
    expect(broker.complete(17, input)).toBe(true);
    await expect(pending).resolves.toEqual(input.result);
  });

  it('rejects malformed directory results without consuming the request', async () => {
    const controller = new AbortController();
    const broker = createAgentFileAuthorityBroker({ createId: () => 'authority-resolve-invalid' });
    const pending = resolveRequest(broker, sender(), controller.signal);

    expect(() => broker.complete(17, {
      ...resolveCompletion('authority-resolve-invalid'),
      result: {
        operation: 'resolve-library-directory',
        parent: node({ type: 'dir' }),
        providerId: 'local',
        version: 1,
      },
    } as AgentFileAuthorityCompletionV1)).toThrow('未知字段');
    expect(() => broker.complete(17, resolveCompletion('authority-resolve-invalid', {
      result: {
        operation: 'resolve-library-directory',
        parent: node({ type: 'file' }),
        version: 1,
      },
    }))).toThrow('不是目录');
    expect(() => broker.complete(17, resolveCompletion('authority-resolve-invalid', {
      result: {
        operation: 'resolve-library-directory',
        parent: node({ libraryId: 4, type: 'dir' }),
        version: 1,
      },
    }))).toThrow('不属于当前资料库');

    const valid = resolveCompletion('authority-resolve-invalid');
    expect(broker.complete(17, valid)).toBe(true);
    await expect(pending).resolves.toEqual(valid.result);
  });

  it.each([
    ['window', 18, {}],
    ['library', 17, { libraryId: 4 }],
    ['owner', 17, { ownerScope: { ...OWNER_SCOPE, accountScope: 'user:8' } }],
    ['run', 17, { runId: 'run-2' }],
    ['session', 17, { sessionId: 'session-2' }],
    ['tool run', 17, { toolRunId: 'tool-run-2' }],
  ])('rejects a completion with the wrong %s identity', async (_label, ownerId, overrides) => {
    const controller = new AbortController();
    const broker = createAgentFileAuthorityBroker({ createId: () => 'authority-bound' });
    const pending = request(broker, sender(), controller.signal);

    expect(() => broker.complete(ownerId as number, completion(
      'authority-bound',
      overrides as Partial<AgentFileAuthorityCompletionV1>,
    ))).toThrow('无权提交');
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('rejects malformed, mixed, and operation-mismatched results without consuming the request', async () => {
    const controller = new AbortController();
    const broker = createAgentFileAuthorityBroker({ createId: () => 'authority-malformed' });
    const pending = request(broker, sender(), controller.signal);

    expect(() => broker.complete(17, {
      ...completion('authority-malformed'),
      result: {
        node: node({ type: 'dir' }),
        operation: 'stage-library-node',
        version: 1,
      },
    })).toThrow('不是普通文件');
    expect(() => broker.complete(17, {
      ...completion('authority-malformed'),
      error: 'failed',
    })).toThrow('失败结果无效');
    expect(() => broker.complete(17, {
      ...completion('authority-malformed'),
      unexpected: true,
    } as AgentFileAuthorityCompletionV1)).toThrow('未知字段');
    expect(() => broker.complete(17, {
      ...completion('authority-malformed'),
      libraryId: '3',
    } as unknown as AgentFileAuthorityCompletionV1)).toThrow('资料库 ID 无效');
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('settles cancellation, timeout, owner release, and send failure without leaving replayable requests', async () => {
    vi.useFakeTimers();
    try {
      const canceledController = new AbortController();
      const canceledBroker = createAgentFileAuthorityBroker({ createId: () => 'authority-cancel' });
      const canceled = request(canceledBroker, sender(), canceledController.signal);
      canceledController.abort();
      await expect(canceled).rejects.toMatchObject({ name: 'AbortError' });

      const releasedBroker = createAgentFileAuthorityBroker({ createId: () => 'authority-release' });
      const released = request(releasedBroker, sender());
      releasedBroker.releaseOwner(17);
      await expect(released).rejects.toMatchObject({ name: 'AbortError' });

      const timedBroker = createAgentFileAuthorityBroker({
        createId: () => 'authority-timeout',
        timeoutMs: 1_000,
      });
      const timed = request(timedBroker, sender());
      const timedRejection = expect(timed).rejects.toThrow('请求超时');
      await vi.advanceTimersByTimeAsync(1_000);
      await timedRejection;

      const failedBroker = createAgentFileAuthorityBroker({ createId: () => 'authority-send-failed' });
      const failed = request(failedBroker, sender(() => {
        throw new Error('renderer gone');
      }));
      await expect(failed).rejects.toThrow('请求发送失败');
      expect(() => failedBroker.complete(17, completion('authority-send-failed')))
        .toThrow('不存在或已经失效');
    } finally {
      vi.useRealTimers();
    }
  });
});
