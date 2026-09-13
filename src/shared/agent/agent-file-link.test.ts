import { describe, expect, it } from 'vitest';
import { parseAgentFileLink } from './agent-file-link';

describe('file references', () => {
  it('distinguishes local and library paths including spaces and escaped punctuation', () => {
    expect(parseAgentFileLink('omniflow-library:/文档/a%23b.pdf')).toEqual({ scope: 'library', path: '/文档/a#b.pdf' });
    expect(parseAgentFileLink('omniflow-local:/Users/me/My Project/a.ts#L12')).toEqual({ scope: 'local', path: '/Users/me/My Project/a.ts', line: 12 });
    expect(parseAgentFileLink('omniflow-local:C:/work/a.txt')?.scope).toBe('local');
  });
  it.each(['javascript:alert(1)', 'file:///etc/passwd', 'https://example.com', 'omniflow-library://other/a', 'omniflow-local:relative', 'omniflow-library:/a/../b', 'omniflow-local:/a%00b', 'omniflow-local:/a%ZZ'])('rejects unsafe or ambiguous reference %s', value => {
    expect(parseAgentFileLink(value)).toBeNull();
  });
});
