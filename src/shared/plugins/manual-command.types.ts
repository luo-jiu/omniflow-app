import type {
  AgentFileAuthorityCompletionV1, AgentFileAuthorityRequestV1, AgentOwnerScope,
  AgentPluginToolSource, AgentPreparedActionPublic, AgentActionPreview, AgentToolResult,
} from '../agent/agent.types';

export interface PluginCommandScope { ownerScope: AgentOwnerScope; libraryId: number }
export interface PluginCommandPrepareRequest extends PluginCommandScope {
  pluginId: string;
  commandId: string;
  nodeIds: number[];
  parameters: Record<string, unknown>;
  destination?: { parentId: number; fileName: string };
}
export interface PluginCommandExecutionRequest extends PluginCommandScope {
  executionId: string;
  expectedRevision: number;
}
export interface PluginCommandReconcileRequest extends PluginCommandExecutionRequest {
  credentials: { token: string; username: string };
}
export type PluginCommandStatus = 'preparing' | 'awaiting-approval' | 'executing' | 'completed' | 'failed' | 'cancelled' | 'interrupted' | 'commit-unknown';
export interface PluginCommandExecution extends PluginCommandScope {
  id: string;
  revision: number;
  commandId: string;
  title: string;
  source: AgentPluginToolSource;
  status: PluginCommandStatus;
  createdAt: string;
  updatedAt: string;
  action?: AgentPreparedActionPublic;
  preview?: AgentActionPreview;
  result?: AgentToolResult;
  message?: string;
  approvedAt?: string;
  originalResult?: AgentToolResult;
  receiptChecks?: { checkedAt: string; state: 'committed' | 'commit_unknown' }[];
}
export interface PluginCommandsBridge {
  prepare(input: PluginCommandPrepareRequest): Promise<PluginCommandExecution>;
  approve(input: PluginCommandExecutionRequest): Promise<PluginCommandExecution>;
  cancel(input: PluginCommandExecutionRequest): Promise<PluginCommandExecution>;
  list(input: PluginCommandScope): Promise<PluginCommandExecution[]>;
  reconcile(input: PluginCommandReconcileRequest): Promise<PluginCommandExecution>;
  release(input: PluginCommandScope): Promise<void>;
  subscribe(listener: (execution: PluginCommandExecution) => void): () => void;
  onFileAuthorityRequest(listener: (request: AgentFileAuthorityRequestV1) => void): () => void;
  completeFileAuthority(input: AgentFileAuthorityCompletionV1): Promise<boolean>;
}
