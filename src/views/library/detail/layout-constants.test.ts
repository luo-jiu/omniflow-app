import { describe, expect, it } from 'vitest';

import { AGENT_WORKSPACE_MIN_WIDTH } from '@/features/agent/agent-session-directory-layout';
import { getMaxSidePanelWidth, MIN_SIDE_PANEL_WIDTH } from './layout-constants';

describe('Library detail sidebar width budget', () => {
  it.each([1120, 1280, 1600])('reserves the complete Agent minimum within a %ipx workspace', width => {
    const maxSidebar = getMaxSidePanelWidth(width, width, AGENT_WORKSPACE_MIN_WIDTH);
    expect(maxSidebar).toBeGreaterThanOrEqual(MIN_SIDE_PANEL_WIDTH);
    expect(width - maxSidebar).toBeGreaterThanOrEqual(784);
  });

  it('uses the actual workspace width rather than the whole window budget', () => {
    expect(getMaxSidePanelWidth(1120, 1920, AGENT_WORKSPACE_MIN_WIDTH)).toBe(336);
  });

  it('temporarily hides the tree when both minimum widths cannot fit', () => {
    expect(getMaxSidePanelWidth(1000, 1280, AGENT_WORKSPACE_MIN_WIDTH)).toBe(0);
    expect(getMaxSidePanelWidth(1024, 1280, AGENT_WORKSPACE_MIN_WIDTH)).toBe(240);
    expect(getMaxSidePanelWidth(700, 1120, AGENT_WORKSPACE_MIN_WIDTH)).toBe(0);
  });

  it('retains the existing 80 percent limit for other workspaces', () => {
    expect(getMaxSidePanelWidth(1600, 1600)).toBe(1280);
  });
});
