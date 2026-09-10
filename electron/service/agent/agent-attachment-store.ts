import crypto from 'node:crypto';
import path from 'node:path';
import { mkdir, readFile, writeFile, readdir, rm, rename, stat } from 'node:fs/promises';
import { AGENT_ATTACHMENT_MAX_BYTES, AGENT_ATTACHMENT_MAX_FILES, AGENT_ATTACHMENT_TOTAL_BYTES,
  type AgentAttachment, type AgentAttachmentImport, type AgentAttachmentScope } from '../../../src/shared/agent/agent-attachments';
import { serializeAgentOwnerScope, normalizeAgentOwnerScope } from '../../../src/shared/agent/agent-owner-scope';
import { decodeAgentText, type AgentTextReadQuery } from './agent-text-reader';
import { packAgentTextResult } from './agent-text-result';

interface StoredAttachment { attachment: AgentAttachment; scope: string; sessions: string[]; createdAt: number }
export interface PreparedAttachmentImage { bytes: Buffer; width: number; height: number; thumbnail: string }
const ID = /^[a-f0-9-]{36}$/u;
const MAX_STORAGE_BYTES = 512 * 1024 * 1024;
const MAX_STORED_ATTACHMENTS = 4096;
const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;

function scopeKey(scope: AgentAttachmentScope): string {
  if (!Number.isSafeInteger(scope.libraryId) || scope.libraryId <= 0) throw new Error('附件资料库无效');
  return `${serializeAgentOwnerScope(normalizeAgentOwnerScope(scope.ownerScope))}:${scope.libraryId}`;
}

export class AgentAttachmentStore {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly directory: string, private readonly prepareImage: (bytes: Buffer) => PreparedAttachmentImage) {}
  private serial<T>(action: () => Promise<T>): Promise<T> {
    const result = this.queue.then(action); this.queue = result.catch(() => undefined); return result;
  }
  private file(id: string, suffix: string) {
    if (!ID.test(id)) throw new Error('附件 ID 无效');
    return path.join(this.directory, `${id}.${suffix}`);
  }
  private async save(record: StoredAttachment) {
    const temporary = this.file(record.attachment.id, 'tmp');
    await writeFile(temporary, JSON.stringify(record), { mode: 0o600 });
    await rename(temporary, this.file(record.attachment.id, 'json'));
  }
  private async load(scope: AgentAttachmentScope, id: string, sessionId?: string): Promise<StoredAttachment> {
    const record = JSON.parse(await readFile(this.file(id, 'json'), 'utf8')) as StoredAttachment;
    if (record.scope !== scopeKey(scope) || record.attachment.id !== id
      || (sessionId && !record.sessions.includes(sessionId))) throw new Error('附件不存在或不属于当前会话');
    return record;
  }
  private async usage(discardDrafts = false): Promise<number> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    let bytes = 0;
    let count = 0;
    for (const name of await readdir(this.directory)) {
      if (!name.endsWith('.bin')) continue;
      const id = name.slice(0, -4);
      if (!ID.test(id)) continue;
      const file = await stat(this.file(id, 'bin'));
      const record = await readFile(this.file(id, 'json'), 'utf8').then(value => JSON.parse(value) as StoredAttachment).catch(() => null);
      if (!record?.sessions.length && (discardDrafts || Date.now() - (record?.createdAt ?? file.mtimeMs) > DRAFT_TTL_MS)) {
        for (const suffix of ['bin', 'json', 'tmp']) await rm(this.file(id, suffix), { force: true });
      } else {
        bytes += file.size + (await stat(this.file(id, 'json')).catch(() => ({ size: 0 }))).size;
        count += 1;
      }
    }
    if (!discardDrafts && count >= MAX_STORED_ATTACHMENTS) throw new Error('附件数量已达上限，请清理不需要的会话');
    return bytes;
  }
  discardDrafts(): Promise<void> { return this.serial(async () => { await this.usage(true); }); }
  import(input: AgentAttachmentImport): Promise<AgentAttachment> {
    return this.serial(async () => {
      const scope = scopeKey(input);
      if (typeof input.base64 !== 'string' || input.base64.length > Math.ceil(AGENT_ATTACHMENT_MAX_BYTES / 3) * 4
        || !/^[A-Za-z0-9+/]*={0,2}$/u.test(input.base64)) throw new Error('附件超过 8 MiB 或数据无效');
      let bytes = Buffer.from(input.base64, 'base64');
      if (bytes.length > AGENT_ATTACHMENT_MAX_BYTES) throw new Error('附件超过 8 MiB');
      const name = String(input.name || 'attachment').split(/[/\\]/u).pop()!.replace(/[\r\n\t]/gu, ' ').trim().slice(0, 160) || 'attachment';
      const isImage = bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
        || (bytes[0] === 255 && bytes[1] === 216)
        || (bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP');
      const image = isImage ? this.prepareImage(bytes) : undefined;
      const isPdf = bytes.subarray(0, 5).equals(Buffer.from('%PDF-'));
      const officeExtension = /\.(docx|xlsx|pptx)$/iu.exec(name)?.[1]?.toLowerCase() as 'docx' | 'xlsx' | 'pptx' | undefined;
      const officeFormat = bytes.subarray(0, 4).equals(Buffer.from([80, 75, 3, 4])) ? officeExtension : undefined;
      let text = false;
      if (image) bytes = image.bytes;
      else if (!isPdf && !officeFormat) {
        try { decodeAgentText(bytes); text = true; } catch { /* Opaque files can be inspected but never executed. */ }
      }
      if (bytes.length > AGENT_ATTACHMENT_MAX_BYTES) throw new Error('处理后的附件超过 8 MiB');
      if (await this.usage() + bytes.length + Buffer.byteLength(image?.thumbnail || '') + 2048 > MAX_STORAGE_BYTES) throw new Error('附件存储空间已满');
      const officeMime = officeFormat === 'docx' ? 'wordprocessingml.document' : officeFormat === 'xlsx' ? 'spreadsheetml.sheet' : 'presentationml.presentation';
      const attachment: AgentAttachment = { id: crypto.randomUUID(), name, kind: isImage ? 'image' : isPdf || officeFormat ? 'document' : text ? 'text' : 'file',
        ...(isPdf || officeFormat ? { format: isPdf ? 'pdf' as const : officeFormat } : {}),
        mimeType: isImage ? 'image/png' : isPdf ? 'application/pdf' : officeFormat ? `application/vnd.openxmlformats-officedocument.${officeMime}` : text ? 'text/plain' : 'application/octet-stream', sizeBytes: bytes.length,
        ...(image ? { width: image.width, height: image.height, thumbnail: image.thumbnail } : {}),
      };
      await writeFile(this.file(attachment.id, 'bin'), bytes, { flag: 'wx', mode: 0o600 });
      try {
        await this.save({ attachment, scope, sessions: [], createdAt: Date.now() });
      } catch (error) { await rm(this.file(attachment.id, 'bin'), { force: true }); throw error; }
      return attachment;
    });
  }
  async resolve(scope: AgentAttachmentScope, ids: readonly string[], sessionId?: string): Promise<AgentAttachment[]> {
    if (!Array.isArray(ids) || ids.length > AGENT_ATTACHMENT_MAX_FILES || new Set(ids).size !== ids.length) throw new Error('每条消息最多 12 个不同附件');
    const records = await Promise.all(ids.map(id => this.load(scope, id, sessionId)));
    if (records.reduce((sum, item) => sum + item.attachment.sizeBytes, 0) > AGENT_ATTACHMENT_TOTAL_BYTES) throw new Error('附件总大小超过 32 MiB');
    return records.map(item => item.attachment);
  }
  private async removeBindings(scope: AgentAttachmentScope, ids: readonly string[], sessionId: string): Promise<void> {
    for (const id of ids) {
      const record = await this.load(scope, id);
      record.sessions = record.sessions.filter(value => value !== sessionId);
      await this.save(record);
    }
  }
  rollbackBinding(scope: AgentAttachmentScope, addedIds: readonly string[], sessionId: string): Promise<void> {
    return this.serial(() => this.removeBindings(scope, addedIds, sessionId));
  }
  bind(scope: AgentAttachmentScope, ids: readonly string[], sessionId: string): Promise<string[]> {
    return this.serial(async () => {
      await this.resolve(scope, ids);
      const added: string[] = [];
      try {
        for (const id of ids) {
          const record = await this.load(scope, id);
          if (!record.sessions.includes(sessionId)) {
            record.sessions.push(sessionId);
            await this.save(record);
            added.push(id);
          }
        }
        return added;
      } catch (error) {
        await this.removeBindings(scope, added, sessionId);
        throw error;
      }
    });
  }
  discard(scope: AgentAttachmentScope, id: string): Promise<void> {
    return this.serial(async () => {
      const record = await this.load(scope, id);
      if (record.sessions.length) return;
      await rm(this.file(id, 'bin'), { force: true }); await rm(this.file(id, 'json'), { force: true });
    });
  }
  async image(scope: AgentAttachmentScope, id: string, sessionId: string): Promise<string> {
    const record = await this.load(scope, id, sessionId);
    if (record.attachment.kind !== 'image') throw new Error('附件不是图片');
    return `data:image/png;base64,${(await readFile(this.file(id, 'bin'))).toString('base64')}`;
  }
  releaseSession(scope: AgentAttachmentScope, sessionId: string): Promise<void> {
    return this.serial(async () => {
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      for (const name of await readdir(this.directory)) {
        if (!name.endsWith('.json') || !ID.test(name.slice(0, -5))) continue;
        const record = JSON.parse(await readFile(path.join(this.directory, name), 'utf8')) as StoredAttachment;
        if (record.scope !== scopeKey(scope) || !record.sessions.includes(sessionId)) continue;
        record.sessions = record.sessions.filter(id => id !== sessionId);
        if (record.sessions.length) await this.save(record);
        else {
          await rm(this.file(record.attachment.id, 'bin'), { force: true });
          await rm(this.file(record.attachment.id, 'json'), { force: true });
        }
      }
    });
  }
  async read(scope: AgentAttachmentScope, sessionId: string, query: { id: string } & Omit<AgentTextReadQuery, 'path'>, outputTokens: number) {
    const record = await this.load(scope, query.id, sessionId);
    if (record.attachment.kind !== 'text') throw new Error('图片作为视觉输入提供，不能当作文本读取');
    return packAgentTextResult(decodeAgentText(await readFile(this.file(query.id, 'bin'))),
      { ...query, path: record.attachment.name }, Math.min(10000, outputTokens),
      { scope: 'attachment', attachmentId: query.id }).data;
  }
  async source(scope: AgentAttachmentScope, id: string, sessionId: string) {
    const record = await this.load(scope, id, sessionId);
    return { attachment: record.attachment, bytes: await readFile(this.file(id, 'bin')) };
  }
}
