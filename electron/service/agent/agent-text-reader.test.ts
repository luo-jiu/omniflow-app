import { describe, expect, it } from 'vitest';
import { AGENT_TEXT_MAX_BYTES, collectAgentTextStream, decodeAgentText, sliceAgentText } from './agent-text-reader';

describe('bounded text reading', () => {
  it.each([
    { text: '', lineEnding: 'none', endsWithNewline: false, hasBom: false, lines: [] },
    { text: '\uFEFF', lineEnding: 'none', endsWithNewline: false, hasBom: true, lines: [] },
    { text: '旧', lineEnding: 'none', endsWithNewline: false, hasBom: false, lines: ['旧'] },
    { text: '旧\n', lineEnding: 'lf', endsWithNewline: true, hasBom: false, lines: ['旧'] },
    { text: '\uFEFF旧\r\n文\r\n', lineEnding: 'crlf', endsWithNewline: true, hasBom: true, lines: ['旧', '文'] },
    { text: '旧\r文', lineEnding: 'cr', endsWithNewline: false, hasBom: false, lines: ['旧', '文'] },
    { text: '旧\r文\n', lineEnding: 'mixed', endsWithNewline: true, hasBom: false, lines: ['旧', '文'] },
    { text: '\r\n\n', lineEnding: 'mixed', endsWithNewline: true, hasBom: false, lines: ['', ''] },
  ])('reports raw text metadata for $lineEnding/$hasBom/$endsWithNewline', ({ text, ...expected }) => {
    const bytes = Buffer.from(text);
    expect(decodeAgentText(bytes)).toMatchObject({ ...expected, encoding: 'utf-8', sizeBytes: bytes.byteLength });
  });

  it('does not infer EOF state from displayed lines', () => {
    const noEof = decodeAgentText(Buffer.from('old'));
    const withEof = decodeAgentText(Buffer.from('old\n'));
    expect(noEof.lines).toEqual(withEof.lines);
    expect(noEof.endsWithNewline).toBe(false);
    expect(withEof.endsWithNewline).toBe(true);
    expect(noEof.revision).not.toBe(withEof.revision);
  });

  it('uses one-based lines, normalizes CRLF and exposes exact continuation', () => {
    const bytes = Buffer.from('one\r\n二\r\nthree\n');
    const first = sliceAgentText(bytes, { path: '/a', limit: 2 });
    expect(first).toMatchObject({ hasMore: true, nextOffset: 3, nextColumn: 1, totalLines: 3 });
    const next = sliceAgentText(bytes, { path: '/a', offset: first.nextOffset, revision: first.revision });
    expect(next.lines).toEqual([{ line: 3, column: 1, text: 'three' }]);
    expect(next.hasMore).toBe(false);
    expect(() => sliceAgentText(Buffer.from('changed'), { path: '/a', revision: first.revision })).toThrow('已变化');
  });
  it('resumes long Unicode lines without losing characters', () => {
    const source = '文😀'.repeat(3000);
    const bytes = Buffer.from(source);
    let offset = 1, column = 1, combined = '';
    for (let page = 0; page < 10; page += 1) {
      const result = sliceAgentText(bytes, { path: '/a', offset, column }, 4096);
      combined += result.lines.map(line => line.text).join('');
      if (!result.hasMore) break;
      offset = result.nextOffset!; column = result.nextColumn!;
    }
    expect(combined).toBe(source);
  });
  it('does not impose default or explicit line-count caps', () => {
    const bytes = Buffer.from('x\n'.repeat(3000));
    expect(sliceAgentText(bytes, { path: '/a' })).toMatchObject({ totalLines: 3000, endLine: 3000, hasMore: false });
    expect(sliceAgentText(bytes, { path: '/a', limit: 2500 })).toMatchObject({ endLine: 2500, nextOffset: 2501, hasMore: true });
  });
  it('handles empty files and refuses invalid ranges, binary and oversized content', () => {
    expect(sliceAgentText(Buffer.alloc(0), { path: '/a' })).toMatchObject({ lines: [], hasMore: false });
    expect(() => sliceAgentText(Buffer.from([0xff]), { path: '/a' })).toThrow('UTF-8');
    expect(() => sliceAgentText(Buffer.from([0]), { path: '/a' })).toThrow('二进制');
    expect(() => sliceAgentText(Buffer.from('a'), { path: '/a', offset: 2 })).toThrow('超出');
    expect(() => sliceAgentText(Buffer.alloc(AGENT_TEXT_MAX_BYTES + 1), { path: '/a' })).toThrow('8 MiB');
  });
  it('bounds stream collection and cancels on overflow or abort', async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({ pull(c) { c.enqueue(new Uint8Array(AGENT_TEXT_MAX_BYTES + 1)); }, cancel() { cancelled = true; } });
    await expect(collectAgentTextStream(stream, new AbortController().signal)).rejects.toThrow('8 MiB');
    expect(cancelled).toBe(true);
    const controller = new AbortController();
    const pending = collectAgentTextStream(new ReadableStream(), controller.signal);
    controller.abort();
    await expect(pending).rejects.toThrow();
  });
});
