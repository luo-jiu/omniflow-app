import { describe, expect, it } from 'vitest';

import {
  createAgentOwnerScope,
  normalizeAgentOwnerScope,
  serializeAgentOwnerScope,
} from './agent-owner-scope';

describe('Agent owner scope', () => {
  it('combines a normalized backend base URL with the numeric account identity', () => {
    const scope = createAgentOwnerScope('https://example.com/api/', 7);
    expect(scope).toEqual({
      accountScope: 'user:7',
      backendScope: 'https://example.com/api',
    });
    expect(serializeAgentOwnerScope(scope)).toBe('["https://example.com/api","user:7"]');
  });

  it('rejects incomplete or unsafe scope values', () => {
    expect(createAgentOwnerScope('file:///tmp/api', 7)).toBeNull();
    expect(createAgentOwnerScope('https://example.com/api?tenant=1', 7)).toBeNull();
    expect(createAgentOwnerScope('https://example.com/api', 0)).toBeNull();
    expect(() => normalizeAgentOwnerScope({
      accountScope: 'user:0',
      backendScope: 'https://example.com/api',
    })).toThrow('账号环境');
  });
});
