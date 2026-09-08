const BIDI_CONTROL_CODE_POINTS = new Set([
  0x061c,
  0x200e,
  0x200f,
  0x202a,
  0x202b,
  0x202c,
  0x202d,
  0x202e,
  0x2066,
  0x2067,
  0x2068,
  0x2069,
  0x206a,
  0x206b,
  0x206c,
  0x206d,
  0x206e,
  0x206f,
]);

function unicodeEscape(codePoint: number): string {
  return `\\u${codePoint.toString(16).padStart(4, '0')}`;
}

/** Keeps execution bytes untouched while making invisible command controls auditable in the UI. */
export function formatAgentShellCommandForDisplay(command: string): string {
  return Array.from(command).map((character) => {
    if (character === '\\') return '\\\\';
    const codePoint = character.codePointAt(0) || 0;
    if (codePoint === 0x08) return '\\b';
    if (codePoint === 0x09) return '\\t';
    if (codePoint === 0x0a) return '\\n';
    if (codePoint === 0x0b) return '\\v';
    if (codePoint === 0x0c) return '\\f';
    if (codePoint === 0x0d) return '\\r';
    if (
      codePoint < 0x20
      || (codePoint >= 0x7f && codePoint <= 0x9f)
      || codePoint === 0x2028
      || codePoint === 0x2029
      || BIDI_CONTROL_CODE_POINTS.has(codePoint)
    ) {
      return unicodeEscape(codePoint);
    }
    return character;
  }).join('');
}
