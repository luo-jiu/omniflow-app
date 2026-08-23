export const MIN_AGENT_COMPOSER_HEIGHT = 78;
export const MAX_AGENT_COMPOSER_HEIGHT = 260;
export const INITIAL_AGENT_COMPOSER_HEIGHT = 96;

export function clampAgentComposerHeight(value: number): number {
  return Math.max(MIN_AGENT_COMPOSER_HEIGHT, Math.min(MAX_AGENT_COMPOSER_HEIGHT, value));
}

export function resolveAgentComposerDragHeight(
  startHeight: number,
  startY: number,
  currentY: number,
): number {
  return clampAgentComposerHeight(startHeight + startY - currentY);
}
