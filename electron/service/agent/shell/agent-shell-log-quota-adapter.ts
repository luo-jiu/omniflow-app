import type {
  AgentShellLogQuotaReservation,
  AgentShellLogResourceQuota,
} from './agent-shell-log-store';
import type { AgentShellWorkspaceOwner } from './agent-shell-workspace-store';
import type {
  AgentLocalStorageQuotaManager,
} from '../storage/agent-local-storage-quota-manager';

export const AGENT_SHELL_LOG_QUOTA_ADAPTER_ID = 'shell-log';
export const AGENT_SHELL_LOG_QUOTA_CATEGORY = 'shell-log';

export interface AgentShellLogQuotaAdapterOptions {
  readonly adapterId?: string;
  readonly category?: string;
  readonly quotaManager: Pick<
    AgentLocalStorageQuotaManager,
    | 'adjust'
    | 'bindResource'
    | 'cancelReservation'
    | 'commit'
    | 'getResource'
    | 'markDeleting'
    | 'requestRelease'
    | 'reserve'
  >;
}

type LogQuotaReserveInput = Parameters<AgentShellLogResourceQuota['reserve']>[0];
type LogQuotaAdjustInput = Parameters<AgentShellLogResourceQuota['adjust']>[0];
type LogQuotaCommitInput = Parameters<AgentShellLogResourceQuota['commit']>[0];
type LogQuotaDeleteInput = Parameters<AgentShellLogResourceQuota['markDeleting']>[0];
type LogQuotaReleaseInput = Parameters<AgentShellLogResourceQuota['release']>[0];
type LogQuotaReattachInput = NonNullable<AgentShellLogResourceQuota['reattach']>;

function assertOwner(owner: AgentShellWorkspaceOwner): AgentShellWorkspaceOwner {
  if (!owner || typeof owner !== 'object') throw new Error('Agent Shell 日志 quota owner 缺失');
  return owner;
}

function assertReservationId(value: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('Agent Shell 日志 quota reservation ID 缺失');
  }
  return value;
}

function assertResourceRef(value: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('Agent Shell 日志 quota resource ref 缺失');
  }
  return value;
}

function assertReservationBinding(
  quotaManager: Pick<AgentLocalStorageQuotaManager, 'getResource'>,
  reservationIdInput: string,
  resourceRefInput: string,
  owner: AgentShellWorkspaceOwner,
): boolean {
  const reservationId = assertReservationId(reservationIdInput);
  const resourceRef = assertResourceRef(resourceRefInput);
  const resource = quotaManager.getResource(resourceRef, owner);
  if (!resource) return false;
  if (resource.id !== reservationId) {
    throw new Error('Agent Shell 日志 quota reservation 身份不匹配');
  }
  return true;
}

/**
 * Maps the LogStore lifecycle to the shared quota ledger. Physical log
 * removal remains the manager's registered adapter responsibility.
 */
export function createAgentShellLogQuotaAdapter(
  options: AgentShellLogQuotaAdapterOptions,
): AgentShellLogResourceQuota {
  const adapterId = options.adapterId || AGENT_SHELL_LOG_QUOTA_ADAPTER_ID;
  const category = options.category || AGENT_SHELL_LOG_QUOTA_CATEGORY;
  const quotaManager = options.quotaManager;

  return Object.freeze({
    reserve: async (input: LogQuotaReserveInput): Promise<AgentShellLogQuotaReservation> => {
      const owner = assertOwner(input.owner);
      const resourceRef = assertResourceRef(input.resourceRef);
      const reservationId = await quotaManager.reserve(
        owner,
        category,
        input.runId,
        input.expectedBytes,
        input.ttlMs,
        adapterId,
      );
      try {
        await quotaManager.bindResource(reservationId, resourceRef, owner);
      } catch (error) {
        await quotaManager.cancelReservation(reservationId, owner).catch(() => undefined);
        throw error;
      }
      return Object.freeze({ reservationId, resourceRef });
    },
    reattach: async (input: Parameters<LogQuotaReattachInput>[0]) => {
      const owner = assertOwner(input.owner);
      const resourceRef = assertResourceRef(input.resourceRef);
      const resource = quotaManager.getResource(resourceRef, owner);
      if (!resource) return null;
      if (resource.adapterId !== adapterId || resource.runId !== input.runId) {
        throw new Error('Agent Shell 日志 quota resource 绑定不匹配');
      }
      if (resource.state !== 'bound' && resource.state !== 'committed') {
        throw new Error('Agent Shell 日志 quota resource 状态不可恢复');
      }
      return Object.freeze({
        accountedBytes: resource.actualBytes ?? resource.expectedBytes,
        reservationId: resource.id,
        state: resource.state,
      });
    },
    adjust: async (input: LogQuotaAdjustInput) => {
      await quotaManager.adjust(
        assertResourceRef(input.resourceRef),
        input.bytes,
        assertOwner(input.owner),
      );
    },
    commit: async (input: LogQuotaCommitInput) => {
      await quotaManager.commit(
        assertReservationId(input.reservationId),
        assertResourceRef(input.resourceRef),
        input.actualBytes,
        assertOwner(input.owner),
      );
    },
    markDeleting: async (input: LogQuotaDeleteInput) => {
      const owner = assertOwner(input.owner);
      const resourceRef = assertResourceRef(input.resourceRef);
      if (!assertReservationBinding(quotaManager, input.reservationId, resourceRef, owner)) return;
      await quotaManager.markDeleting(resourceRef, owner, input.observedBytes);
    },
    release: async (input: LogQuotaReleaseInput) => {
      const owner = assertOwner(input.owner);
      const resourceRef = assertResourceRef(input.resourceRef);
      if (!assertReservationBinding(quotaManager, input.reservationId, resourceRef, owner)) return;
      const result = await quotaManager.requestRelease(resourceRef, owner);
      if (!result.released && result.state !== 'not_found') {
        throw new Error('Agent Shell 日志 quota resource 清理未完成');
      }
    },
  });
}
