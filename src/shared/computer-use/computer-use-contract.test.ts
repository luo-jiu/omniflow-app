import { describe, expect, it, vi } from 'vitest';

import {
  COMPUTER_ELEMENT_OPERATIONS,
  COMPUTER_TEXT_MAX_UNICODE_SCALARS,
  COMPUTER_TEXT_MAX_UTF8_BYTES,
  normalizeComputerElementOperations,
  validateComputerText,
} from './computer-use-contract';

describe('computer operation permission protocol', () => {
  it('preserves an exact nonempty bounded grant without retaining the caller array', () => {
    expect(Object.isFrozen(COMPUTER_ELEMENT_OPERATIONS)).toBe(true);
    const operations = [...COMPUTER_ELEMENT_OPERATIONS];
    const normalized = normalizeComputerElementOperations(operations);
    expect(normalized).toEqual(operations);
    expect(normalized).not.toBe(operations);
    expect(normalizeComputerElementOperations(['scrollDownStep', 'replaceText', 'press']))
      .toEqual(['scrollDownStep', 'replaceText', 'press']);
    expect(normalizeComputerElementOperations(Object.freeze(['press']))).toEqual(['press']);
  });

  it.each([undefined, null, {}, 'press', [], ['press', 'press'], ['AXPress'], ['scroll'], ['press', 1],
    [...COMPUTER_ELEMENT_OPERATIONS, 'press']])('rejects invalid or ambiguous grants: %j', operations => {
    expect(() => normalizeComputerElementOperations(operations)).toThrow();
  });

  it('rejects sparse, accessor, hidden, symbolic, extended and inherited arrays without invoking getters', () => {
    const getter = vi.fn(() => 'press');
    const accessor = Object.defineProperty(['press'], '0', { enumerable: true, get: getter });
    const hidden = Object.defineProperty(['press'], '0', { enumerable: false, value: 'press' });
    const extended = Object.assign(['press'], { permission: 'approved' });
    const symbolic = Object.assign(['press'], { [Symbol('private')]: true });
    const inherited = ['press'];
    Object.setPrototypeOf(inherited, Object.create(Array.prototype));
    for (const invalid of [new Array(1), accessor, hidden, extended, symbolic, inherited]) {
      expect(() => normalizeComputerElementOperations(invalid)).toThrow();
    }
    expect(getter).not.toHaveBeenCalled();
  });

  it('keeps fraction permissions explicit and distinct from page and step', () => {
    const fractions = ['scrollUpFraction', 'scrollDownFraction', 'scrollLeftFraction', 'scrollRightFraction'];
    expect(normalizeComputerElementOperations(fractions)).toEqual(fractions);
    expect(normalizeComputerElementOperations(['scrollDownPage', 'scrollDownStep']))
      .not.toContain('scrollDownFraction');
    expect(() => normalizeComputerElementOperations(['scrollDownPercent'])).toThrow();
  });
});

describe('computer text protocol', () => {
  it('preserves whitespace and Unicode scalars exactly, reporting bytes independently', () => {
    expect(validateComputerText(' 中文\t\n\r🪟e\u0301 ', 'replace'))
      .toEqual({ text: ' 中文\t\n\r🪟e\u0301 ', textLength: 10, textBytes: 18 });
    expect(validateComputerText('', 'replace')).toEqual({ text: '', textLength: 0, textBytes: 0 });
    expect(validateComputerText(' ', 'insert')).toEqual({ text: ' ', textLength: 1, textBytes: 1 });
  });

  it('accepts both exact scalar and byte limits but rejects the next scalar without truncating', () => {
    const ascii = 'a'.repeat(COMPUTER_TEXT_MAX_UNICODE_SCALARS);
    expect(validateComputerText(ascii, 'replace')).toEqual({
      text: ascii, textLength: COMPUTER_TEXT_MAX_UNICODE_SCALARS, textBytes: COMPUTER_TEXT_MAX_UNICODE_SCALARS,
    });
    const unicode = '🪟'.repeat(COMPUTER_TEXT_MAX_UNICODE_SCALARS);
    expect(validateComputerText(unicode, 'insert')).toEqual({
      text: unicode, textLength: COMPUTER_TEXT_MAX_UNICODE_SCALARS, textBytes: COMPUTER_TEXT_MAX_UTF8_BYTES,
    });
    for (const invalid of [`${ascii}a`, `${unicode}🪟`]) {
      expect(() => validateComputerText(invalid, 'replace')).toThrow();
    }
  });

  it.each([undefined, null, 123, false, [], {}])('rejects text coercion: %j', input => {
    expect(() => validateComputerText(input, 'replace')).toThrow();
  });

  it('rejects empty insert, unsupported modes, controls, Bidi and isolated surrogates without echoing text', () => {
    expect(() => validateComputerText('', 'insert')).toThrow();
    expect(() => validateComputerText('text', 'append' as 'replace')).toThrow();
    const forbidden = [
      ...Array.from({ length: 32 }, (_, code) => code).filter(code => code !== 9 && code !== 10 && code !== 13),
      ...Array.from({ length: 33 }, (_, index) => 127 + index),
      ...Array.from({ length: 5 }, (_, index) => 0x202a + index),
      ...Array.from({ length: 4 }, (_, index) => 0x2066 + index),
      0xd800, 0xdfff,
    ];
    for (const code of forbidden) {
      const input = `private-body${String.fromCharCode(code)}`;
      expect(() => validateComputerText(input, 'replace')).toThrow('应用窗口文字输入无效');
      try { validateComputerText(input, 'replace'); } catch (error) {
        expect((error as Error).message).not.toContain('private-body');
      }
    }
  });
});
