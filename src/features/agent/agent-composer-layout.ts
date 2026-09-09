export const INITIAL_AGENT_COMPOSER_HEIGHT = 96;
export const MIN_AGENT_COMPOSER_HEIGHT = INITIAL_AGENT_COMPOSER_HEIGHT;
export const MAX_AGENT_COMPOSER_HEIGHT = INITIAL_AGENT_COMPOSER_HEIGHT * 2;

export function clampAgentComposerHeight(value: number): number {
  return Math.max(MIN_AGENT_COMPOSER_HEIGHT, Math.min(MAX_AGENT_COMPOSER_HEIGHT, value));
}
