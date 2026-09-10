import { describe, expect, it } from 'vitest';
import { packAgentTextResult } from './agent-text-result';
import { decodeAgentText } from './agent-text-reader';
import { projectAgentToolResultForProvider } from './agent-tool-result-projection';

describe('budgeted attachment reads', () => {
  it('packs escaped long lines and page metadata without truncating or skipping characters', () => {
    const original = '中文"\\value'.repeat(3000);
    const decoded = decodeAgentText(Buffer.from(original));
    let offset = 1, column = 1, restored = '';
    for (let attempt = 0; attempt < 100; attempt++) {
      const result = packAgentTextResult(decoded, { path: 'report.pdf', offset, column }, 1000,
        { scope: 'attachment', attachmentId: 'fixture', page: 2, pageCount: 4, hasMorePages: true });
      expect(projectAgentToolResultForProvider(result, 1000).truncated).toBe(false);
      restored += result.data.content.replace(/^L1(?::\d+)?: /u, '');
      if (!result.data.hasMore) break;
      offset = result.data.nextOffset!; column = result.data.nextColumn!;
    }
    expect(restored).toBe(original);
  });
});
