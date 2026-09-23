import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { PluginCommandExecution } from '../../../src/shared/plugins/manual-command.types';

const ACTIVE = new Set(['preparing', 'awaiting-approval', 'executing']);
const MAX_RECORDS = 500;
const MAX_BYTES = 12 * 1024 * 1024;

/** This store owns manual executions only; it never creates an Agent session or model run. */
export class PluginCommandStore {
  private records = new Map<string, PluginCommandExecution>();
  constructor(private filePath: string) {
    mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
    if (!existsSync(filePath)) return;
    if (statSync(filePath).size > MAX_BYTES) throw new Error('手动插件历史存储超过上限');
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as { version?: number; records?: PluginCommandExecution[] };
    if (parsed.version !== 1 || !Array.isArray(parsed.records) || parsed.records.length > MAX_RECORDS) throw new Error('手动插件历史存储无效');
    for (const record of parsed.records) {
      if (!record || typeof record.id !== 'string' || !Number.isSafeInteger(record.revision) || record.revision < 1
        || !record.ownerScope || !Number.isSafeInteger(record.libraryId) || record.libraryId < 1) throw new Error('手动插件历史记录无效');
      if (ACTIVE.has(record.status)) {
        record.status = 'interrupted'; record.revision++; record.updatedAt = new Date().toISOString();
        record.message = '应用已重启，执行已中断；如需运行，请重新准备。';
      }
      // commit-unknown is deliberately preserved. No automatic resend after restart.
      this.records.set(record.id, record);
    }
    this.flush(this.records);
  }
  all(): PluginCommandExecution[] { return structuredClone([...this.records.values()]); }
  get(id: string): PluginCommandExecution | undefined { const record = this.records.get(id); return record ? structuredClone(record) : undefined; }
  save(record: PluginCommandExecution): void {
    const next = new Map(this.records);
    next.set(record.id, structuredClone(record));
    while (next.size > MAX_RECORDS || Buffer.byteLength(JSON.stringify({ version: 1, records: [...next.values()] })) > MAX_BYTES) {
      const removable = [...next.values()].find(item => item.id !== record.id && !ACTIVE.has(item.status) && item.status !== 'commit-unknown');
      if (!removable) throw new Error('待核对的插件历史已满，请先核对操作回执');
      next.delete(removable.id);
    }
    this.flush(next); this.records = next;
  }
  private flush(records: Map<string, PluginCommandExecution>) {
    const body = JSON.stringify({ version: 1, records: [...records.values()] });
    if (Buffer.byteLength(body) > MAX_BYTES) throw new Error('手动插件历史存储超过上限');
    const temporary = this.filePath + '.tmp';
    let fd: number | undefined;
    try {
      fd = openSync(temporary, 'w', 0o600); writeFileSync(fd, body); fsyncSync(fd); closeSync(fd); fd = undefined;
      renameSync(temporary, this.filePath);
      const directory = openSync(path.dirname(this.filePath), 'r');
      try { fsyncSync(directory); } finally { closeSync(directory); }
    } catch (error) {
      if (fd !== undefined) closeSync(fd);
      try { unlinkSync(temporary); } catch { /* no temporary file */ }
      throw error;
    }
  }
}
