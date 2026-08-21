import { describe, expect, it, vi } from 'vitest';

import {
  containTreeExpandDoubleClick,
  resolvePendingTreeExpandDecision,
} from './tree-expand-behavior';

describe('directory tree expand behavior', () => {
  it('contains double clicks inside the expand control', () => {
    const preventDefault = vi.fn();
    const stopPropagation = vi.fn();
    const stopImmediatePropagation = vi.fn();

    containTreeExpandDoubleClick({
      preventDefault,
      stopPropagation,
      nativeEvent: { stopImmediatePropagation },
    });

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(stopPropagation).toHaveBeenCalledOnce();
    expect(stopImmediatePropagation).toHaveBeenCalledOnce();
  });

  it('expands only a committed loaded directory in the active repository', () => {
    expect(resolvePendingTreeExpandDecision({
      pendingRepositoryId: '3',
      selectedRepositoryId: '3',
      nodeExists: true,
      nodeType: 'dir',
      nodeLoaded: true,
    })).toBe('expand');

    expect(resolvePendingTreeExpandDecision({
      pendingRepositoryId: '3',
      selectedRepositoryId: '3',
      nodeExists: true,
      nodeType: 'dir',
      nodeLoaded: false,
    })).toBe('wait');
  });

  it('cancels stale repository requests and removed nodes', () => {
    expect(resolvePendingTreeExpandDecision({
      pendingRepositoryId: '3',
      selectedRepositoryId: '4',
      nodeExists: true,
      nodeType: 'dir',
      nodeLoaded: true,
    })).toBe('cancel');

    expect(resolvePendingTreeExpandDecision({
      pendingRepositoryId: '3',
      selectedRepositoryId: '3',
      nodeExists: false,
    })).toBe('cancel');
  });
});
