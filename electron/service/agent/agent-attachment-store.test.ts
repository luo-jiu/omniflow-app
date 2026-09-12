import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentAttachmentStore } from './agent-attachment-store';
const scope = { ownerScope: { accountScope: 'user:7', backendScope: 'https://test.invalid/api' }, libraryId: 3 };
const directories: string[] = [];
const imageBytes = Buffer.from([137,80,78,71,13,10,26,10]);
const prepare = () => ({ bytes: imageBytes, width: 20, height: 10, thumbnail: 'data:image/png;base64,test' });
async function setup() {
  const dir = await mkdtemp(path.join(tmpdir(), 'of-attachments-test-')); directories.push(dir);
  return { dir, store: new AgentAttachmentStore(dir, prepare) };
}
afterEach(async () => { for (const dir of directories.splice(0)) await rm(dir, { recursive: true, force: true }); });
describe('managed attachments', () => {
  it('previews drafts and session-bound images without allowing foreign scopes or non-images', async () => {
    const { store } = await setup();
    const image = await store.import({ ...scope, name: 'preview.png', base64: imageBytes.toString('base64') });
    expect(await store.previewImage(scope, image.id)).toBe('data:image/png;base64,' + imageBytes.toString('base64'));
    await expect(store.previewImage({ ...scope, libraryId: 4 }, image.id)).rejects.toThrow('不属于');
    await expect(store.previewImage({ ...scope, ownerScope: { ...scope.ownerScope, accountScope: 'user:8' } }, image.id)).rejects.toThrow('不属于');
    await store.bind(scope, [image.id], 'session-preview');
    await expect(store.previewImage(scope, image.id)).rejects.toThrow('所属会话');
    await expect(store.previewImage(scope, image.id, 'other')).rejects.toThrow('不属于');
    await expect(store.previewImage(scope, image.id, '')).rejects.toThrow('无效');
    expect(await store.previewImage(scope, image.id, 'session-preview')).toContain('data:image/png;base64,');
    const text = await store.import({ ...scope, name: 'note.txt', base64: '' });
    await expect(store.previewImage(scope, text.id)).rejects.toThrow('不是图片');
  });
  it('rolls back only newly added bindings, preserving retry bytes and prior session references', async () => {
    const { store } = await setup();
    const existing = await store.import({ ...scope, name: 'existing.txt', base64: '' });
    const added = await store.import({ ...scope, name: 'new.txt', base64: '' });
    await store.bind(scope, [existing.id], 's');
    const receipt = await store.bind(scope, [existing.id, added.id], 's');
    expect(receipt).toEqual([added.id]);
    await store.rollbackBinding(scope, receipt, 's');
    expect(await store.resolve(scope, [existing.id], 's')).toHaveLength(1);
    await expect(store.resolve(scope, [added.id], 's')).rejects.toThrow('不属于');
    expect(await store.resolve(scope, [added.id])).toHaveLength(1);
    await store.discard(scope, added.id);
    await expect(store.resolve(scope, [added.id])).rejects.toThrow();
  });
  it('undoes a partial batch when a later metadata write fails', async () => {
    const { store } = await setup();
    const first = await store.import({ ...scope, name: 'first.txt', base64: '' });
    const second = await store.import({ ...scope, name: 'second.txt', base64: '' });
    const writer = store as unknown as { save: (record: { attachment: { id: string }; sessions: string[] }) => Promise<void> };
    const save = writer.save.bind(store);
    const spy = vi.spyOn(writer, 'save').mockImplementation(record => {
      if (record.attachment.id === second.id && record.sessions.includes('s')) return Promise.reject(new Error('disk failure'));
      return save(record);
    });
    await expect(store.bind(scope, [first.id, second.id], 's')).rejects.toThrow('disk failure');
    spy.mockRestore();
    await expect(store.resolve(scope, [first.id], 's')).rejects.toThrow('不属于');
    await store.discardDrafts();
    await expect(store.resolve(scope, [first.id])).rejects.toThrow();
    await expect(store.resolve(scope, [second.id])).rejects.toThrow();
  });
  it('preserves UTF-8 contents and ordering across restart, and enforces owner/library/session boundaries', async () => {
    const { store, dir } = await setup();
    const first = await store.import({ ...scope, name: '说明.txt', base64: Buffer.from('第一行\nsecond\n').toString('base64') });
    const second = await store.import({ ...scope, name: 'picture.png', base64: imageBytes.toString('base64') });
    await expect(store.read(scope, 's', { id: first.id }, 1000)).rejects.toThrow('不属于');
    await store.bind(scope, [first.id, second.id], 's');
    const reopened = new AgentAttachmentStore(dir, prepare);
    expect((await reopened.resolve(scope, [second.id, first.id], 's')).map(item => item.name)).toEqual(['picture.png', '说明.txt']);
    const read = await reopened.read(scope, 's', { id: first.id, limit: 1 }, 1000);
    expect(read).toMatchObject({ content: 'L1: 第一行', hasMore: true, nextOffset: 2 });
    expect((await reopened.read(scope, 's', { id: first.id, offset: read.nextOffset, revision: read.revision }, 1000)).content).toContain('second');
    await expect(reopened.resolve({ ...scope, libraryId: 4 }, [first.id])).rejects.toThrow('不属于');
    await expect(reopened.resolve({ ...scope, ownerScope: { ...scope.ownerScope, accountScope: 'user:8' } }, [first.id])).rejects.toThrow('不属于');
    expect(await reopened.image(scope, second.id, 's')).toBe('data:image/png;base64,' + imageBytes.toString('base64'));
    await reopened.discard(scope, first.id);
    expect((await reopened.resolve(scope, [first.id])).length).toBe(1);
    await reopened.releaseSession(scope, 's');
    expect(await readdir(dir)).toHaveLength(0);
  });
  it('cleans expired drafts but retains committed attachments', async () => {
    const { store, dir } = await setup();
    const draft = await store.import({ ...scope, name: 'draft.txt', base64: '' });
    const file = path.join(dir, draft.id + '.json');
    const record = JSON.parse(await readFile(file, 'utf8')); record.createdAt = 0;
    await writeFile(file, JSON.stringify(record));
    await store.import({ ...scope, name: 'new.txt', base64: '' });
    await expect(store.resolve(scope, [draft.id])).rejects.toThrow();
  });
  it('stores opaque documents without pretending they are text, and rejects oversized inputs and traversal', async () => {
    const { store } = await setup();
    expect(await store.import({ ...scope, name: 'report.pdf', base64: Buffer.from('%PDF-1.7').toString('base64') })).toMatchObject({ kind: 'document', format: 'pdf' });
    await expect(store.import({ ...scope, name: 'big.txt', base64: 'a'.repeat(12 * 1024 * 1024) })).rejects.toThrow('8 MiB');
    await expect(store.resolve(scope, ['../outside'])).rejects.toThrow('ID');
    const text = await store.import({ ...scope, name: '../../note.txt', base64: '' });
    expect(text.name).toBe('note.txt');
    await expect(store.resolve(scope, [text.id, text.id])).rejects.toThrow();
  });
  it('removes only unsubmitted drafts on normal shutdown', async () => {
    const { store } = await setup();
    const draft = await store.import({ ...scope, name: 'draft.txt', base64: '' });
    const sent = await store.import({ ...scope, name: 'sent.txt', base64: '' });
    await store.bind(scope, [sent.id], 's');
    await store.discardDrafts();
    await expect(store.resolve(scope, [draft.id])).rejects.toThrow();
    expect(await store.resolve(scope, [sent.id], 's')).toHaveLength(1);
  });
});
