import { describe, expect, it, vi } from 'vitest';
import { applyAgentFilePatchAsync, applyAgentFilePatchInput, AgentFilePatchError, preflightAgentFilePatch,
  type AgentFileFinalNewline, type AgentFilePatchSpec } from './agent-file-patch';
import { finalizeAgentFilePatchText } from './agent-file-context-patch';
import { AGENT_FILE_PATCH_EOF_FIXTURES } from './agent-file-patch.fixtures';

const encode = (text: string) => new TextEncoder().encode(text);
const decode = (bytes: Uint8Array) => new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);
const spec = (patch: string, finalNewline: AgentFileFinalNewline = 'preserve'): AgentFilePatchSpec => ({
  patch, finalNewline, path: '/文档/a.txt', format: 'context-v1',
});
const apply = (before: string, patch: string, finalNewline: AgentFileFinalNewline = 'preserve') =>
  applyAgentFilePatchInput(encode(before), spec(patch, finalNewline));
const policies = ['preserve', 'ensure', 'remove'] as const;

describe('context-v1 shared EOF byte fixtures', () => {
  for (const fixture of AGENT_FILE_PATCH_EOF_FIXTURES) {
    it.each(policies)(`${fixture.name}: %s`, async policy => {
      const before = encode(fixture.before);
      const expected = fixture.expected[policy];
      const run = async () => {
        if (!fixture.coreOnly) return (await applyAgentFilePatchAsync(before, spec(fixture.patch!, policy))).bytes;
        const bom = fixture.before.startsWith('\uFEFF') ? '\uFEFF' : '';
        const original = bom ? fixture.before.slice(1) : fixture.before;
        const reconstructed = bom ? fixture.reconstructed!.slice(1) : fixture.reconstructed!;
        return encode(bom + finalizeAgentFilePatchText(original, reconstructed, policy).text);
      };
      if (expected === null) await expect(run()).rejects.toMatchObject({ code: fixture.expectedErrorCode || 'PATCH_FINAL_NEWLINE_CONFLICT',
        diagnostic: { phase: 'finalize', nextAction: 'fix_input' } });
      else expect(Array.from(await run())).toEqual(Array.from(encode(expected)));
      expect(Array.from(before)).toEqual(Array.from(encode(fixture.before)));
    });
  }
});

describe('context-v1 syntax and exact planning', () => {
  it('patches by real context without hunk line counts and reports computed counts', () => {
    const result = apply('header\nint main() {\n    return 0;\n}\n', '@@\n int main() {\n-    return 0;\n+    // 完成😀\n+    return 0;\n }\n');
    expect(decode(result.bytes)).toBe('header\nint main() {\n    // 完成😀\n    return 0;\n}\n');
    expect(result).toMatchObject({ additions: 2, deletions: 1, hunks: 1, changed: true, matchMode: 'exact', warnings: [] });
  });
  it('uses original source locations for all hunks despite earlier insertion', () => {
    expect(decode(apply('a\nb\nc\nd\n', '@@\n a\n+x\n@@\n-c\n+C\n d\n').bytes)).toBe('a\nx\nb\nC\nd\n');
  });
  it('requires every hunk to match before producing any output bytes', async () => {
    const before = encode('a\nb\nc\n');
    await expect(applyAgentFilePatchAsync(before, spec('@@\n-a\n+A\n@@\n-missing\n+C\n'))).rejects.toMatchObject({
      code: 'PATCH_CONTEXT_MISMATCH', diagnostic: { phase: 'match', hunkIndex: 2, patchLine: 4 },
    });
    expect(decode(before)).toBe('a\nb\nc\n');
  });
  it('matches duplicates only when the entire continuous old side is unique', () => {
    expect(decode(apply('first\nx\nsecond\nx\n', '@@\n second\n-x\n+y\n').bytes)).toBe('first\nx\nsecond\ny\n');
    expect(() => apply('first\nx\nsecond\nx\n', '@@\n-x\n+y\n')).toThrow(AgentFilePatchError);
    try { apply('x\nx\nx\nx\nx\nx\nx\n', '@@\n-x\n+y\n'); }
    catch (error) {
      expect(error).toMatchObject({ code: 'PATCH_CONTEXT_AMBIGUOUS', diagnostic: {
        candidateRanges: [1, 2, 3, 4, 5].map(line => ({ startLine: line, endLine: line })), candidatesTruncated: true,
      } });
    }
  });
  it('uses EOF as an actual source-position constraint', () => {
    expect(decode(apply('x\ny\nx', '@@\n-x\n+z\n*** End of File\n').bytes)).toBe('x\ny\nz');
    expect(() => apply('x\ny\n', '@@\n-x\n+z\n*** End of File\n')).toThrow();
  });
  it('rejects overlapping or reversed hunks while allowing consecutive EOF appends', () => {
    expect(() => apply('a\nb\nc\n', '@@\n-b\n+B\n@@\n-a\n+A\n')).toThrow();
    expect(() => apply('a\nb\nc\n', '@@\n-a\n+A\n b\n@@\n-b\n+B\n')).toThrow();
    expect(decode(apply('a', '@@\n+b\n@@\n+c\n').bytes)).toBe('a\nb\nc');
  });
  it.each([
    '', '@@\n', '@@\n a\n', '@@ function foo\n-a\n+b\n', '@@ -1 +1 @@\n-a\n+b\n',
    '*** Begin Patch\n*** Update File: a\n@@\n-a\n+b\n*** End Patch',
    '--- a\n+++ a\n@@\n-a\n+b\n', '@@\n-a\n+b\n\\ No newline at end of file\n',
    '@@\n-a\n+b\n*** End of File\n x\n', '@@\n-a\r+b\n', '@@\n+\uD800\n',
  ])('rejects malformed or unsupported syntax: %j', patch => {
    expect(() => preflightAgentFilePatch(spec(patch))).toThrow(AgentFilePatchError);
  });
  it('locates syntax errors with a hunk and patch line without echoing source text', () => {
    try { preflightAgentFilePatch(spec('@@\n-a\n+b\n@@ function privateName\n')); }
    catch (error) {
      expect(error).toMatchObject({ diagnostic: { phase: 'parse', hunkIndex: 1, patchLine: 4, nextAction: 'fix_input' } });
      expect((error as Error).message).not.toContain('privateName');
    }
  });
});

describe('context-v1 bounded tolerance and byte preservation', () => {
  it('tolerates only ASCII context trailing whitespace and copies original context bytes', () => {
    const result = apply('\uFEFFhead  \r\nold\nlast', '@@\n head\n-old\n+新😀\n');
    expect(decode(result.bytes)).toBe('\uFEFFhead  \r\n新😀\nlast');
    expect(result.matchMode).toBe('context-trailing-whitespace');
  });
  it('prefers a unique exact match over any whitespace-only candidate', () => {
    const result = apply('head  \nx\nhead\nx\n', '@@\n head\n-x\n+y\n');
    expect(decode(result.bytes)).toBe('head  \nx\nhead\ny\n');
    expect(result.matchMode).toBe('exact');
  });
  it('rejects multiple trailing-whitespace matches instead of choosing the first', () => {
    expect(() => apply('head \nx\nhead\t\nx\n', '@@\n head\n-x\n+y\n')).toThrow(expect.objectContaining({ code: 'PATCH_CONTEXT_AMBIGUOUS' }));
  });
  it.each([
    ['head\nold \n', '@@\n head\n-old\n+new\n'],
    ['  head\nold\n', '@@\n head\n-old\n+new\n'],
    ['head\u00A0\nold\n', '@@\n head\n-old\n+new\n'],
    ['“head”\nold\n', '@@\n "head"\n-old\n+new\n'],
  ])('does not normalize deletion text, leading indentation or Unicode: %j', (before, patch) => {
    expect(() => apply(before, patch)).toThrow(expect.objectContaining({ code: 'PATCH_CONTEXT_MISMATCH' }));
  });
  it('preserves mixed separators and uses the corresponding replaced line ending', () => {
    expect(decode(apply('\uFEFFa\r\nb\nc\rlast', '@@\n-b\n+B\n@@\n-c\n+C\n').bytes)).toBe('\uFEFFa\r\nB\nC\rlast');
  });
  it('warns about structural EOF changes and accurately recognizes an unchanged patch', () => {
    expect(apply('a\nb', '@@\n-b\n')).toMatchObject({ warnings: ['EOF_STATE_CHANGED_BY_STRUCTURE'], endsWithNewline: true });
    expect(apply('a', '@@\n-a\n+a\n')).toMatchObject({ changed: false, warnings: [], endsWithNewline: false });
  });
});

describe('context-v1 resource and cancellation bounds', () => {
  it('rejects a long whitespace prefix ending in a non-whitespace character without blocking timers', async () => {
    const controller = new AbortController();
    let timerFired = false;
    const started = performance.now();
    const timer = setTimeout(() => { timerFired = true; controller.abort(); }, 50);
    try {
      await expect(applyAgentFilePatchAsync(encode(' '.repeat(60_000) + 'X\nold\n'),
        spec('@@\n wanted\n-old\n+new\n'), { signal: controller.signal, deadlineMs: Date.now() + 100 }))
        .rejects.toMatchObject({ code: 'PATCH_CONTEXT_MISMATCH' });
      expect(performance.now() - started).toBeLessThan(500);
      expect(timerFired).toBe(false);
    } finally { clearTimeout(timer); }
  });
  it('trims long whitespace tails linearly while retaining their original bytes', async () => {
    const header = 'head' + ' \t'.repeat(60_000);
    const result = await applyAgentFilePatchAsync(encode(header + '\r\nold\n'), spec('@@\n head\n-old\n+new\n'));
    expect(decode(result.bytes)).toBe(header + '\r\nnew\n');
    expect(result.matchMode).toBe('context-trailing-whitespace');
  });
  it('charges scanned trailing whitespace to the shared work limit', async () => {
    const before = encode('X' + ' '.repeat(18_000) + '\nold\n');
    await expect(applyAgentFilePatchAsync(before, spec('@@\n X\n-old\n+new\n'),
      { maxScanWork: before.length * 3 + 100 }))
      .rejects.toMatchObject({ code: 'PATCH_SCAN_LIMIT', diagnostic: { phase: 'match' } });
  });
  it.each(['trailing-whitespace', 'exact'] as const)('allows an actual timer to cancel inside %s long-line matching', async mode => {
    // Decode, validation and source indexing together stay below the first yield.
    // The next yield is required by the trailing scan or bounded equality comparison.
    const header = mode === 'trailing-whitespace' ? 'X' + ' '.repeat(18_000) : 'a'.repeat(20_000);
    const expected = mode === 'trailing-whitespace' ? 'X' : header;
    const before = encode(header + '\nold\n');
    const original = before.slice();
    const controller = new AbortController();
    const cancelled = new Error('cancelled by a real timer');
    let timerFired = false;
    const timer = setTimeout(() => { timerFired = true; controller.abort(cancelled); }, 0);
    try {
      await expect(applyAgentFilePatchAsync(before, spec(`@@\n ${expected}\n-old\n+new\n`), { signal: controller.signal }))
        .rejects.toBe(cancelled);
      expect(timerFired).toBe(true);
      expect(before).toEqual(original);
    } finally { clearTimeout(timer); }
  });
  it('checks the deadline immediately after yielding within a long trailing-whitespace scan', async () => {
    const before = encode('X' + ' '.repeat(18_000) + '\nold\n');
    const deadlineMs = Date.now() + 1_000;
    const yieldControl = vi.fn(async () => { vi.spyOn(Date, 'now').mockReturnValue(deadlineMs + 1); });
    try {
      await expect(applyAgentFilePatchAsync(before, spec('@@\n X\n-old\n+new\n'), { deadlineMs, yieldControl }))
        .rejects.toMatchObject({ code: 'PATCH_SCAN_TIMEOUT' });
      expect(yieldControl).toHaveBeenCalledOnce();
    } finally { vi.restoreAllMocks(); }
  });
  it('decodes UTF-8 characters across native chunk boundaries and rejects incomplete sequences', async () => {
    const header = 'a'.repeat(16_383) + '😀';
    const result = await applyAgentFilePatchAsync(encode(header + '\nold\n'), spec(`@@\n ${header}\n-old\n+new\n`));
    expect(decode(result.bytes)).toBe(header + '\nnew\n');
    const invalid = new Uint8Array([...encode('a'.repeat(16_383)), 0xe2, 0x82]);
    await expect(applyAgentFilePatchAsync(invalid, spec('@@\n+x\n'))).rejects.toMatchObject({ code: 'UNSUPPORTED_ENCODING' });
  });
  it('rejects invalid encodings, binary inputs and source/output over 8 MiB', () => {
    for (const before of [new Uint8Array([255]), encode('a\0b'), encode('%PDF-1.0'), new Uint8Array(8 * 1024 * 1024 + 1)]) {
      expect(() => applyAgentFilePatchInput(before, spec('@@\n+x\n'))).toThrow();
    }
    expect(() => apply('a'.repeat(8 * 1024 * 1024), '@@\n+x\n')).toThrow(expect.objectContaining({ code: 'FILE_TOO_LARGE' }));
  });
  it('rejects overlong patch transport and a deliberately exhausted scan budget', async () => {
    expect(() => preflightAgentFilePatch(spec('@@\n+' + 'x'.repeat(32_000)))).toThrow();
    await expect(applyAgentFilePatchAsync(encode('a\nb\n'), spec('@@\n-a\n+A\n'), { maxScanWork: 1 }))
      .rejects.toMatchObject({ code: 'PATCH_SCAN_LIMIT', diagnostic: { phase: 'match' } });
  });
  it('aborts before work and while yielding to real cancellation', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(applyAgentFilePatchAsync(encode('a'), spec('@@\n-a\n+b\n'), { signal: controller.signal })).rejects.toThrow();
    const second = new AbortController();
    const yieldControl = vi.fn(async () => { second.abort(); });
    await expect(applyAgentFilePatchAsync(encode('\n'.repeat(100_000) + 'old\n'), spec('@@\n-old\n+new\n'),
      { signal: second.signal, yieldControl })).rejects.toThrow();
    expect(yieldControl).toHaveBeenCalledOnce();
  });
  it('times out after a yield instead of relying on a race around synchronous work', async () => {
    const deadlineMs = Date.now() + 1_000;
    const yieldControl = vi.fn(async () => { vi.spyOn(Date, 'now').mockReturnValue(deadlineMs + 1); });
    try {
      await expect(applyAgentFilePatchAsync(encode('\n'.repeat(100_000) + 'old\n'), spec('@@\n-old\n+new\n'),
        { deadlineMs, yieldControl })).rejects.toMatchObject({ code: 'PATCH_SCAN_TIMEOUT' });
    } finally { vi.restoreAllMocks(); }
  });
  it('handles millions of empty lines with compact offsets and cooperative progress', async () => {
    const prefix = '\n'.repeat(1_000_000);
    const yieldControl = vi.fn(async () => {});
    const result = await applyAgentFilePatchAsync(encode(prefix + 'old\n'), spec('@@\n-old\n+new\n'), { yieldControl });
    expect(decode(result.bytes)).toBe(prefix + 'new\n');
    expect(yieldControl.mock.calls.length).toBeGreaterThan(10);
  });
});

describe('legacy unified-v1 through the new dispatch API', () => {
  const legacy = (patch: string): AgentFilePatchSpec => ({ patch, path: '/文档/a.txt', format: 'unified-v1' });
  it('retains exact numeric headers, no-final-newline markers and mixed line bytes', async () => {
    const result = await applyAgentFilePatchAsync(encode('\uFEFFa\r\nb'), legacy('@@ -2 +2 @@\n-b\n\\ No newline at end of file\n+B\n\\ No newline at end of file\n'));
    expect(decode(result.bytes)).toBe('\uFEFFa\r\nB');
    expect(result).toMatchObject({ changed: true, matchMode: 'exact', endsWithNewline: false });
    expect(() => preflightAgentFilePatch(legacy('@@ -1,2 +1 @@\n-a\n+b\n'))).toThrow(expect.objectContaining({
      code: 'INVALID_PATCH', diagnostic: { code: 'INVALID_PATCH', phase: 'parse', nextAction: 'fix_input' },
    }));
    expect(() => preflightAgentFilePatch({ ...legacy('@@ -1 +1 @@\n-a\n+b\n'), finalNewline: 'remove' })).toThrow();
  });
  it('yields, aborts and respects a scan budget without returning partial output', async () => {
    const before = encode('\n'.repeat(100_000) + 'old\n');
    const patch = legacy('@@ -100001 +100001 @@\n-old\n+new\n');
    const controller = new AbortController();
    const yieldControl = vi.fn(async () => { controller.abort(); });
    await expect(applyAgentFilePatchAsync(before, patch, { signal: controller.signal, yieldControl })).rejects.toThrow();
    expect(yieldControl).toHaveBeenCalledOnce();
    expect(decode(before).endsWith('old\n')).toBe(true);
    await expect(applyAgentFilePatchAsync(encode('a\nb\n'), legacy('@@ -2 +2 @@\n-b\n+B\n'), { maxScanWork: 1 }))
      .rejects.toMatchObject({ code: 'PATCH_SCAN_LIMIT' });
  });
});
