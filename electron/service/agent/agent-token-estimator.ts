function isNonAsciiCharacter(character: string): boolean {
  return Number(character.codePointAt(0)) > 0x7f;
}

export function estimateAgentTextTokens(value: string): number {
  let nonAsciiCharacters = 0;
  let otherCharacters = 0;
  for (const character of String(value || '')) {
    if (isNonAsciiCharacter(character)) nonAsciiCharacters += 1;
    else otherCharacters += 1;
  }
  return Math.max(1, Math.ceil((nonAsciiCharacters * 1.1) + (otherCharacters / 3.5)));
}
