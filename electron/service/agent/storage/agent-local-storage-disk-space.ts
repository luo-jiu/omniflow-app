import type { BigIntStatsFs } from 'node:fs';
import { statfs } from 'node:fs/promises';

export const AGENT_LOCAL_STORAGE_DEFAULT_MIN_FREE_BYTES = 1024 * 1024 * 1024;

type AgentLocalStorageStatfs = (
  targetPath: string,
  options: { bigint: true },
) => Promise<Pick<BigIntStatsFs, 'bavail' | 'bsize'>>;

const readStatfs: AgentLocalStorageStatfs = (targetPath, options) => (
  statfs(targetPath, options)
);

export function createAgentLocalStorageAvailableDiskBytesReader(
  targetPathInput: string,
  statfsReader: AgentLocalStorageStatfs = readStatfs,
): () => Promise<number> {
  const targetPath = String(targetPathInput || '').trim();
  if (!targetPath) throw new Error('Agent 本机存储磁盘探针路径无效');

  return async () => {
    const stats = await statfsReader(targetPath, { bigint: true });
    if (stats.bavail < 0n || stats.bsize <= 0n) {
      throw new Error('Agent 本机存储磁盘信息无效');
    }
    const availableBytes = stats.bavail * stats.bsize;
    const maximumSafeBytes = BigInt(Number.MAX_SAFE_INTEGER);
    return availableBytes > maximumSafeBytes
      ? Number.MAX_SAFE_INTEGER
      : Number(availableBytes);
  };
}
