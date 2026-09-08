import { describe, expect, it } from 'vitest';

import { formatAgentShellCommandForDisplay } from './agent-shell-command-display';

describe('Agent Shell command display', () => {
  it('preserves ordinary whitespace boundaries and makes line and tab controls visible', () => {
    const command = "  printf 'a  b'\tline\nnext  ";

    expect(formatAgentShellCommandForDisplay(command))
      .toBe("  printf 'a  b'\\tline\\nnext  ");
  });

  it('escapes backslashes before controls so the display remains unambiguous', () => {
    expect(formatAgentShellCommandForDisplay("printf '\\n'\n"))
      .toBe("printf '\\\\n'\\n");
  });

  it('escapes every C0 control, DEL, C1 controls and Unicode line separators', () => {
    const controls = [
      ...Array.from({ length: 0x20 }, (_, codePoint) => String.fromCodePoint(codePoint)),
      String.fromCodePoint(0x7f),
      String.fromCodePoint(0x85),
      String.fromCodePoint(0x9f),
      String.fromCodePoint(0x2028),
      String.fromCodePoint(0x2029),
    ].join('');
    const formatted = formatAgentShellCommandForDisplay(controls);

    expect(Array.from(formatted).every((character) => {
      const codePoint = character.codePointAt(0) || 0;
      return codePoint >= 0x20
        && !(codePoint >= 0x7f && codePoint <= 0x9f)
        && codePoint !== 0x2028
        && codePoint !== 0x2029;
    })).toBe(true);
    expect(formatted).toContain('\\u0000');
    expect(formatted).toContain('\\t');
    expect(formatted).toContain('\\n');
    expect(formatted).toContain('\\u007f');
    expect(formatted).toContain('\\u0085');
    expect(formatted).toContain('\\u2028');
  });

  it.each([
    [0x061c, '\\u061c'],
    [0x200e, '\\u200e'],
    [0x202e, '\\u202e'],
    [0x2066, '\\u2066'],
    [0x2069, '\\u2069'],
    [0x206f, '\\u206f'],
  ])('escapes bidi control U+%s', (codePoint, expected) => {
    expect(formatAgentShellCommandForDisplay(`left${String.fromCodePoint(codePoint)}right`))
      .toBe(`left${expected}right`);
  });
});
