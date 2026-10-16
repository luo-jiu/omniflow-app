/** Optional model-authored display text, never an execution target or receipt. */
export const AGENT_COMPUTER_STEP_TITLE_MAX_LENGTH = 80;

export function normalizeAgentComputerStepTitle(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > AGENT_COMPUTER_STEP_TITLE_MAX_LENGTH * 2
    || [...value].length > AGENT_COMPUTER_STEP_TITLE_MAX_LENGTH) return undefined;
  for (const character of value) {
    const code = character.charCodeAt(0);
    if ((code < 32 && code !== 9 && code !== 10 && code !== 13) || (code >= 127 && code <= 159)
      || (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069)
      || (character.length === 1 && code >= 0xd800 && code <= 0xdfff)) return undefined;
  }
  const title = value.replace(/\s+/gu, ' ').trim();
  return title && title !== '[REDACTED]' && title !== '[TRUNCATED]' ? title : undefined;
}

export function getAgentComputerStepTitle(input: unknown): string | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(input, 'title');
  return descriptor?.enumerable && 'value' in descriptor
    ? normalizeAgentComputerStepTitle(descriptor.value) : undefined;
}
