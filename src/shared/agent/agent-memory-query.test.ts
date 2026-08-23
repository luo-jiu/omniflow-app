import { describe, expect, it } from 'vitest';

import {
  agentMemoryFieldMatchesQuery,
  MAX_AGENT_MEMORY_QUERY_CHARACTERS,
  normalizeAgentMemoryQuery,
} from './agent-memory-query';

describe('Agent memory query contract', () => {
  it('trims and limits queries to the SQLite search boundary', () => {
    const query = `  ${'a'.repeat(MAX_AGENT_MEMORY_QUERY_CHARACTERS)}ignored  `;
    expect(normalizeAgentMemoryQuery(query)).toBe(
      'a'.repeat(MAX_AGENT_MEMORY_QUERY_CHARACTERS),
    );
  });

  it('matches ASCII case like SQLite LIKE without locale-folding Unicode', () => {
    expect(agentMemoryFieldMatchesQuery('OpenAI Profile', 'openai')).toBe(true);
    expect(agentMemoryFieldMatchesQuery('ÄBC', 'äbc')).toBe(false);
  });

  it('treats wildcard and escape characters as literal search text', () => {
    expect(agentMemoryFieldMatchesQuery('规则包含 100%_ready\\path', '%_ready\\')).toBe(true);
  });
});
