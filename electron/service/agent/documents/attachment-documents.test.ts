import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AgentAttachmentStore } from '../agent-attachment-store';
import { operateAgentAttachment } from './attachment-documents';
import { processAgentDocument } from './document-engine';
import { pdfFixture } from './document-fixtures';
import { xlsxFixture } from './office-fixtures';

const scope = { ownerScope: { accountScope: 'user:7', backendScope: 'https://test.invalid/api' }, libraryId: 3 };
const directories: string[] = [];
afterEach(async () => { for (const dir of directories.splice(0)) await rm(dir, { recursive: true, force: true }); });
describe('attachment document operations', () => {
  it('binds spreadsheet continuation revisions to ranges and filter selections', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'of-document-')); directories.push(dir);
    const store = new AgentAttachmentStore(dir, bytes => ({ bytes, width: 1, height: 1, thumbnail: '' }));
    const file = await store.import({ ...scope, name: 'sales.xlsx', base64: (await xlsxFixture()).toString('base64') });
    await store.bind(scope, [file.id], 's');
    const signal = new AbortController().signal;
    const query = { id: file.id, sheet: '销售', range: 'A2:C5', limit: 1 };
    const first = await operateAgentAttachment(store, scope, 's', 'query', query, signal, 1000, processAgentDocument) as { revision: string; nextOffset: number };
    const next = { ...query, revision: first.revision, offset: first.nextOffset };
    expect(await operateAgentAttachment(store, scope, 's', 'query', next, signal, 1000, processAgentDocument)).toMatchObject({ revision: first.revision });
    await expect(operateAgentAttachment(store, scope, 's', 'query', { ...next, range: 'A2:C3' }, signal, 1000, processAgentDocument)).rejects.toThrow('范围已变化');
    await expect(operateAgentAttachment(store, scope, 's', 'query', { ...next, aggregate: { column: 'C', operation: 'sum' } }, signal, 1000, processAgentDocument)).rejects.toThrow('范围已变化');
  });
  it('enforces session scope, returns page-aware cursors and creates a scoped image reference', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'of-document-')); directories.push(dir);
    const store = new AgentAttachmentStore(dir, bytes => ({ bytes, width: 400, height: 240, thumbnail: '' }));
    const file = await store.import({ ...scope, name: 'sample.pdf', base64: pdfFixture().toString('base64') });
    expect(file).toMatchObject({ kind: 'document', format: 'pdf' });
    const signal = new AbortController().signal;
    const operate = (session: string, action: 'inspect' | 'read' | 'view', page?: number) =>
      operateAgentAttachment(store, scope, session, action, { id: file.id, page }, signal, 1000, processAgentDocument);
    await expect(operate('unknown', 'inspect')).rejects.toThrow('不属于');
    await store.bind(scope, [file.id], 's');
    expect(await operate('s', 'inspect')).toMatchObject({ pageCount: 2, operations: ['read', 'view'] });
    expect(await operate('s', 'read', 1)).toMatchObject({ page: 1, nextPage: 2, hasMorePages: true });
    const viewed = await operate('s', 'view', 2) as { imageId: string };
    expect(await operate('s', 'view', 2)).toMatchObject({ imageId: viewed.imageId });
    expect(await store.image(scope, viewed.imageId, 's')).toMatch(/^data:image\/png;base64,/);
    await expect(store.image(scope, viewed.imageId, 'other')).rejects.toThrow('不属于');
    const opaque = await store.import({ ...scope, name: 'unsupported.bin', base64: Buffer.from([0, 1, 2]).toString('base64') });
    await store.bind(scope, [opaque.id], 's');
    expect(await operateAgentAttachment(store, scope, 's', 'inspect', { id: opaque.id }, signal, 1000, processAgentDocument)).toMatchObject({ operations: [], kind: 'file' });
  });
});
