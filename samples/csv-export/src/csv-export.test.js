import { describe, expect, it, vi } from 'vitest';
import { createCsvExport, EXPORT_MAX_BYTES } from './csv-export.js';
import { createCsvParser } from './csv-parser.js';
import { runCsvExport } from './tool-runner.js';

describe('independent complete CSV export', () => {
  it('exports every matching row beyond the read Tool 100-row preview limit', () => {
    const rows = [['name', 'group'], ...Array.from({ length: 205 }, (_, i) => [`row-${i}`, 'yes'])];
    const json = createCsvExport(rows, { format: 'json', column: 1, equals: 'yes' });
    expect(JSON.parse(json.text)).toEqual({ headers: rows[0], rows: rows.slice(1) });
    expect(JSON.parse(json.text).rows).toHaveLength(205);
  });
  it('round-trips quoted commas, quotes, CRLF, empty cells and Unicode without loss', () => {
    const rows = [['name', 'value'], ['茶,牛奶', 'first\r\nsecond'], ['"quoted"', ''], ['😀', '  spaces  ']];
    const output = createCsvExport(rows, { format: 'csv' }); const parser = createCsvParser(); parser.write(output.text);
    expect(parser.finish()).toEqual(rows); expect(output.mediaType).toBe('text/csv');
    expect(createCsvExport(rows, { format: 'json', column: 0, equals: 'missing' })).toEqual({ mediaType: 'application/json', text: JSON.stringify({ headers: rows[0], rows: [] }) });
  });
  it('rejects result byte overflow, invalid source shape and preview-style limits instead of truncating', () => {
    expect(() => createCsvExport([['x'], ...Array.from({ length: 90 }, () => ['x'.repeat(12000)])], { format: 'csv' })).toThrow('未生成截断文件');
    expect(() => createCsvExport([['x'], ['中'.repeat(400000)]], { format: 'json' })).toThrow();
    expect(() => createCsvExport([['x'], ['a']], { format: 'csv' }, 3)).toThrow();
    for (const input of [{ format: 'csv', limit: 1 }, { format: 'csv', column: 0 }, { format: 'csv', column: 2, equals: '' }, { format: 'html' }]) expect(() => createCsvExport([['x'], ['a']], input)).toThrow();
    expect(() => createCsvExport([['x'], ['a', 'b']], { format: 'csv' })).toThrow();
    expect(() => createCsvExport([], { format: 'csv' })).toThrow();
  });
  it('uses only the public single-resource read and dedicated file completion APIs', async () => {
    const bytes = new TextEncoder().encode('name,group\r\n茶,yes\r\n咖啡,no\r\n');
    const client = { toolInvocation: async () => ({ invocationId: 'call', toolId: 'export', input: { format: 'json', column: 1, equals: 'yes' } }),
      context: async () => ({ kind: 'tool', toolId: 'export', resource: { handle: 'opaque', size: bytes.length, revision: 'v1' }, capabilities: ['resource.read', 'resource.output.propose'], output: { maxBytes: EXPORT_MAX_BYTES } }),
      read: vi.fn(async () => ({ bytes, nextOffset: bytes.length, eof: true, revision: 'v1' })), completeFileOutput: vi.fn(async () => null), failTool: vi.fn(async () => null) };
    await runCsvExport(client, 65536);
    expect(client.completeFileOutput).toHaveBeenCalledWith('call', { mediaType: 'application/json', text: JSON.stringify({ headers: ['name', 'group'], rows: [['茶', 'yes']] }) });
    client.completeFileOutput.mockRejectedValueOnce(new Error('host rejected'));
    await expect(runCsvExport(client, 65536)).rejects.toThrow('host rejected'); expect(client.failTool).not.toHaveBeenCalled();
  });
});
