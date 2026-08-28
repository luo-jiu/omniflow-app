import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createAgentMediaArtifactStore,
  type AgentMediaArtifactOwner,
  type AgentMediaOwnedFile,
} from './agent-media-artifact-store';
import {
  createAgentMediaArtifactPutTransport,
  createAgentMediaArtifactUploadManager,
  type AgentMediaArtifactPutTransport,
  type AgentMediaArtifactUploadInput,
} from './agent-media-artifact-upload';
import {
  AgentMediaUploadControlPlaneError,
  type AgentMediaUploadControlPlane,
} from './agent-media-upload-control-plane';

const OWNER = {
  executionId: 'execution-1',
  ownerScope: {
    accountScope: 'user:7',
    backendScope: 'https://api.example.test/v1',
  },
  ownerWebContentsId: 77,
  runId: 'run-1',
  sessionId: 'session-1',
};

const TARGET = {
  conflictPolicy: 'auto_rename' as const,
  contentType: 'audio/mp4',
  fileName: 'audio.m4a',
  libraryId: 3,
  parentId: 10,
  storageProvider: 'local-minio',
};

describe('Agent media artifact main-owned upload transaction', () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map(root => rm(root, { force: true, recursive: true })));
  });

  async function fixture(options: {
    content?: string;
    controlPlane?: Partial<AgentMediaUploadControlPlane>;
    defaultTransport?: boolean;
    transport?: AgentMediaArtifactPutTransport;
  } = {}) {
    const root = await mkdtemp(path.join(os.tmpdir(), 'omniflow-agent-upload-test-'));
    roots.push(root);
    const store = createAgentMediaArtifactStore({ rootPath: root });
    const artifact = await store.create(TARGET.fileName, OWNER);
    const content = options.content ?? 'abcdefgh';
    await writeFile(artifact.filePath, content);
    const finalized = await store.finalize(artifact.artifactId);
    const controlPlane: AgentMediaUploadControlPlane = {
      apiBaseUrl: 'https://api.example.test/v1',
      abort: vi.fn(async () => undefined),
      complete: vi.fn(async () => ({ id: 32, name: 'audio', ext: 'm4a' })),
      init: vi.fn(async () => ({
        mode: 'multipart' as const,
        partSize: 4,
        totalParts: Math.ceil(content.length / 4),
        uploadId: 'upload-secret',
      })),
      reconcile: vi.fn(async () => ({ state: 'unknown' as const })),
      sign: vi.fn(async (_credentials, _uploadId, partNumbers: number[]) => (
        partNumbers.map(partNumber => ({
          partNumber,
          url: `https://storage.example.test/signed-${partNumber}?secret=value`,
        }))
      )),
      verifyAccount: vi.fn(async () => undefined),
      ...options.controlPlane,
    };
    const received = new Map<number, string>();
    const transport = options.defaultTransport ? undefined : options.transport || {
      put: vi.fn(async (input) => {
        const buffer = Buffer.alloc(input.byteLength);
        const read = await input.fileHandle.read(buffer, 0, input.byteLength, input.byteOffset);
        received.set(input.byteOffset, buffer.subarray(0, read.bytesRead).toString());
        input.onProgress(read.bytesRead);
        return { etag: `etag-${input.byteOffset}`, sentBytes: read.bytesRead, status: 200 };
      }),
    } satisfies AgentMediaArtifactPutTransport;
    const manager = createAgentMediaArtifactUploadManager({
      artifactStore: store,
      controlPlane,
      reconcileTimeoutMs: 100,
      ...(transport ? { transport } : {}),
    });
    const input: AgentMediaArtifactUploadInput = {
      artifactId: finalized.artifactId,
      credentials: { token: 'token-secret', username: 'loyce' },
      expectedUserId: 7,
      owner: OWNER,
      signal: new AbortController().signal,
      target: TARGET,
    };
    return { controlPlane, input, manager, received, transport };
  }

  it('owns the transaction and passes only the frozen target to init', async () => {
    const { controlPlane, input, manager, received, transport } = await fixture();
    const progress = vi.fn();
    const onSettlementStarted = vi.fn();

    await expect(manager.upload({
      ...input,
      onProgress: progress,
      onSettlementStarted,
    })).resolves.toEqual({
      commitState: 'committed',
      node: { ext: 'm4a', id: 32, name: 'audio' },
    });
    expect(controlPlane.init).toHaveBeenCalledWith(input.credentials, {
      contentType: 'audio/mp4',
      fileName: 'audio.m4a',
      fileSize: 8,
      libraryId: 3,
      parentId: 10,
      storageProvider: 'local-minio',
    }, input.signal);
    expect(controlPlane.sign).toHaveBeenCalledWith(
      input.credentials,
      'upload-secret',
      [1, 2],
      input.signal,
    );
    expect(transport?.put).toHaveBeenCalledTimes(2);
    expect(received).toEqual(new Map([[0, 'abcd'], [4, 'efgh']]));
    expect(controlPlane.complete).toHaveBeenCalledWith(input.credentials, expect.objectContaining({
      conflictPolicy: 'auto_rename',
      parts: [
        { etag: 'etag-0', partNumber: 1 },
        { etag: 'etag-4', partNumber: 2 },
      ],
    }), input.signal);
    const completeCall = vi.mocked(controlPlane.complete).mock.calls[0];
    expect(completeCall).toBeDefined();
    const operationId = completeCall![1].clientOperationId;
    expect(operationId).toMatch(/^[a-f0-9]{64}$/u);
    expect(operationId.length).toBeLessThanOrEqual(128);
    expect(progress).toHaveBeenLastCalledWith(8, 8);
    expect(onSettlementStarted).toHaveBeenCalledOnce();
    expect(onSettlementStarted.mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(controlPlane.complete).mock.invocationCallOrder[0]);
    expect(controlPlane.abort).not.toHaveBeenCalled();
  });

  it('streams the sealed artifact through the default HTTP PUT transport', async () => {
    const received = new Map<number, string>();
    const server = createServer((request, response) => {
      const match = /^\/part\/(\d+)$/u.exec(request.url || '');
      const partNumber = Number(match?.[1]);
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        received.set(partNumber, Buffer.concat(chunks).toString());
        response.statusCode = 200;
        response.setHeader('etag', `"etag-${partNumber}"`);
        response.end();
      });
    });
    await new Promise<void>((resolve, reject) => {
      const handleError = (error: Error) => reject(error);
      server.once('error', handleError);
      server.listen(0, '127.0.0.1', () => {
        server.off('error', handleError);
        resolve();
      });
    });

    try {
      const address = server.address() as AddressInfo;
      const { input, manager } = await fixture({
        controlPlane: {
          sign: vi.fn(async (_credentials, _uploadId, partNumbers: number[]) => (
            partNumbers.map(partNumber => ({
              partNumber,
              url: `http://127.0.0.1:${address.port}/part/${partNumber}`,
            }))
          )),
        },
        defaultTransport: true,
      });

      await expect(manager.upload(input)).resolves.toMatchObject({ commitState: 'committed' });
      expect(received).toEqual(new Map([[1, 'abcd'], [2, 'efgh']]));
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close(error => (error ? reject(error) : resolve()));
      });
    }
  });

  it('observes cancellation that races with PUT listener registration', async () => {
    let abortedReads = 0;
    const signal = {
      get aborted() {
        abortedReads += 1;
        return abortedReads >= 2;
      },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as AbortSignal;
    const transport = createAgentMediaArtifactPutTransport();

    await expect(transport.put({
      byteLength: 4,
      byteOffset: 0,
      deadlineMs: 1_000,
      fileHandle: {
        createReadStream: () => Readable.from([Buffer.from('data')]),
      } as never,
      idleTimeoutMs: 1_000,
      onProgress: vi.fn(),
      signal,
      url: 'http://127.0.0.1:1/upload',
    })).rejects.toMatchObject({ name: 'AbortError' });
    expect(abortedReads).toBeGreaterThanOrEqual(2);
  });

  it('preserves an authoritative commit when owned-file cleanup fails afterward', async () => {
    const { controlPlane, input } = await fixture();
    const artifactStore = {
      async withOwnedFile<T>(
        _artifactId: string,
        _owner: AgentMediaArtifactOwner,
        consumer: (ownedFile: AgentMediaOwnedFile) => Promise<T>,
      ): Promise<T> {
        await consumer({
          artifact: {
            artifactId: input.artifactId,
            directoryPath: '/managed/opaque',
            fileName: TARGET.fileName,
            filePath: '/managed/opaque/audio.m4a',
            sizeBytes: 8,
          },
          fileHandle: {} as never,
          verifyUnchanged: vi.fn(async () => undefined),
        });
        throw new Error('local lease cleanup failed');
      },
    };
    const manager = createAgentMediaArtifactUploadManager({
      artifactStore,
      controlPlane,
      transport: {
        put: vi.fn(async ({ byteLength, onProgress }) => {
          onProgress(byteLength);
          return { etag: `etag-${byteLength}`, sentBytes: byteLength, status: 200 };
        }),
      },
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    try {
      await expect(manager.upload(input)).resolves.toEqual({
        commitState: 'committed',
        node: { ext: 'm4a', id: 32, name: 'audio' },
      });
      expect(warn).toHaveBeenCalledWith(
        'Agent media artifact cleanup failed after non-retryable settlement',
      );
    } finally {
      warn.mockRestore();
    }
  });

  it('preserves commit_unknown when owned-file cleanup fails afterward', async () => {
    const { controlPlane, input } = await fixture({
      controlPlane: {
        complete: vi.fn(async () => {
          throw new AgentMediaUploadControlPlaneError('network_error');
        }),
        reconcile: vi.fn(async () => ({ state: 'unknown' as const })),
      },
    });
    const artifactStore = {
      async withOwnedFile<T>(
        _artifactId: string,
        _owner: AgentMediaArtifactOwner,
        consumer: (ownedFile: AgentMediaOwnedFile) => Promise<T>,
      ): Promise<T> {
        await consumer({
          artifact: {
            artifactId: input.artifactId,
            directoryPath: '/managed/opaque',
            fileName: TARGET.fileName,
            filePath: '/managed/opaque/audio.m4a',
            sizeBytes: 8,
          },
          fileHandle: {} as never,
          verifyUnchanged: vi.fn(async () => undefined),
        });
        throw new Error('local lease cleanup failed');
      },
    };
    const manager = createAgentMediaArtifactUploadManager({
      artifactStore,
      controlPlane,
      transport: {
        put: vi.fn(async ({ byteLength, onProgress }) => {
          onProgress(byteLength);
          return { etag: `etag-${byteLength}`, sentBytes: byteLength, status: 200 };
        }),
      },
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    try {
      await expect(manager.upload(input)).resolves.toEqual({
        commitState: 'commit_unknown',
      });
      expect(warn).toHaveBeenCalledWith(
        'Agent media artifact cleanup failed after non-retryable settlement',
      );
      expect(controlPlane.abort).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('does not misreport account verification transport failures as an account mismatch', async () => {
    const { input, manager } = await fixture({
      controlPlane: {
        verifyAccount: vi.fn(async () => {
          throw new AgentMediaUploadControlPlaneError('network_error');
        }),
      },
    });

    await expect(manager.upload(input))
      .rejects.toThrow('Agent 上传账号验证失败，请稍后重试');
  });

  it('recovers a committed node after an uncertain complete result', async () => {
    const reconcile = vi.fn(async (
      credentials: unknown,
      operationId: string,
      signal: AbortSignal,
    ) => {
      void credentials;
      void operationId;
      void signal;
      return {
        node: { id: 33, name: 'reconciled' },
        state: 'committed' as const,
      };
    });
    const { controlPlane, input, manager } = await fixture({
      controlPlane: {
        complete: vi.fn(async () => {
          throw new AgentMediaUploadControlPlaneError('server_error', 504);
        }),
        reconcile,
      },
    });

    await expect(manager.upload(input)).resolves.toEqual({
      commitState: 'committed',
      node: { id: 33, name: 'reconciled' },
    });
    expect(reconcile).toHaveBeenCalledWith(
      input.credentials,
      expect.stringMatching(/^[a-f0-9]{64}$/u),
      expect.any(AbortSignal),
    );
    expect(vi.mocked(reconcile).mock.calls[0]?.[2]).not.toBe(input.signal);
    expect(controlPlane.abort).not.toHaveBeenCalled();
  });

  it('returns commit_unknown without aborting when reconciliation stays unknown', async () => {
    const { controlPlane, input, manager } = await fixture({
      controlPlane: {
        complete: vi.fn(async () => { throw new Error('socket reset secret'); }),
        reconcile: vi.fn(async () => ({ state: 'unknown' as const })),
      },
    });

    await expect(manager.upload(input)).resolves.toEqual({ commitState: 'commit_unknown' });
    expect(controlPlane.abort).not.toHaveBeenCalled();
  });

  it('uses an independent reconciliation signal when cancellation races with complete', async () => {
    const controller = new AbortController();
    const reconcile = vi.fn(async (
      _credentials: unknown,
      _operationId: string,
      signal: AbortSignal,
    ) => {
      expect(signal).not.toBe(controller.signal);
      return { node: { id: 34, name: 'cancel-race' }, state: 'committed' as const };
    });
    const { controlPlane, input, manager } = await fixture({
      controlPlane: {
        complete: vi.fn(async () => {
          controller.abort();
          throw Object.assign(new Error('cancelled'), { name: 'AbortError' });
        }),
        reconcile,
      },
    });

    await expect(manager.upload({ ...input, signal: controller.signal })).resolves.toEqual({
      commitState: 'committed',
      node: { id: 34, name: 'cancel-race' },
    });
    expect(controlPlane.abort).not.toHaveBeenCalled();
  });

  it('aborts a backend session after a pre-complete cancellation', async () => {
    const controller = new AbortController();
    const { controlPlane, input, manager } = await fixture({
      transport: {
        put: vi.fn(async () => {
          controller.abort();
          throw Object.assign(new Error('private detail'), { name: 'AbortError' });
        }),
      },
    });

    await expect(manager.upload({ ...input, signal: controller.signal }))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(controlPlane.abort).toHaveBeenCalledWith(
      input.credentials,
      'upload-secret',
      expect.any(AbortSignal),
    );
    expect(controlPlane.complete).not.toHaveBeenCalled();
  });

  it('reports a short read as definitively uncommitted and aborts before complete', async () => {
    const { controlPlane, input, manager } = await fixture({
      transport: {
        put: vi.fn(async ({ byteLength }) => ({
          etag: 'etag-short',
          sentBytes: byteLength - 1,
          status: 200,
        })),
      },
    });

    await expect(manager.upload(input)).resolves.toEqual({ commitState: 'uncommitted' });
    expect(controlPlane.abort).toHaveBeenCalledOnce();
    expect(controlPlane.complete).not.toHaveBeenCalled();
  });

  it('keeps response failures stable and aborts before complete', async () => {
    const { controlPlane, input, manager } = await fixture({
      transport: {
        put: vi.fn(async () => { throw new Error('Agent 媒体分片上传响应提前关闭'); }),
      },
    });

    await expect(manager.upload(input)).resolves.toEqual({ commitState: 'uncommitted' });
    expect(controlPlane.abort).toHaveBeenCalledOnce();
    expect(controlPlane.complete).not.toHaveBeenCalled();
  });

  it('cancels and settles sibling PUT requests before aborting the backend session', async () => {
    const siblingAborted = vi.fn();
    const progress = vi.fn();
    const { controlPlane, input, manager } = await fixture({
      transport: {
        put: vi.fn(async ({ byteOffset, onProgress, signal }) => {
          if (byteOffset === 0) throw new Error('first part failed');
          return new Promise<never>((_resolve, reject) => {
            const handleAbort = () => {
              siblingAborted();
              onProgress(3);
              reject(Object.assign(new Error('sibling cancelled'), { name: 'AbortError' }));
            };
            if (signal.aborted) handleAbort();
            else signal.addEventListener('abort', handleAbort, { once: true });
          });
        }),
      },
    });

    await expect(manager.upload({ ...input, onProgress: progress }))
      .resolves.toEqual({ commitState: 'uncommitted' });
    expect(siblingAborted).toHaveBeenCalledOnce();
    expect(progress).not.toHaveBeenCalled();
    expect(controlPlane.abort).toHaveBeenCalledOnce();
    expect(siblingAborted.mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(controlPlane.abort).mock.invocationCallOrder[0]);
  });

  it('aborts a definitive complete failure without reconciliation', async () => {
    const { controlPlane, input, manager } = await fixture({
      controlPlane: {
        complete: vi.fn(async () => {
          throw new AgentMediaUploadControlPlaneError('invalid_request', 409);
        }),
      },
    });

    await expect(manager.upload(input)).resolves.toEqual({ commitState: 'uncommitted' });
    expect(controlPlane.reconcile).not.toHaveBeenCalled();
    expect(controlPlane.abort).toHaveBeenCalledOnce();
  });

  it('aborts when reconciliation authoritatively reports uncommitted', async () => {
    const { controlPlane, input, manager } = await fixture({
      controlPlane: {
        complete: vi.fn(async () => { throw new Error('connection lost'); }),
        reconcile: vi.fn(async () => ({ state: 'uncommitted' as const })),
      },
    });

    await expect(manager.upload(input)).resolves.toEqual({ commitState: 'uncommitted' });
    expect(controlPlane.abort).toHaveBeenCalledOnce();
  });
});
