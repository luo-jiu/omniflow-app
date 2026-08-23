import { describe, expect, it } from 'vitest';

import {
  MAX_TOOL_NAV_WIDTH,
  MIN_TOOL_NAV_WIDTH,
  getToolNavCollapseButtonLeft,
  normalizeToolOrder,
  normalizeToolWorkspaceLayout,
} from './tool-workspace.layout';

describe('tool workspace layout', () => {
  it('drops unknown and duplicate ids, then appends newly available tools', () => {
    expect(normalizeToolOrder([
      'media-processing',
      'unknown-tool',
      'media-processing',
      'subtitle-translation',
    ])).toEqual([
      'media-processing',
      'subtitle-translation',
      'ai-services',
      'qqmusic-lyrics',
      'media-file-processing',
    ]);
  });

  it('clamps persisted width to supported boundaries', () => {
    expect(normalizeToolWorkspaceLayout({ navWidth: 1 }).navWidth).toBe(MIN_TOOL_NAV_WIDTH);
    expect(normalizeToolWorkspaceLayout({ navWidth: 999 }).navWidth).toBe(MAX_TOOL_NAV_WIDTH);
  });

  it('falls back to the complete default layout for invalid data', () => {
    expect(normalizeToolWorkspaceLayout(null)).toEqual({
      navWidth: 208,
      toolOrder: [
        'ai-services',
        'qqmusic-lyrics',
        'subtitle-translation',
        'media-file-processing',
        'media-processing',
      ],
    });
  });

  it('aligns the collapse button with the reorder column or collapsed icons', () => {
    expect(getToolNavCollapseButtonLeft(208, false)).toBe(170);
    expect(getToolNavCollapseButtonLeft(MIN_TOOL_NAV_WIDTH, true)).toBe(16);
  });

  it('migrates the legacy icon-only width without changing current custom widths', () => {
    expect(normalizeToolWorkspaceLayout({ navWidth: 58 }, 1).navWidth).toBe(MIN_TOOL_NAV_WIDTH);
    expect(normalizeToolWorkspaceLayout({ navWidth: 58 }, 2).navWidth).toBe(58);
  });
});
