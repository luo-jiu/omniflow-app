import { describe, expect, it } from 'vitest';
import { createAgentGrepMatcher, validateAgentGrepPattern } from './agent-grep-matcher';
import { AgentGrepError, runAgentRipgrep } from './agent-ripgrep';
import { resolveAgentRipgrepExecutable } from './agent-ripgrep-executable';

const hasRg = Boolean(await resolveAgentRipgrepExecutable());
const signal = () => new AbortController().signal;
const missing: typeof runAgentRipgrep = async () => { throw new AgentGrepError('UNSUPPORTED_CAPABILITY', 'missing rg'); };

describe('common grep matcher', () => {
  it('keeps literal metacharacters literal and explicitly falls back with the same Unicode lowercase positions', async () => {
    const matcher = await createAgentGrepMatcher({ pattern: 'i', caseSensitive: false }, signal(), missing);
    expect(matcher).toMatchObject({ engine: 'literal-fallback', profile: 'literal-v1', caseFold: 'ecmascript-lowercase' });
    expect(await matcher.match(['😀İ Σ'], 100)).toEqual(new Map([[0, { start: 1, end: 2 }]]));
    const literal = await createAgentGrepMatcher({ pattern: '[a]|.*' }, signal(), missing);
    expect(await literal.match(['aaaa', '😀[a]|.*'], 100)).toEqual(new Map([[1, { start: 1, end: 7 }]]));
    await expect(createAgentGrepMatcher({ pattern: '.', mode: 'regex' }, signal(), missing)).rejects.toMatchObject({ code: 'UNSUPPORTED_CAPABILITY' });
  });
  it('rejects invalid Unicode and unsupported profiles before execution', () => {
    expect(() => validateAgentGrepPattern({ pattern: '\ud800' })).toThrow('Unicode');
    expect(() => validateAgentGrepPattern({ pattern: 'x\ny' })).toThrow('单行');
    expect(() => validateAgentGrepPattern({ pattern: 'x', regexProfile: 'rust-regex-v1' })).toThrow('regexProfile');
  });
  it('rejects malformed, truncated and snapshot-inconsistent rg JSON', async () => {
    for (const output of ['oops', 'null', '{"type":"match","data":{}}', '{"type":"begin","data":{}}']) {
      const corrupt: typeof runAgentRipgrep = async () => output;
      await expect(createAgentGrepMatcher({ pattern: 'x' }, signal(), corrupt)).rejects.toMatchObject({ code: 'SEARCH_FAILED' });
    }
    const inconsistent: typeof runAgentRipgrep = async input => input ? JSON.stringify({ type: 'match', data: { line_number: 1,
      lines: { text: 'wrong\n' }, submatches: [{ start: 0, end: 1 }] } }) : '{"type":"summary","data":{}}';
    const matcher = await createAgentGrepMatcher({ pattern: 'x' }, signal(), inconsistent);
    await expect(matcher.match(['x'], 100)).rejects.toMatchObject({ code: 'SEARCH_FAILED' });
  });
  it.skipIf(!hasRg)('matches the real rg and fallback for Unicode expansion, BOM, metacharacters and case folding', async () => {
    const lines = ['\uFEFF😀needle', '😀İ needle', 'ΟΣ [a]|.*'];
    for (const pattern of ['i', 'NEEDLE', '[a]|.*', 'ος']) {
      const query = { pattern, caseSensitive: false };
      const native = await createAgentGrepMatcher(query, signal());
      const fallback = await createAgentGrepMatcher(query, signal(), missing);
      expect(native.engine).toBe('ripgrep');
      expect(await native.match(lines, 5_000)).toEqual(await fallback.match(lines, 5_000));
    }
  });
  it.skipIf(!hasRg)('supports Rust Unicode regex and zero width, rejects PCRE2 and multiline', async () => {
    const matcher = await createAgentGrepMatcher({ pattern: '\\p{Greek}+', mode: 'regex' }, signal());
    expect(await matcher.match(['😀ΩΣ value', 'none'], 5_000)).toEqual(new Map([[0, { start: 1, end: 3 }]]));
    const zero = await createAgentGrepMatcher({ pattern: '^', mode: 'regex' }, signal());
    expect(await zero.match(['😀Ω', ''], 5_000)).toEqual(new Map([[0, { start: 0, end: 0 }], [1, { start: 0, end: 0 }]]));
    await expect(createAgentGrepMatcher({ pattern: '(?=x)', mode: 'regex' }, signal())).rejects.toMatchObject({ code: 'INVALID_PATTERN' });
    await expect(createAgentGrepMatcher({ pattern: '(x)\\1', mode: 'regex' }, signal())).rejects.toMatchObject({ code: 'INVALID_PATTERN' });
    await expect(createAgentGrepMatcher({ pattern: 'x\\ny', mode: 'regex' }, signal())).rejects.toThrow();
  });
});
