import { describe, expect, it } from 'vitest';
import {
  buildViewerHotRetentionCandidates,
  planViewerHotRetention,
  prepareViewerHotEvictions,
  resolveDefaultViewerHotProfile,
  VIEWER_HOT_RETENTION_ENFORCEMENT_ENABLED,
  type ViewerHotRetentionCandidate,
} from './hot-viewer-retention';

function candidate(
  tabId: string,
  options: Partial<ViewerHotRetentionCandidate> = {},
): ViewerHotRetentionCandidate {
  return {
    tabId,
    costUnits: 1,
    evictable: true,
    lastAccessOrder: 0,
    pinReasons: [],
    ...options,
  };
}

describe('planViewerHotRetention', () => {
  it('keeps the stable render order when the current set is within budget', () => {
    const plan = planViewerHotRetention([
      candidate('tab-a', { lastAccessOrder: 30 }),
      candidate('tab-b', { lastAccessOrder: 10 }),
      candidate('tab-c', { lastAccessOrder: 20 }),
    ], {
      maxCostUnits: 3,
      maxMountedCount: 3,
    });

    expect(plan.retainedTabIds).toEqual(['tab-a', 'tab-b', 'tab-c']);
    expect(plan.evictions).toEqual([]);
    expect(plan.overBudget).toBe(false);
  });

  it('evicts least-recently-used unpinned tabs without reordering survivors', () => {
    const plan = planViewerHotRetention([
      candidate('tab-active', { costUnits: 4, lastAccessOrder: 40, pinReasons: ['active'] }),
      candidate('tab-oldest', { costUnits: 2, lastAccessOrder: 10 }),
      candidate('tab-newest', { costUnits: 2, lastAccessOrder: 30 }),
      candidate('tab-middle', { costUnits: 2, lastAccessOrder: 20 }),
    ], {
      maxCostUnits: 8,
      maxMountedCount: 3,
    });

    expect(plan.evictions).toEqual([{
      tabId: 'tab-oldest',
      reasons: ['count-budget', 'cost-budget'],
    }]);
    expect(plan.retainedTabIds).toEqual(['tab-active', 'tab-newest', 'tab-middle']);
    expect(plan.protectedTabIds).toEqual(['tab-active']);
    expect(plan.retainedCostUnits).toBe(8);
  });

  it('never evicts pinned or non-restorable viewers and reports unresolved pressure', () => {
    const plan = planViewerHotRetention([
      candidate('tab-active', { costUnits: 4, pinReasons: ['active'] }),
      candidate('tab-dirty', { costUnits: 4, pinReasons: ['dirty'] }),
      candidate('tab-audio', { costUnits: 2, evictable: false }),
      candidate('tab-free', { costUnits: 1, lastAccessOrder: 1 }),
    ], {
      maxCostUnits: 4,
      maxMountedCount: 2,
    });

    expect(plan.evictions.map(item => item.tabId)).toEqual(['tab-free']);
    expect(plan.retainedTabIds).toEqual(['tab-active', 'tab-dirty', 'tab-audio']);
    expect(plan.protectedTabIds).toEqual(['tab-active', 'tab-dirty', 'tab-audio']);
    expect(plan.overBudget).toBe(true);
    expect(plan.pressure).toBe('count-and-cost');
  });

  it('supports zero budgets without evicting protected tabs', () => {
    const plan = planViewerHotRetention([
      candidate('tab-free', { costUnits: 2, lastAccessOrder: 1 }),
      candidate('tab-pinned', { costUnits: 1, pinReasons: ['playing'] }),
    ], {
      maxCostUnits: 0,
      maxMountedCount: 0,
    });

    expect(plan.evictions).toEqual([{
      tabId: 'tab-free',
      reasons: ['count-budget', 'cost-budget'],
    }]);
    expect(plan.retainedTabIds).toEqual(['tab-pinned']);
    expect(plan.pressure).toBe('count-and-cost');
  });

  it('keeps LRU ties stable and records only the budget that caused each eviction', () => {
    const countPlan = planViewerHotRetention([
      candidate('tab-a', { lastAccessOrder: 1 }),
      candidate('tab-b', { lastAccessOrder: 1 }),
      candidate('tab-c', { lastAccessOrder: 2 }),
    ], {
      maxCostUnits: 10,
      maxMountedCount: 1,
    });
    const costPlan = planViewerHotRetention([
      candidate('tab-a', { costUnits: 2, lastAccessOrder: 1 }),
      candidate('tab-b', { costUnits: 2, lastAccessOrder: 2 }),
    ], {
      maxCostUnits: 2,
      maxMountedCount: 10,
    });

    expect(countPlan.evictions).toEqual([
      { tabId: 'tab-a', reasons: ['count-budget'] },
      { tabId: 'tab-b', reasons: ['count-budget'] },
    ]);
    expect(countPlan.retainedTabIds).toEqual(['tab-c']);
    expect(costPlan.evictions).toEqual([
      { tabId: 'tab-a', reasons: ['cost-budget'] },
    ]);
  });

  it('uses session policy classes as provisional costs and protects warm-none viewers', () => {
    expect(resolveDefaultViewerHotProfile('other')).toEqual({ costUnits: 1, evictable: false });
    expect(resolveDefaultViewerHotProfile('audio')).toEqual({ costUnits: 2, evictable: false });
    expect(resolveDefaultViewerHotProfile('text')).toEqual({ costUnits: 2, evictable: true });
    expect(resolveDefaultViewerHotProfile('comic')).toEqual({ costUnits: 4, evictable: true });
  });

  it('rejects malformed or duplicate candidates instead of producing unstable decisions', () => {
    expect(() => planViewerHotRetention([
      candidate('same'),
      candidate('same'),
    ], { maxCostUnits: 4, maxMountedCount: 4 })).toThrow('tabId must be unique');
    expect(() => planViewerHotRetention([
      candidate('tab-a', { costUnits: Number.NaN }),
    ], { maxCostUnits: 4, maxMountedCount: 4 })).toThrow('costUnits');
    expect(() => planViewerHotRetention([
      candidate('tab-a', { lastAccessOrder: Number.POSITIVE_INFINITY }),
    ], { maxCostUnits: 4, maxMountedCount: 4 })).toThrow('lastAccessOrder');
    expect(() => planViewerHotRetention([], {
      maxCostUnits: -1,
      maxMountedCount: 4,
    })).toThrow('maxCostUnits');
  });
});

describe('buildViewerHotRetentionCandidates', () => {
  it('merges stable tab facts with live pins and always protects the active tab', () => {
    const candidates = buildViewerHotRetentionCandidates([
      {
        active: true,
        lastAccessOrder: 3,
        libraryId: 1,
        tabId: 'tab-text',
        viewerKind: 'text',
      },
      {
        active: false,
        lastAccessOrder: 2,
        libraryId: 1,
        tabId: 'tab-video',
        viewerKind: 'video',
      },
    ], [
      {
        libraryId: 1,
        tabId: 'tab-text',
        viewerKind: 'text',
        hotCostUnits: null,
        pinReasons: ['dirty'],
        pinProjectionReliable: true,
      },
      {
        libraryId: 1,
        tabId: 'tab-video',
        viewerKind: 'video',
        hotCostUnits: 6,
        pinReasons: ['playing'],
        pinProjectionReliable: true,
      },
    ]);

    expect(candidates).toEqual([
      candidate('tab-text', {
        costUnits: 2,
        lastAccessOrder: 3,
        pinReasons: ['dirty', 'active'],
      }),
      candidate('tab-video', {
        costUnits: 6,
        lastAccessOrder: 2,
        pinReasons: ['playing'],
      }),
    ]);
  });

  it('protects warm-capable tabs until a reliable matching live adapter is available', () => {
    const candidates = buildViewerHotRetentionCandidates([
      {
        active: false,
        lastAccessOrder: null,
        libraryId: 1,
        tabId: 'tab-pdf',
        viewerKind: 'pdf',
      },
      {
        active: false,
        lastAccessOrder: 1,
        libraryId: 1,
        tabId: 'tab-audio',
        viewerKind: 'audio',
      },
    ], [{
      libraryId: 1,
      tabId: 'tab-pdf',
      viewerKind: 'pdf',
      hotCostUnits: null,
      pinReasons: [],
      pinProjectionReliable: false,
    }]);

    expect(candidates).toEqual([
      candidate('tab-pdf', {
        costUnits: 4,
        evictable: false,
        lastAccessOrder: 0,
      }),
      candidate('tab-audio', {
        costUnits: 2,
        evictable: false,
        lastAccessOrder: 1,
      }),
    ]);
    expect(VIEWER_HOT_RETENTION_ENFORCEMENT_ENABLED).toBe(true);
  });

  it('normalizes projected Hot costs and falls back to the policy on invalid values', () => {
    const tabs = [
      { active: false, lastAccessOrder: 1, libraryId: 1, tabId: 'tab-dynamic', viewerKind: 'comic' as const },
      { active: false, lastAccessOrder: 2, libraryId: 1, tabId: 'tab-capped', viewerKind: 'comic' as const },
      { active: false, lastAccessOrder: 3, libraryId: 1, tabId: 'tab-invalid', viewerKind: 'comic' as const },
    ];
    const live = [
      { ...tabs[0], hotCostUnits: 5.2, pinReasons: [], pinProjectionReliable: true },
      { ...tabs[1], hotCostUnits: 100, pinReasons: [], pinProjectionReliable: true },
      { ...tabs[2], hotCostUnits: Number.NaN, pinReasons: [], pinProjectionReliable: true },
    ];

    expect(buildViewerHotRetentionCandidates(tabs, live)).toEqual([
      candidate('tab-dynamic', { costUnits: 6, lastAccessOrder: 1 }),
      candidate('tab-capped', { costUnits: 8, lastAccessOrder: 2 }),
      candidate('tab-invalid', { costUnits: 4, lastAccessOrder: 3 }),
    ]);
  });
});

describe('prepareViewerHotEvictions', () => {
  it('commits only tabs whose synchronous preparation captured a restorable snapshot', () => {
    const prepareCalls: string[] = [];
    const result = prepareViewerHotEvictions(
      [
        { tabId: 'tab-a', reasons: ['count-budget'] },
        { tabId: 'tab-b', reasons: ['cost-budget'] },
        { tabId: 'tab-invalid', reasons: ['count-budget'] },
      ],
      [
        {
          active: false,
          lastAccessOrder: 1,
          libraryId: 1,
          tabId: 'tab-a',
          viewerKind: 'pdf',
        },
        {
          active: false,
          lastAccessOrder: 2,
          libraryId: 1,
          tabId: 'tab-b',
          viewerKind: 'text',
        },
        {
          active: false,
          lastAccessOrder: 3,
          libraryId: null,
          tabId: 'tab-invalid',
          viewerKind: 'pdf',
        },
      ],
      (target) => {
        prepareCalls.push(target.tabId);
        return target.tabId === 'tab-a'
          ? { status: 'captured' }
          : { status: 'blocked', reason: 'pinned', pinReasons: ['dirty'] };
      },
      () => true,
    );

    expect(prepareCalls).toEqual(['tab-a', 'tab-b']);
    expect(result).toEqual({
      evictedTabIds: ['tab-a'],
      blocked: [
        { tabId: 'tab-b', reason: 'pinned' },
        { tabId: 'tab-invalid', reason: 'invalid-target' },
      ],
    });
  });

  it('fails closed when the preparation boundary throws', () => {
    const result = prepareViewerHotEvictions(
      [{ tabId: 'tab-a', reasons: ['count-budget'] }],
      [{
        active: false,
        lastAccessOrder: 1,
        libraryId: 1,
        tabId: 'tab-a',
        viewerKind: 'pdf',
      }],
      () => {
        throw new Error('unexpected adapter failure');
      },
      () => true,
    );

    expect(result).toEqual({
      evictedTabIds: [],
      blocked: [{ tabId: 'tab-a', reason: 'preparation-failed' }],
    });
  });

  it('revalidates the whole captured batch before committing unmounts', () => {
    const tabs = ['tab-a', 'tab-b'].map((tabId, index) => ({
      active: false,
      lastAccessOrder: index + 1,
      libraryId: 1,
      tabId,
      viewerKind: 'pdf' as const,
    }));
    const result = prepareViewerHotEvictions([
      { tabId: 'tab-a', reasons: ['count-budget'] },
      { tabId: 'tab-b', reasons: ['count-budget'] },
    ], tabs, () => ({ status: 'captured' }), target => target.tabId === 'tab-b');

    expect(result).toEqual({
      evictedTabIds: ['tab-b'],
      blocked: [{ tabId: 'tab-a', reason: 'snapshot-not-retained' }],
    });
  });
});
