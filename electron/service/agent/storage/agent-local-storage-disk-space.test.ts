import { describe, expect, it, vi } from 'vitest';

import {
  AGENT_LOCAL_STORAGE_DEFAULT_MIN_FREE_BYTES,
  createAgentLocalStorageAvailableDiskBytesReader,
} from './agent-local-storage-disk-space';

describe('Agent local storage disk space reader', () => {
  it('reads available bytes from the configured filesystem with bigint precision', async () => {
    const statfs = vi.fn(async () => ({
      bavail: 7n,
      bsize: 4_096n,
    }));
    const readAvailableBytes = createAgentLocalStorageAvailableDiskBytesReader(
      '/agent-user-data',
      statfs,
    );

    await expect(readAvailableBytes()).resolves.toBe(28_672);
    expect(statfs).toHaveBeenCalledWith('/agent-user-data', { bigint: true });
    expect(AGENT_LOCAL_STORAGE_DEFAULT_MIN_FREE_BYTES).toBe(1024 ** 3);
  });

  it('clamps filesystems larger than the JavaScript safe integer range', async () => {
    const readAvailableBytes = createAgentLocalStorageAvailableDiskBytesReader(
      '/agent-user-data',
      async () => ({
        bavail: BigInt(Number.MAX_SAFE_INTEGER),
        bsize: 4_096n,
      }),
    );

    await expect(readAvailableBytes()).resolves.toBe(Number.MAX_SAFE_INTEGER);
  });

  it('rejects invalid paths and invalid filesystem statistics', async () => {
    expect(() => createAgentLocalStorageAvailableDiskBytesReader('   '))
      .toThrow('路径无效');
    const readAvailableBytes = createAgentLocalStorageAvailableDiskBytesReader(
      '/agent-user-data',
      async () => ({ bavail: -1n, bsize: 4_096n }),
    );

    await expect(readAvailableBytes()).rejects.toThrow('磁盘信息无效');
  });
});
