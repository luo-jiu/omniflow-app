import { describe, expect, it } from 'vitest';
import {
  AGENT_CHAT_INDEX_INSET,
  AGENT_CHAT_MAX_WIDTH,
  AGENT_DIRECTORY_BREAKPOINT,
  AGENT_DIRECTORY_RESERVED_WIDTH,
  AGENT_DIRECTORY_WIDTH,
  clampAgentDirectoryBubbleTop,
  clampAgentDirectoryPanelPosition,
} from './agent-session-directory-layout';

describe('Agent session directory placement', () => {
  it('switches to a bubble before the pinned directory squeezes the full chat width', () => {
    expect(AGENT_DIRECTORY_BREAKPOINT - AGENT_CHAT_INDEX_INSET - AGENT_DIRECTORY_RESERVED_WIDTH - 8)
      .toBe(AGENT_CHAT_MAX_WIDTH);
  });

  it('keeps a dragged bubble inside the workspace after a height reduction', () => {
    expect(clampAgentDirectoryBubbleTop(-200, 600)).toBe(12);
    expect(clampAgentDirectoryBubbleTop(900, 600)).toBe(556);
    expect(clampAgentDirectoryBubbleTop(556, 300)).toBe(256);
  });

  it('allows free movement within the workspace while keeping the full panel reachable', () => {
    expect(clampAgentDirectoryPanelPosition(200, 180, 1200, 800, 352)).toEqual({ left: 200, top: 180 });
    expect(clampAgentDirectoryPanelPosition(-100, -100, 1200, 800, 352)).toEqual({ left: 12, top: 12 });
    expect(clampAgentDirectoryPanelPosition(2000, 1000, 1200, 800, 352)).toEqual({ left: 1200 - AGENT_DIRECTORY_WIDTH - 12, top: 436 });
  });

  it('keeps the same vertical origin when possible and reserves enough height after resizing', () => {
    expect(clampAgentDirectoryPanelPosition(0, 222, 900, 800).top).toBe(222);
    expect(clampAgentDirectoryPanelPosition(0, 556, 900, 300).top).toBe(148);
  });
});
