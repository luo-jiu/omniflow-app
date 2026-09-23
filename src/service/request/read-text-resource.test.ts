import { afterEach, describe, expect, it, vi } from 'vitest';
import { readTextResource } from './read-text-resource';

afterEach(() => vi.unstubAllGlobals());
describe('raw text resource reads', () => {
  it.each([
    '{\r\n  "name": "中文", "id": 9007199254740993\r\n}\n',
    '[1, 2, 3]\n',
    'null',
    '\uFEFF{"a":1}',
    '',
  ])('preserves exact UTF-8 text without parsing JSON: %j', async text => {
    const fetchBinary = vi.fn(async () => ({ status: 200, base64: Buffer.from(text, 'utf8').toString('base64'), truncated: false }));
    vi.stubGlobal('window', { electronAPI: { fetchBinary } });
    await expect(readTextResource('https://example.test/file')).resolves.toBe(text);
    expect(fetchBinary).toHaveBeenCalledWith('https://example.test/file', { method: 'GET' });
  });
  it('rejects partial reads instead of allowing a truncated editor baseline', async () => {
    vi.stubGlobal('window', { electronAPI: { fetchBinary: async () => ({ status: 200, base64: 'e30=', truncated: true }) } });
    await expect(readTextResource('https://example.test/file')).rejects.toThrow('读取不完整');
  });
});
