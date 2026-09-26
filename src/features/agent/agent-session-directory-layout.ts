export const AGENT_CHAT_MAX_WIDTH = 850;
export const AGENT_CHAT_MIN_WIDTH = 640;
export const AGENT_CHAT_INDEX_INSET = 64;
export const AGENT_DIRECTORY_WIDTH = 300;
export const AGENT_DIRECTORY_MARGIN = 12;
export const AGENT_DIRECTORY_BUBBLE_SIZE = 32;
export const AGENT_DIRECTORY_BUBBLE_WIDTH = 48;
export const AGENT_DIRECTORY_MAX_HEIGHT = 480;
export const AGENT_DIRECTORY_MIN_HEIGHT = 140;
export const AGENT_DIRECTORY_SLIDE_MS = 374;
export const AGENT_DIRECTORY_LAYOUT_MS = AGENT_DIRECTORY_SLIDE_MS;
export const AGENT_DIRECTORY_SNAP_MS = 440;
export const AGENT_DIRECTORY_RESERVED_WIDTH = AGENT_DIRECTORY_WIDTH + 2 * AGENT_DIRECTORY_MARGIN;
export const AGENT_DIRECTORY_BUBBLE_RESERVED_WIDTH = AGENT_DIRECTORY_BUBBLE_WIDTH + 2 * AGENT_DIRECTORY_MARGIN;
export const AGENT_WORKSPACE_MIN_WIDTH = AGENT_CHAT_MIN_WIDTH + AGENT_CHAT_INDEX_INSET
  + AGENT_DIRECTORY_BUBBLE_RESERVED_WIDTH + 8;
export const AGENT_DIRECTORY_BREAKPOINT = AGENT_CHAT_MAX_WIDTH + AGENT_CHAT_INDEX_INSET
  + AGENT_DIRECTORY_RESERVED_WIDTH + 8;

export function clampAgentDirectoryBubbleTop(top: number, workspaceHeight: number): number {
  const maxTop = Math.max(AGENT_DIRECTORY_MARGIN,
    workspaceHeight - AGENT_DIRECTORY_MARGIN - AGENT_DIRECTORY_BUBBLE_SIZE);
  return Math.max(AGENT_DIRECTORY_MARGIN, Math.min(top, maxTop));
}

export function clampAgentDirectoryPanelPosition(
  left: number,
  top: number,
  workspaceWidth: number,
  workspaceHeight: number,
  panelHeight = AGENT_DIRECTORY_MIN_HEIGHT,
) {
  return {
    left: Math.max(AGENT_DIRECTORY_MARGIN,
      Math.min(left, workspaceWidth - AGENT_DIRECTORY_WIDTH - AGENT_DIRECTORY_MARGIN)),
    top: Math.max(AGENT_DIRECTORY_MARGIN,
      Math.min(top, workspaceHeight - panelHeight - AGENT_DIRECTORY_MARGIN)),
  };
}
