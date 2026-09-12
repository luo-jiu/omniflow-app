export const INITIAL_AGENT_COMPOSER_HEIGHT = 120;
export const MIN_AGENT_COMPOSER_HEIGHT = INITIAL_AGENT_COMPOSER_HEIGHT;
export const MAX_AGENT_COMPOSER_HEIGHT = 320;
export const AGENT_COMPOSER_CHROME_HEIGHT = 44;

export function clampAgentComposerHeight(value: number): number {
  return Math.max(MIN_AGENT_COMPOSER_HEIGHT, Math.min(MAX_AGENT_COMPOSER_HEIGHT, value));
}
