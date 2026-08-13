import type { FileViewerFileType } from '@/shared/file-viewer-types';
import { viewerSessionPolicies } from './viewer-session-policies';
import type {
  ViewerHotEvictionBlockReason,
  ViewerHotEvictionPreparationResult,
  ViewerHotEvictionPreparationTarget,
  ViewerLiveRetentionProjection,
  ViewerSessionPinReason,
} from './viewer-session.types';

export type ViewerHotCostClass = 'light' | 'medium' | 'heavy';
export type ViewerHotBudgetPressure = 'none' | 'count' | 'cost' | 'count-and-cost';
export type ViewerHotEvictionReason = 'count-budget' | 'cost-budget';

export interface ViewerHotRetentionCandidate {
  tabId: string;
  costUnits: number;
  evictable: boolean;
  lastAccessOrder: number;
  pinReasons: ViewerSessionPinReason[];
}

export interface ViewerHotRetentionTabProjection {
  active: boolean;
  lastAccessOrder: number | null;
  libraryId: number | null;
  tabId: string;
  viewerKind: FileViewerFileType | null;
}

export interface ViewerHotRetentionBudget {
  maxCostUnits: number;
  maxMountedCount: number;
}

export interface ViewerHotEvictionDecision {
  tabId: string;
  reasons: ViewerHotEvictionReason[];
}

export interface ViewerHotRetentionPlan {
  evictions: ViewerHotEvictionDecision[];
  initialCostUnits: number;
  initialMountedCount: number;
  overBudget: boolean;
  pressure: ViewerHotBudgetPressure;
  protectedTabIds: string[];
  retainedCostUnits: number;
  retainedTabIds: string[];
}

export type ViewerHotEvictionCommitBlockReason =
  | ViewerHotEvictionBlockReason
  | 'invalid-target'
  | 'preparation-failed';

export interface ViewerHotEvictionCommitResult {
  blocked: Array<{ tabId: string; reason: ViewerHotEvictionCommitBlockReason }>;
  evictedTabIds: string[];
}

export const VIEWER_HOT_COST_UNITS: Record<ViewerHotCostClass, number> = {
  light: 1,
  medium: 2,
  heavy: 4,
};

export const MAX_VIEWER_HOT_COST_UNITS_PER_INSTANCE = 8;

export const DEFAULT_VIEWER_HOT_RETENTION_BUDGET: ViewerHotRetentionBudget = {
  maxCostUnits: 16,
  maxMountedCount: 8,
};

// Fast-core rollout: conservative budget with policy fallback; performance tuning remains follow-up work.
export const VIEWER_HOT_RETENTION_ENFORCEMENT_ENABLED = true;

function normalizeNonNegativeInteger(value: number, field: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new TypeError(`${field} must be a non-negative finite number`);
  }
  return Math.floor(value);
}

function normalizePositiveCost(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new TypeError('candidate costUnits must be a positive finite number');
  }
  return Math.max(Math.ceil(value), 1);
}

function resolveProjectedHotCostUnits(value: number | null | undefined, fallback: number): number {
  if (!Number.isFinite(value) || Number(value) <= 0) return fallback;
  return Math.min(
    Math.max(Math.ceil(Number(value)), 1),
    MAX_VIEWER_HOT_COST_UNITS_PER_INSTANCE,
  );
}

function resolveBudgetPressure(
  mountedCount: number,
  costUnits: number,
  budget: ViewerHotRetentionBudget,
): ViewerHotBudgetPressure {
  const overCount = mountedCount > budget.maxMountedCount;
  const overCost = costUnits > budget.maxCostUnits;
  if (overCount && overCost) return 'count-and-cost';
  if (overCount) return 'count';
  if (overCost) return 'cost';
  return 'none';
}

export function resolveDefaultViewerHotProfile(viewerKind: FileViewerFileType): {
  costUnits: number;
  evictable: boolean;
} {
  const policy = viewerSessionPolicies[viewerKind];
  return {
    costUnits: VIEWER_HOT_COST_UNITS[policy.defaultHotCost],
    evictable: policy.warm === 'memory',
  };
}

export function buildViewerHotRetentionCandidates(
  tabs: ViewerHotRetentionTabProjection[],
  liveProjections: ViewerLiveRetentionProjection[],
): ViewerHotRetentionCandidate[] {
  const liveBySlot = new Map(liveProjections.map((projection) => [
    JSON.stringify([projection.libraryId, projection.tabId, projection.viewerKind]),
    projection,
  ]));

  return tabs.map((tab) => {
    const profile = tab.viewerKind
      ? resolveDefaultViewerHotProfile(tab.viewerKind)
      : { costUnits: VIEWER_HOT_COST_UNITS.light, evictable: false };
    const liveProjection = tab.libraryId != null && tab.viewerKind
      ? liveBySlot.get(JSON.stringify([tab.libraryId, tab.tabId, tab.viewerKind]))
      : undefined;
    const pinReasons = new Set<ViewerSessionPinReason>(liveProjection?.pinReasons ?? []);
    if (tab.active) pinReasons.add('active');
    const hasReliableLiveProjection = liveProjection?.pinProjectionReliable === true;

    return {
      tabId: tab.tabId,
      costUnits: resolveProjectedHotCostUnits(liveProjection?.hotCostUnits, profile.costUnits),
      evictable: profile.evictable && hasReliableLiveProjection,
      lastAccessOrder: tab.lastAccessOrder ?? 0,
      pinReasons: Array.from(pinReasons),
    };
  });
}

export function planViewerHotRetention(
  candidates: ViewerHotRetentionCandidate[],
  inputBudget: ViewerHotRetentionBudget,
): ViewerHotRetentionPlan {
  const budget: ViewerHotRetentionBudget = {
    maxCostUnits: normalizeNonNegativeInteger(inputBudget.maxCostUnits, 'maxCostUnits'),
    maxMountedCount: normalizeNonNegativeInteger(inputBudget.maxMountedCount, 'maxMountedCount'),
  };
  const seenTabIds = new Set<string>();
  const normalizedCandidates = candidates.map((candidate, index) => {
    const tabId = String(candidate.tabId || '');
    if (!tabId.trim()) throw new TypeError('candidate tabId must not be empty');
    if (seenTabIds.has(tabId)) throw new TypeError('candidate tabId must be unique');
    seenTabIds.add(tabId);
    if (!Number.isFinite(candidate.lastAccessOrder)) {
      throw new TypeError('candidate lastAccessOrder must be a finite number');
    }
    return {
      ...candidate,
      tabId,
      costUnits: normalizePositiveCost(candidate.costUnits),
      originalIndex: index,
      pinReasons: Array.from(new Set(candidate.pinReasons)),
    };
  });

  const retained = new Set(normalizedCandidates.map(candidate => candidate.tabId));
  const protectedTabIds = normalizedCandidates
    .filter(candidate => !candidate.evictable || candidate.pinReasons.length > 0)
    .map(candidate => candidate.tabId);
  const initialCostUnits = normalizedCandidates.reduce(
    (total, candidate) => total + candidate.costUnits,
    0,
  );
  let retainedCostUnits = initialCostUnits;
  let retainedMountedCount = normalizedCandidates.length;
  const evictions: ViewerHotEvictionDecision[] = [];
  const evictionCandidates = normalizedCandidates
    .filter(candidate => candidate.evictable && candidate.pinReasons.length === 0)
    .sort((left, right) => (
      left.lastAccessOrder - right.lastAccessOrder
      || left.originalIndex - right.originalIndex
    ));

  for (const candidate of evictionCandidates) {
    const pressure = resolveBudgetPressure(retainedMountedCount, retainedCostUnits, budget);
    if (pressure === 'none') break;
    const reasons: ViewerHotEvictionReason[] = [];
    if (pressure === 'count' || pressure === 'count-and-cost') reasons.push('count-budget');
    if (pressure === 'cost' || pressure === 'count-and-cost') reasons.push('cost-budget');
    retained.delete(candidate.tabId);
    retainedMountedCount -= 1;
    retainedCostUnits -= candidate.costUnits;
    evictions.push({ tabId: candidate.tabId, reasons });
  }

  const pressure = resolveBudgetPressure(retainedMountedCount, retainedCostUnits, budget);
  return {
    evictions,
    initialCostUnits,
    initialMountedCount: normalizedCandidates.length,
    overBudget: pressure !== 'none',
    pressure,
    protectedTabIds,
    retainedCostUnits,
    retainedTabIds: normalizedCandidates
      .filter(candidate => retained.has(candidate.tabId))
      .map(candidate => candidate.tabId),
  };
}

export function prepareViewerHotEvictions(
  evictions: ViewerHotEvictionDecision[],
  tabs: ViewerHotRetentionTabProjection[],
  prepare: (
    target: ViewerHotEvictionPreparationTarget,
  ) => ViewerHotEvictionPreparationResult,
  verify: (target: ViewerHotEvictionPreparationTarget) => boolean,
): ViewerHotEvictionCommitResult {
  const tabsById = new Map(tabs.map(tab => [tab.tabId, tab]));
  const blocked: ViewerHotEvictionCommitResult['blocked'] = [];
  const capturedTargets: ViewerHotEvictionPreparationTarget[] = [];

  evictions.forEach(({ tabId }) => {
    const tab = tabsById.get(tabId);
    if (tab?.libraryId == null || tab.viewerKind == null) {
      blocked.push({ tabId, reason: 'invalid-target' });
      return;
    }
    let result: ViewerHotEvictionPreparationResult;
    try {
      result = prepare({
        libraryId: tab.libraryId,
        tabId,
        viewerKind: tab.viewerKind,
      });
    } catch {
      blocked.push({ tabId, reason: 'preparation-failed' });
      return;
    }
    if (result.status === 'captured') {
      capturedTargets.push({
        libraryId: tab.libraryId,
        tabId,
        viewerKind: tab.viewerKind,
      });
      return;
    }
    blocked.push({ tabId, reason: result.reason });
  });

  const evictedTabIds = capturedTargets.flatMap((target) => {
    try {
      if (verify(target)) return [target.tabId];
      blocked.push({ tabId: target.tabId, reason: 'snapshot-not-retained' });
    } catch {
      blocked.push({ tabId: target.tabId, reason: 'preparation-failed' });
    }
    return [];
  });

  return { blocked, evictedTabIds };
}
