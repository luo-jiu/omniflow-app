import {
  initializeAgentMemoryDatabaseSchema,
  type AgentMemoryStore,
} from './agent-memory-store';
import {
  disposeAgentMemoryStore,
  getAgentMemoryStore,
} from './agent-memory-store-runtime';
import {
  AGENT_SESSION_SCHEMA_VERSION,
  initializeAgentSessionDatabaseSchema,
  type AgentSessionStore,
} from './agent-session-store';
import {
  disposeAgentSessionStore,
  getAgentSessionDatabasePath,
  getAgentSessionStore,
} from './agent-session-store-runtime';
import {
  disposeAgentShellStorageRuntime,
  getAgentShellStorageRuntime,
  type AgentShellStorageRuntime,
} from './shell/agent-shell-storage-runtime';
import { initializeAgentShellWorkspaceDatabaseSchema } from './shell/agent-shell-workspace-sqlite';
import { agentDatabaseSchemaCoordinator } from './storage/agent-database-schema-coordinator';
import { initializeAgentLocalStorageQuotaDatabaseSchema } from './storage/agent-local-storage-quota-sqlite';

const REQUIRED_AGENT_DATABASE_TABLES = [
  'agent_context_checkpoints',
  'agent_local_storage_resources',
  'agent_memories',
  'agent_messages',
  'agent_runs',
  'agent_sessions',
  'agent_shell_workspaces',
  'agent_tool_runs',
] as const;

const REQUIRED_AGENT_DATABASE_COLUMNS = {
  agent_context_checkpoints: [
    'id',
    'session_id',
    'base_checkpoint_id',
    'through_message_id',
    'through_sequence',
    'status',
    'summary_json',
    'profile_id',
    'model',
    'created_at',
    'finished_at',
  ],
  agent_local_storage_resources: [
    'id',
    'backend_scope',
    'account_scope',
    'adapter_id',
    'resource_ref',
    'category',
    'run_id',
    'expected_bytes',
    'actual_bytes',
    'state',
    'created_at',
    'last_touched_at',
    'expires_at',
    'last_error_code',
  ],
  agent_memories: [
    'id',
    'backend_scope',
    'account_scope',
    'library_id',
    'kind',
    'title',
    'content',
    'reason',
    'application',
    'source_session_id',
    'source_run_id',
    'revision',
    'created_at',
    'updated_at',
  ],
  agent_messages: [
    'id',
    'session_id',
    'run_id',
    'sequence',
    'role',
    'content',
    'tool_call_id',
    'tool_name',
    'created_at',
  ],
  agent_runs: [
    'id',
    'session_id',
    'capability_identity',
    'status',
    'user_prompt',
    'profile_id',
    'model',
    'reasoning_effort',
    'current_step',
    'error',
    'plan_json',
    'revision',
    'skill_catalog_revision',
    'tool_catalog_revision',
    'created_at',
    'updated_at',
    'finished_at',
  ],
  agent_sessions: [
    'id',
    'backend_scope',
    'account_scope',
    'library_id',
    'title',
    'context_json',
    'last_message_preview',
    'archived_at',
    'created_at',
    'updated_at',
  ],
  agent_shell_workspaces: [
    'workspace_id',
    'backend_scope',
    'account_scope',
    'session_id',
    'run_id',
    'quota_resource_ref',
    'generation',
    'status',
    'manifest_json',
    'created_at',
    'updated_at',
  ],
  agent_tool_runs: [
    'id',
    'run_id',
    'call_id',
    'tool_name',
    'tool_kind',
    'input_json',
    'result_json',
    'status',
    'permission_behavior',
    'approval_id',
    'approval_input_hash',
    'approval_preview_json',
    'approval_status',
    'approval_decided_at',
    'progress_json',
    'progress_updated_at',
    'prepared_action_id',
    'prepared_action_json',
    'prepared_snapshot_hash',
    'interaction_id',
    'interaction_request_json',
    'interaction_status',
    'interaction_response_json',
    'interaction_decided_at',
    'ordinal',
    'plan_step_id',
    'revision',
    'created_at',
    'finished_at',
  ],
} as const;

const REQUIRED_AGENT_DATABASE_INDEXES = [
  'agent_context_checkpoints_one_started_idx',
  'agent_context_checkpoints_session_completed_idx',
  'agent_local_storage_resources_expiry_idx',
  'agent_local_storage_resources_owner_idx',
  'agent_memories_owner_scope_updated_idx',
  'agent_messages_session_sequence_idx',
  'agent_runs_session_created_idx',
  'agent_sessions_owner_library_updated_idx',
  'agent_shell_workspaces_owner_idx',
  'agent_tool_runs_approval_idx',
  'agent_tool_runs_interaction_idx',
  'agent_tool_runs_run_ordinal_idx',
  'agent_tool_runs_run_plan_step_idx',
] as const;

const REQUIRED_AGENT_DATABASE_TRIGGERS = [
  'agent_context_checkpoints_delete_only_with_session',
  'agent_context_checkpoints_validate_insert',
  'agent_context_checkpoints_validate_transition',
  'agent_memories_accessible_limit_before_insert',
  'agent_messages_update_session',
  'agent_runs_block_completed_with_open_tools',
  'agent_runs_create_user_message',
  'agent_runs_delete_only_with_session',
  'agent_runs_finalize_open_tools',
  'agent_runs_plan_must_start_empty',
  'agent_runs_reject_replace',
  'agent_runs_set_plan_once_before_tools',
  'agent_runs_validate_plan_on_update',
  'agent_tool_runs_delete_only_with_run',
  'agent_tool_runs_plan_step_is_immutable',
  'agent_tool_runs_reject_replace',
  'agent_tool_runs_require_active_run_on_insert',
  'agent_tool_runs_require_active_run_on_reactivation',
  'agent_tool_runs_require_next_ordinal_on_insert',
  'agent_tool_runs_validate_kind_on_insert',
  'agent_tool_runs_validate_plan_step_on_insert',
  'agent_tool_runs_validate_preparation_insert',
  'agent_tool_runs_validate_preparation_update',
] as const;

export async function bootstrapAgentPersistenceDatabase(
  databasePath: string,
): Promise<void> {
  await agentDatabaseSchemaCoordinator.bootstrap(databasePath, {
    initialize: async (database) => {
      await initializeAgentSessionDatabaseSchema(database, { manageTransactions: false });
      await initializeAgentMemoryDatabaseSchema(database);
      await initializeAgentLocalStorageQuotaDatabaseSchema(database);
      await initializeAgentShellWorkspaceDatabaseSchema(database);
    },
    requiredColumns: REQUIRED_AGENT_DATABASE_COLUMNS,
    requiredIndexes: REQUIRED_AGENT_DATABASE_INDEXES,
    requiredTables: REQUIRED_AGENT_DATABASE_TABLES,
    requiredTriggers: REQUIRED_AGENT_DATABASE_TRIGGERS,
    userVersion: AGENT_SESSION_SCHEMA_VERSION,
  });
}

export interface AgentPersistenceRuntime {
  memoryStore: AgentMemoryStore;
  sessionStore: AgentSessionStore;
  shellStorage: AgentShellStorageRuntime;
}

interface AgentPersistenceRuntimeManagerOptions {
  bootstrap: () => Promise<void>;
  disposeMemoryStore: () => Promise<void>;
  disposeSessionStore: () => Promise<void>;
  disposeShellStorage: () => Promise<void>;
  getMemoryStore: () => Promise<AgentMemoryStore>;
  getSessionStore: () => Promise<AgentSessionStore>;
  getShellStorage: () => Promise<AgentShellStorageRuntime>;
}

export function createAgentPersistenceRuntimeManager(
  options: AgentPersistenceRuntimeManagerOptions,
) {
  let runtimePromise: Promise<AgentPersistenceRuntime> | null = null;

  async function disposeStores(): Promise<void> {
    const errors: unknown[] = [];
    for (const dispose of [
      options.disposeShellStorage,
      options.disposeMemoryStore,
      options.disposeSessionStore,
    ]) {
      try {
        await dispose();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length > 0) {
      const error = new Error('Agent 持久化资源关闭失败');
      Object.assign(error, { causes: errors });
      throw error;
    }
  }

  function get(): Promise<AgentPersistenceRuntime> {
    if (!runtimePromise) {
      runtimePromise = (async () => {
        await options.bootstrap();
        const sessionStore = await options.getSessionStore();
        const memoryStore = await options.getMemoryStore();
        const shellStorage = await options.getShellStorage();
        return { memoryStore, sessionStore, shellStorage };
      })().catch(async (error) => {
        runtimePromise = null;
        await disposeStores().catch(() => undefined);
        throw error;
      });
    }
    return runtimePromise;
  }

  async function dispose(): Promise<void> {
    const current = runtimePromise;
    runtimePromise = null;
    if (!current) return;
    try {
      await current;
    } catch {
      return;
    }
    await disposeStores();
  }

  return { dispose, get };
}

const agentPersistenceRuntimeManager = createAgentPersistenceRuntimeManager({
  bootstrap: () => bootstrapAgentPersistenceDatabase(getAgentSessionDatabasePath()),
  disposeMemoryStore: disposeAgentMemoryStore,
  disposeSessionStore: disposeAgentSessionStore,
  disposeShellStorage: disposeAgentShellStorageRuntime,
  getMemoryStore: getAgentMemoryStore,
  getSessionStore: getAgentSessionStore,
  getShellStorage: getAgentShellStorageRuntime,
});

export const getAgentPersistenceRuntime = agentPersistenceRuntimeManager.get;
export const disposeAgentPersistenceRuntime = agentPersistenceRuntimeManager.dispose;
