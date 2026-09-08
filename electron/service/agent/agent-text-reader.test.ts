import { describe, expect, it } from 'vitest';
import { AGENT_TEXT_MAX_BYTES, collectAgentTextStream, sliceAgentText } from './agent-text-reader';

describe('bounded text reading', () => {
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
      const result = sliceAgentText(bytes, { path: '/a', offset, column });
      combined += result.lines.map(line => line.text).join('');
      if (!result.hasMore) break;
      offset = result.nextOffset!; column = result.nextColumn!;
    }
    expect(combined).toBe(source);
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
