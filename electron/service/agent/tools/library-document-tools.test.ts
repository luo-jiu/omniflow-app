import { describe, expect, it, vi } from 'vitest';
import { libraryDocumentTools } from './library-document-tools';
import { processAgentDocument } from '../documents/document-engine';
vi.mock('../documents/document-engine', () => ({ processAgentDocument: vi.fn() }));
const tool = (name: string) => libraryDocumentTools.find(item => item.name === name)!;
const ctx = (extra: Record<string, unknown> = {}) => ({ signal: new AbortController().signal, readLibraryMetadata: vi.fn(async (q: any) => q.kind === 'resolve' ? { node: { id: 7 } } : { node: { id: 7, ext: 'pdf' } }), readLibraryDocument: vi.fn(async () => Buffer.from('abc')), readLibraryDocumentImage: vi.fn(async () => ({ imageId: 'img-1' })), readOutputTokenBudget: 1000, ...extra } as any);
describe('library document tools', () => {
  it('derives node and format from an authorized library path', async () => { vi.mocked(processAgentDocument).mockResolvedValue({ pageCount: 2 } as any); await expect(tool('library.document.inspect').execute!({ path: '/a.pdf' }, ctx())).resolves.toMatchObject({ nodeId: 7, format: 'pdf' }); });
  it('rejects revision changes before returning content', async () => { vi.mocked(processAgentDocument).mockResolvedValue({ text: 'hello' } as any); await expect(tool('library.document.read').execute!({ nodeId: 7, format: 'pdf', revision: 'old' }, ctx())).rejects.toThrow('版本已变化'); });
  it('returns the controlled image reference for view', async () => { vi.mocked(processAgentDocument).mockResolvedValue({ pageCount: 1 } as any); await expect(tool('library.document.view').execute!({ nodeId: 7, format: 'pdf', page: 1 }, ctx())).resolves.toEqual({ ok: true, data: { imageId: 'img-1' } }); });
});
