import { describe, expect, it, vi } from 'vitest';
import { getAgentComputerStepTitle, normalizeAgentComputerStepTitle } from './agent-computer-step-title';

describe('computer step display titles', () => {
  it('normalizes optional plain text without changing the actual tool input', () => {
    const input = { title: '  验证\n  关闭按钮\t✅  ', elementId: 'keep-this-target' };
    expect(getAgentComputerStepTitle(input)).toBe('验证 关闭按钮 ✅');
    expect(input).toEqual({ title: '  验证\n  关闭按钮\t✅  ', elementId: 'keep-this-target' });
    expect(normalizeAgentComputerStepTitle('✅'.repeat(80))).toBe('✅'.repeat(80));
    expect(normalizeAgentComputerStepTitle('<b>检查</b>')).toBe('<b>检查</b>');
  });

  it('falls back for missing, invalid, hidden, inherited or redacted titles without invoking getters', () => {
    const getter = vi.fn(() => 'not display data');
    for (const input of [undefined, null, [], {}, { title: '' }, { title: ' \n\t ' }, { title: 1 },
      { title: 'x'.repeat(81) }, { title: '界'.repeat(1_000_000) }, { title: '不安全\u202e文本' },
      { title: '\ud800' }, { title: '含\0控制字符' }, { title: '[REDACTED]' }, { title: '[TRUNCATED]' },
      Object.create({ title: 'inherited' }), Object.defineProperty({}, 'title', { value: 'hidden' }),
      Object.defineProperty({}, 'title', { enumerable: true, get: getter })]) {
      expect(getAgentComputerStepTitle(input)).toBeUndefined();
    }
    expect(getter).not.toHaveBeenCalled();
  });
});
