import { describe, expect, it } from 'vitest';

import { buildAgentSystemPrompt } from './agent-prompt-assembler';

describe('Agent prompt assembler', () => {
  it('keeps Chinese replies in standard Simplified Chinese unless requested otherwise', () => {
    const prompt = buildAgentSystemPrompt({
      libraryId: 3,
      platform: 'darwin',
      selectedNodeIds: [],
    }, undefined, ['media.inspect']);

    expect(prompt).toContain('使用规范简体中文');
    expect(prompt).toContain('不要混入无关文字系统');
  });
});
