import { registerAuthSessionRuntime } from '@/service/auth-session-release';
import { pluginCommandApi } from '@/service/plugins/plugin-command.api';
import { resolveAgentFileAuthority } from '@/features/agent/services/agent-file-authority';
import { notifyLibraryNodesMutated } from '@/features/file-explorer/services/node-mutation-events';
import { commandCommittedMutation } from './command-projection';

let stop: (() => void) | undefined;
const revisions = new Map<string, number>();
/** The authority responder survives switching tools while a command is running. */
export function startPluginCommandRuntime() {
  if (stop || !pluginCommandApi.available()) return;
  const stopAuthority = pluginCommandApi.onFileAuthorityRequest(request => {
    if (!pluginCommandApi.isActiveScope(request)) return;
    const association = {
      authorityId: request.authorityId, libraryId: request.libraryId, ownerScope: request.ownerScope,
      runId: request.runId, sessionId: request.sessionId, toolRunId: request.toolRunId, version: 1 as const,
    };
    void resolveAgentFileAuthority(request).then(result => {
      if (!pluginCommandApi.isActiveScope(request)) return;
      return pluginCommandApi.completeFileAuthority({ ...association, result });
    }, error => {
      if (!pluginCommandApi.isActiveScope(request)) return;
      return pluginCommandApi.completeFileAuthority({ ...association, error: error instanceof Error ? error.message.slice(0, 500) : '文件授权失败' });
    }).catch(() => undefined);
  });
  const stopExecutions = pluginCommandApi.subscribe(execution => {
    // A dispatched write may settle after leaving its library; its cache still needs invalidation.
    if (!pluginCommandApi.isCurrentScope(execution) || (revisions.get(execution.id) ?? -1) >= execution.revision) return;
    revisions.set(execution.id, execution.revision);
    if (revisions.size > 256) revisions.delete(revisions.keys().next().value!);
    const mutation = commandCommittedMutation(execution);
    if (!mutation) return;
    if (mutation.renamed.length) for (const item of mutation.renamed) {
      notifyLibraryNodesMutated({ ...execution.ownerScope, libraryId: execution.libraryId, ...item, type: 'file', affectedParentIds: [item.parentId] });
    } else notifyLibraryNodesMutated({ ...execution.ownerScope, libraryId: execution.libraryId, affectedParentIds: mutation.parentIds });
  });
  stop = () => { stopAuthority(); stopExecutions(); revisions.clear(); };
}
const unregister = registerAuthSessionRuntime({ start: startPluginCommandRuntime, dispose: () => { stop?.(); stop = undefined; } });
if (import.meta.hot) import.meta.hot.dispose(() => { stop?.(); stop = undefined; unregister(); });
