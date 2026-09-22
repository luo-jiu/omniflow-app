import { describe, expect, it, vi } from 'vitest';
import { createCsvParser, CSV_LIMITS } from './csv-parser.js';
import { queryCsvRows, validateQueryInput } from './csv-query.js';
import { readCsvResource } from './csv-resource.js';
import { runCsvTool } from './tool-runner.js';

function parse(text) { const parser = createCsvParser(); parser.write(text); return parser.finish(); }
function fixture(text, input = {}) {
  const bytes = typeof text === 'string' ? new TextEncoder().encode(text) : text;
  const resource = { handle: 'call-handle', name: 'sample.csv', size: bytes.length, revision: 'version-1' };
  const client = {
    context: vi.fn(async () => ({ kind: 'tool', toolId: 'example.csv-tools.query', resource })),
    toolInvocation: vi.fn(async () => ({ invocationId: 'call-1', toolId: 'example.csv-tools.query', input })),
    read: vi.fn(async (handle, offset, length) => {
      expect(handle).toBe(resource.handle);
      const end = Math.min(bytes.length, offset + length);
      return { bytes: bytes.slice(offset, end), nextOffset: end, eof: end === bytes.length, revision: resource.revision };
    }),
    completeTool: vi.fn(async () => null),
    failTool: vi.fn(async () => null),
  };
  return { client, resource };
}

describe('CSV Tool query semantics', () => {
  it('preserves Chinese, escaped quotes, empty cells and literal formulas, with exact index filtering', () => {
    const rows = parse('姓名,城市,备注\r\n小明,杭州,"引号""和,逗号"\r\n小红,苏州,\r\n小王,杭州,=1+1\r\n');
    expect(queryCsvRows(rows, { column: 1, equals: '杭州', limit: 1 })).toEqual({
      headers: ['姓名', '城市', '备注'], totalRows: 3, matchedRows: 2,
      rows: [['小明', '杭州', '引号"和,逗号']], truncated: true,
    });
    expect(queryCsvRows(rows, { column: 2, equals: '=1+1' }).rows).toEqual([['小王', '杭州', '=1+1']]);
    expect(queryCsvRows(rows, { column: 2, equals: '' }).matchedRows).toBe(1);
  });

  it('uses indices even when headers are duplicate, empty or prototype-like', () => {
    const rows = parse('name,name,,__proto__\nleft,right,,constructor');
    expect(queryCsvRows(rows, { column: 1, equals: 'right' }).rows).toEqual([['left', 'right', '', 'constructor']]);
    expect(queryCsvRows(rows, { column: 0, equals: 'right' }).matchedRows).toBe(0);
  });

  it('keeps totalRows and matchedRows exact when returning a bounded prefix', () => {
    const rows = [['header'], ...Array.from({ length: 101 }, (_, index) => [String(index)])];
    expect(queryCsvRows(rows, {})).toMatchObject({ totalRows: 101, matchedRows: 101, rows: expect.any(Array), truncated: true });
    expect(queryCsvRows(rows, {}).rows).toHaveLength(100);
    expect(queryCsvRows(rows, { column: 0, equals: 'missing' })).toMatchObject({ totalRows: 101, matchedRows: 0, rows: [], truncated: false });
    expect(queryCsvRows([['header']], {})).toEqual({ headers: ['header'], totalRows: 0, matchedRows: 0, rows: [], truncated: false });
  });

  it.each([
    null, [], 'text', { resource: { nodeId: 1 } }, { unknown: true },
    { column: 0 }, { equals: '' }, { column: -1, equals: '' }, { column: 128, equals: '' },
    { column: 1.5, equals: '' }, { column: 0, equals: 0 }, { column: 0, equals: 'x'.repeat(257) },
    { limit: 0 }, { limit: 101 }, { limit: 1.5 }, { limit: null },
  ])('rejects invalid query input %#', input => {
    expect(() => validateQueryInput(input)).toThrow(expect.objectContaining({ code: 'INVALID_INPUT' }));
  });

  it('rejects an absent header, an out-of-range column and ragged data rather than hiding data', () => {
    expect(() => queryCsvRows([], {})).toThrow(expect.objectContaining({ code: 'UNSUPPORTED_FORMAT' }));
    expect(() => queryCsvRows([['a']], { column: 1, equals: '' })).toThrow(expect.objectContaining({ code: 'INVALID_INPUT' }));
    expect(() => queryCsvRows([['a'], ['1', '2']], {})).toThrow(expect.objectContaining({ code: 'UNSUPPORTED_FORMAT' }));
    expect(() => queryCsvRows([['a', 'b'], ['1']], {})).toThrow(expect.objectContaining({ code: 'UNSUPPORTED_FORMAT' }));
  });

  it('rejects output above field or UTF-8 result limits and allows non-returned long cells', () => {
    expect(() => queryCsvRows([['a'], ['x'.repeat(4097)]], {})).toThrow(expect.objectContaining({ code: 'FAILED' }));
    expect(() => queryCsvRows([['x'.repeat(4097)]], {})).toThrow(expect.objectContaining({ code: 'FAILED' }));
    const rows = [['a'], ...Array.from({ length: 3 }, () => ['中'.repeat(4000)])];
    expect(() => queryCsvRows(rows, {})).toThrow(expect.objectContaining({ code: 'FAILED' }));
    expect(queryCsvRows(rows, { limit: 1 })).toMatchObject({ matchedRows: 3, truncated: true });
    expect(queryCsvRows([['a'], ['x'.repeat(4097)], ['match']], { column: 0, equals: 'match' }).rows).toEqual([['match']]);
  });
});

describe('CSV Tool bounded resource and standalone execution', () => {
  it('reads split UTF-8 with pacing and completes without Viewer or DOM APIs', async () => {
    const { client } = fixture('\uFEFF名字,值\r\n甲,"换\r\n行"\r\n乙,=SUM(A1)');
    const wait = vi.fn(async () => {});
    await runCsvTool(client, 7, { wait });
    expect(wait).toHaveBeenCalledTimes(client.read.mock.calls.length - 1);
    expect(wait).toHaveBeenCalledWith(25);
    expect(client.completeTool).toHaveBeenCalledTimes(1);
    expect(client.completeTool).toHaveBeenCalledWith('call-1', {
      headers: ['名字', '值'], totalRows: 2, matchedRows: 2,
      rows: [['甲', '换\r\n行'], ['乙', '=SUM(A1)']], truncated: false,
    });
    expect(client.failTool).not.toHaveBeenCalled();
  });

  it.each([new Uint8Array([0xff]), new Uint8Array([0xe4, 0xb8]), 'name\n"unterminated', 'name\n' + 'x'.repeat(CSV_LIMITS.cellChars + 1)])('returns an explicit format failure for invalid content %#', async text => {
    const { client } = fixture(text);
    await runCsvTool(client, 65536);
    expect(client.failTool).toHaveBeenCalledTimes(1);
    expect(client.failTool).toHaveBeenCalledWith('call-1', 'UNSUPPORTED_FORMAT');
    expect(client.completeTool).not.toHaveBeenCalled();
  });

  it('does not read an invalid query or an oversized file', async () => {
    const invalid = fixture('a\n1', { column: 0 });
    await runCsvTool(invalid.client, 65536);
    expect(invalid.client.failTool).toHaveBeenCalledTimes(1);
    expect(invalid.client.failTool).toHaveBeenCalledWith('call-1', 'INVALID_INPUT');
    expect(invalid.client.read).not.toHaveBeenCalled();
    const large = fixture('a\n1');
    large.resource.size = CSV_LIMITS.bytes + 1;
    await runCsvTool(large.client, 65536);
    expect(large.client.failTool).toHaveBeenCalledTimes(1);
    expect(large.client.failTool).toHaveBeenCalledWith('call-1', 'UNSUPPORTED_FORMAT');
    expect(large.client.read).not.toHaveBeenCalled();
  });

  it('rejects mismatched Tool context, revision and incomplete or stalled reads', async () => {
    const wrong = fixture('a\n1');
    wrong.client.context.mockResolvedValue({ kind: 'viewer', resource: wrong.resource });
    await runCsvTool(wrong.client, 65536);
    expect(wrong.client.failTool).toHaveBeenCalledTimes(1);
    expect(wrong.client.failTool).toHaveBeenCalledWith('call-1', 'FAILED');
    expect(wrong.client.read).not.toHaveBeenCalled();
    for (const response of [
      { bytes: new Uint8Array([97]), nextOffset: 1, eof: true, revision: 'version-1' },
      { bytes: new Uint8Array(), nextOffset: 0, eof: false, revision: 'version-1' },
      { bytes: new Uint8Array([97, 10, 49]), nextOffset: 3, eof: true, revision: 'version-2' },
    ]) {
      const { client } = fixture('a\n1');
      client.read.mockResolvedValue(response);
      await runCsvTool(client, 65536);
      expect(client.failTool).toHaveBeenCalledTimes(1);
      expect(client.failTool).toHaveBeenCalledWith('call-1', 'FAILED');
      expect(client.completeTool).not.toHaveBeenCalled();
    }
  });

  it('honors cancellation between read chunks', async () => {
    const { client, resource } = fixture('name\nvalue');
    const controller = new AbortController();
    await expect(readCsvResource(client, resource, 2, {
      signal: controller.signal, wait: async () => controller.abort(),
    })).rejects.toMatchObject({ code: 'FAILED' });
    expect(client.read).toHaveBeenCalledTimes(1);
  });

  it('does not report a second terminal result if the host rejects completion', async () => {
    const { client } = fixture('a\n1');
    client.completeTool.mockRejectedValue(new Error('cancelled invocation'));
    await expect(runCsvTool(client, 65536)).rejects.toThrow('cancelled invocation');
    expect(client.completeTool).toHaveBeenCalledTimes(1);
    expect(client.failTool).not.toHaveBeenCalled();
  });
});
