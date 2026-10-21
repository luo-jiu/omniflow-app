import { describe, expect, it } from 'vitest';
import { computeAgentFileDiff } from './agent-file-diff-engine';
import { AGENT_DIFF_MAX_CHARACTERS, AGENT_DIFF_MAX_PAGES, AGENT_DIFF_PAGE_CHARACTERS, type AgentFileDiffJob } from './agent-file-diff.types';

const job = (overrides: Partial<AgentFileDiffJob> = {}): AgentFileDiffJob => ({ before: 'old\n', after: 'new\n',
  beforeLabel: 'a/fixture.txt', afterLabel: 'b/fixture.txt', pageLines: 200, ...overrides });

describe('bounded worker diff computation', () => {
  it('delivers every line across bounded pages without treating pagination as truncation', () => {
    const result = computeAgentFileDiff(job({ before: '', after: Array.from({ length: 650 }, (_, index) => `line-${index}`).join('\n') }));
    expect(result.truncated).toBe(false);
    expect(result.pages.length).toBeGreaterThan(3);
    expect(result.pages.every(page => page.patch.length <= AGENT_DIFF_PAGE_CHARACTERS && page.endLine - page.startLine < 200)).toBe(true);
    const whole = result.pages.map(page => page.patch).join('');
    expect(whole).toContain('+line-0\n'); expect(whole).toContain('+line-649\n');
    expect(result.pages.at(-1)!.endLine).toBe(result.totalLines);
    expect(result.pages[1].startLine).toBe(result.pages[0].endLine + 1);
  });

  it('splits long Unicode lines at valid boundaries and preserves their exact text across pages', () => {
    const after = '😀汉'.repeat(25_000);
    const result = computeAgentFileDiff(job({ after }));
    const whole = result.pages.map(page => page.patch).join('');
    expect(whole).toContain(`+${after}\n`);
    expect(result.pages.some(page => page.continuesOnNext)).toBe(true);
    expect(result.pages.some(page => page.continuedFromPrevious)).toBe(true);
    for (const page of result.pages) expect(Buffer.from(page.patch).toString('utf8')).toBe(page.patch);
    expect(result.truncated).toBe(false);
  });

  it('distinguishes no changes from source-line, total-output and page-count budgets', () => {
    expect(computeAgentFileDiff(job({ before: 'same', after: 'same' }))).toMatchObject({ truncated: false, totalLines: 0, pages: [{ patch: '' }] });
    expect(computeAgentFileDiff(job({ after: '\n'.repeat(200_001) }))).toMatchObject({ truncated: true, warning: expect.stringContaining('行数') });
    const long = computeAgentFileDiff(job({ after: 'x'.repeat(AGENT_DIFF_MAX_CHARACTERS + 200) }));
    expect(long.truncated).toBe(true);
    expect(long.pages.reduce((sum, page) => sum + page.patch.length, 0)).toBeLessThanOrEqual(AGENT_DIFF_MAX_CHARACTERS);
    const many = computeAgentFileDiff(job({ before: '', after: 'line\n'.repeat(5000), pageLines: 1 }));
    expect(many.pages).toHaveLength(AGENT_DIFF_MAX_PAGES);
    expect(many.warning).toContain('分页数量');
  });

  it('rejects invalid and oversized source requests before diffing', () => {
    expect(() => computeAgentFileDiff(job({ pageLines: 501 }))).toThrow('无效');
    expect(() => computeAgentFileDiff(job({ before: 'x'.repeat(8 * 1024 * 1024 + 1) }))).toThrow('无效');
  });
});
