import { describe, expect, it } from 'vitest';

import {
  MAX_TOOL_NAV_WIDTH,
  MIN_TOOL_NAV_WIDTH,
  getToolNavCollapseButtonLeft,
  normalizeToolOrder,
  normalizeToolWorkspaceLayout,
  projectAvailableToolOrder,
  mergeVisibleToolOrder,
} from './tool-workspace.layout';

describe('tool workspace layout', () => {
  it('retains unavailable namespaced ids across normalization and visible reordering', () => {
    const stored = normalizeToolOrder(['ai-services', 'example.missing', 'qqmusic-lyrics']);
    expect(stored[1]).toBe('example.missing');
    const available = ['ai-services', 'qqmusic-lyrics'] as const;
    expect(projectAvailableToolOrder(stored, available)).toEqual([...available]);
    const next = mergeVisibleToolOrder(stored, ['qqmusic-lyrics', 'ai-services']);
    expect(next.slice(0, 3)).toEqual(['qqmusic-lyrics', 'example.missing', 'ai-services']);
    expect(projectAvailableToolOrder(next, ['ai-services', 'qqmusic-lyrics', 'example.missing'])).toEqual(['qqmusic-lyrics', 'example.missing', 'ai-services']);
  });
  it('appends newly registered contributions without dropping saved unavailable entries', () => {
    expect(projectAvailableToolOrder(['example.missing', 'ai-services'], ['ai-services', 'example.new'])).toEqual(['ai-services', 'example.new']);
    expect(mergeVisibleToolOrder(['example.missing', 'ai-services'], ['example.new', 'ai-services'])).toEqual(['example.missing', 'example.new', 'ai-services']);
  });
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
