import type { AgentOwnerScope } from '@/shared/agent/agent.types';

export type AgentCapabilityScope = 'machine' | 'owner' | 'library';
export type AgentCapabilityState = 'available' | 'unavailable' | 'unknown';

export interface AgentCapabilityProbeContext {
  readonly libraryId: number;
  readonly ownerScope: AgentOwnerScope;
  readonly signal: AbortSignal;
}

export type AgentCapabilityProbeResult =
  | { readonly state: 'available' }
  | { readonly reasonCode: string; readonly state: 'unavailable' | 'unknown' };

export interface AgentCapabilityDefinition {
  readonly cacheTtlMs: number;
  readonly id: string;
  readonly probe: (
    context: AgentCapabilityProbeContext,
  ) => AgentCapabilityProbeResult | Promise<AgentCapabilityProbeResult>;
  readonly revision: string;
  readonly scope: AgentCapabilityScope;
  readonly timeoutMs: number;
}

export interface AgentCapabilitySnapshotEntry {
  readonly checkedAt: number;
  readonly definitionRevision: string;
  readonly id: string;
  readonly reasonCode?: string;
  /** Hash of the normalized scope identity; never contains raw account data. */
  readonly scopeIdentity: string;
  readonly state: AgentCapabilityState;
}

export interface AgentCapabilitySnapshot {
  readonly entries: readonly AgentCapabilitySnapshotEntry[];
  readonly identity: string;
  readonly registryRevision: number;
  readonly get: (capabilityId: string) => AgentCapabilitySnapshotEntry | null;
  readonly list: () => readonly AgentCapabilitySnapshotEntry[];
}

export interface AgentCapabilitySnapshotRequest {
  readonly capabilityIds: readonly string[];
  readonly libraryId: number;
  readonly ownerScope: AgentOwnerScope;
  readonly signal: AbortSignal;
}
