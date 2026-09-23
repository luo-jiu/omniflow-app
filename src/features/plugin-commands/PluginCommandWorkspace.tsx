import React from 'react';
import { LibraryNodePickerModal, type LibraryNodePickerSelection, type SelectedTreeNode } from '@/features/file-explorer';
import { fetchNodeDetailById } from '@/features/file-explorer/services/file.api';
import { notifyLibraryNodesMutated } from '@/features/file-explorer/services/node-mutation-events';
import { WorkspaceHeader } from '@/features/tool-workspace/styles';
import { pluginCommandApi } from '@/service/plugins/plugin-command.api';
import { pluginManagementApi } from '@/service/plugins/plugin-management.api';
import { serializeAgentOwnerScope } from '@/shared/agent/agent-owner-scope';
import { isPluginCommandAllowed } from '@/shared/plugin-management';
import type { PluginCommandExecution } from '@/shared/plugins/manual-command.types';
import { CommandExecutionCard } from './CommandExecutionCard';
import { CommandParameterForm } from './CommandParameterForm';
import { commandParameterSchema, initialCommandValue, parseCommandValue } from './command-form';
import { commandCommittedMutation, commandIsActive, mergeCommandProjection } from './command-projection';
import { startPluginCommandRuntime } from './command-runtime';
import type { PluginCommandOpenRequest } from './command-open-request';
import { CommandWorkspaceBody } from './styles';

export type { PluginCommandOpenRequest } from './command-open-request';
export interface PluginCommandWorkspaceProps {
  libraryId: number;
  rootNodeId?: number | null;
  selectedTreeNode?: SelectedTreeNode | null;
  selectedNodeIds?: number[];
  request?: PluginCommandOpenRequest | null;
  onRefreshDirectory?: (directoryId: number) => Promise<void> | void;
}
type Source = { id: number; name: string; ext?: string; parentId: number };
const fileName = (node: Source) => node.ext && !node.name.toLowerCase().endsWith(`.${node.ext.toLowerCase()}`) ? `${node.name}.${node.ext}` : node.name;

function PluginCommandWorkspaceInner({ libraryId, rootNodeId, selectedTreeNode, selectedNodeIds, request, onRefreshDirectory }: PluginCommandWorkspaceProps) {
  const catalog = React.useSyncExternalStore(pluginManagementApi.subscribe, pluginManagementApi.getSnapshot);
  const [commandId, setCommandId] = React.useState(request?.commandId ?? '');
  const [parameters, setParameters] = React.useState<unknown>({});
  const [sources, setSources] = React.useState<Source[]>([]);
  const [destination, setDestination] = React.useState<{ id: number; label: string } | null>(rootNodeId ? { id: rootNodeId, label: '/' } : null);
  const [outputName, setOutputName] = React.useState('');
  const [picker, setPicker] = React.useState<'source' | 'destination' | null>(null);
  const [executions, setExecutions] = React.useState<PluginCommandExecution[]>([]);
  const [pending, setPending] = React.useState('');
  const [loadingSources, setLoadingSources] = React.useState(false);
  const [error, setError] = React.useState('');
  const { accountScope, backendScope } = pluginCommandApi.scope(libraryId).ownerScope;
  const scope = React.useMemo(() => ({ libraryId, ownerScope: { accountScope, backendScope } }), [libraryId, accountScope, backendScope]);
  const ownerKey = serializeAgentOwnerScope(scope.ownerScope);
  const generation = React.useRef(0);
  const sourceGeneration = React.useRef(0);
  const revisions = React.useRef(new Map<string, number>());
  const draftIdentity = React.useRef('');
  const handledRequest = React.useRef<string | number | null>(null);
  const refreshRef = React.useRef(onRefreshDirectory); refreshRef.current = onRefreshDirectory;
  const commands = React.useMemo(() => (catalog?.plugins ?? []).flatMap(plugin => (plugin.commands ?? []).flatMap(command => {
    const tool = plugin.agentTools?.find(item => item.id === command.toolId);
    return tool && (command.locations.includes('tool-workspace') || command.id === request?.commandId) ? [{ plugin, command, tool }] : [];
  })), [catalog, request?.commandId]);
  const selected = commands.find(item => item.command.id === commandId) ?? (commandId ? undefined : commands[0]);
  const selectedTool = selected?.tool;
  const selectedIdentity = selected ? `${selected.command.id}:${selected.plugin.fingerprint}` : '';
  const schema = React.useMemo(() => selectedTool ? commandParameterSchema(selectedTool.inputSchema) : null, [selectedTool]);
  const approved = selected && !(catalog?.safeMode && selected.plugin.source === 'local') && !catalog?.settingsRecoveryRequired && isPluginCommandAllowed(selected.plugin, selected.command);
  const active = executions.some(execution => commandIsActive(execution.status));
  const locked = Boolean(pending) || active;
  const maxSources = selected?.tool.kind === 'rename-proposal' ? 50 : 1;

  const accept = React.useCallback((execution: PluginCommandExecution, live: boolean) => {
    if (execution.libraryId !== libraryId || serializeAgentOwnerScope(execution.ownerScope) !== ownerKey || !pluginCommandApi.isCurrentScope(execution)) return;
    if ((revisions.current.get(execution.id) ?? -1) >= execution.revision) return;
    revisions.current.set(execution.id, execution.revision);
    setExecutions(current => mergeCommandProjection(current, execution));
    if (live) {
      const mutation = commandCommittedMutation(execution);
      if (mutation) {
        const current = generation.current;
        for (const id of mutation.parentIds) void Promise.resolve().then(() => refreshRef.current?.(id)).catch(() => {
          if (generation.current === current) setError('操作已完成，但目录刷新失败；请手动刷新。');
        });
      }
    }
  }, [libraryId, ownerKey]);

  React.useEffect(() => {
    const current = ++generation.current;
    startPluginCommandRuntime(); pluginManagementApi.start();
    const stop = pluginCommandApi.subscribe(execution => { if (generation.current === current) accept(execution, true); });
    void pluginCommandApi.list(libraryId).then(items => {
      if (generation.current !== current) return;
      const parents = new Set<number>();
      for (const item of items) {
        accept(item, false);
        if (item.libraryId !== libraryId || serializeAgentOwnerScope(item.ownerScope) !== ownerKey || !pluginCommandApi.isCurrentScope(item)) continue;
        for (const id of commandCommittedMutation(item)?.parentIds ?? []) parents.add(id);
      }
      if (parents.size) {
        // Restoring history only invalidates directories; it cannot replay old names.
        notifyLibraryNodesMutated({ ...scope.ownerScope, libraryId, affectedParentIds: [...parents] });
        for (const id of parents) void Promise.resolve().then(() => refreshRef.current?.(id)).catch(() => undefined);
      }
    }).catch(cause => { if (generation.current === current) setError(cause instanceof Error ? cause.message : '读取执行记录失败'); });
    return () => { generation.current += 1; sourceGeneration.current += 1; stop(); };
  }, [accept, libraryId, ownerKey, scope]);

  React.useEffect(() => {
    if (draftIdentity.current === selectedIdentity) return;
    draftIdentity.current = selectedIdentity;
    setParameters(schema ? initialCommandValue(schema) : {});
    setOutputName('');
    setError('');
  }, [schema, selectedIdentity]);

  const chooseNodes = React.useCallback(async (nodeIds: number[], limit: number) => {
    if (!nodeIds.length || nodeIds.length > limit || new Set(nodeIds).size !== nodeIds.length) {
      setError(`请选择 ${limit === 1 ? '一个文件' : '1–50 个文件'}`); return;
    }
    const current = ++sourceGeneration.current;
    setLoadingSources(true); setError('');
    try {
      const nodes = await Promise.all(nodeIds.map(id => fetchNodeDetailById(id)));
      if (current !== sourceGeneration.current || !pluginCommandApi.isCurrentScope(scope)) return;
      if (nodes.some(node => node.libraryId !== libraryId || node.type !== 'file')) throw new Error('只能选择当前资料库中的普通文件');
      setSources(nodes.map(node => ({ id: node.id, name: node.name, ext: node.ext, parentId: node.parentId })));
      if (nodes.length === 1 && nodes[0].parentId > 0) setDestination({ id: nodes[0].parentId, label: `来源所在目录 #${nodes[0].parentId}` });
    } catch (cause) { if (current === sourceGeneration.current) setError(cause instanceof Error ? cause.message : '读取文件信息失败'); }
    finally { if (current === sourceGeneration.current) setLoadingSources(false); }
  }, [libraryId, scope]);

  React.useEffect(() => {
    if (!request || handledRequest.current === request.id) return;
    handledRequest.current = request.id;
    setCommandId(request.commandId);
    void chooseNodes(request.nodeIds, 50);
  }, [request, chooseNodes]);

  const submit = async () => {
    if (!selected || !schema || !approved || locked) return;
    const current = generation.current;
    try {
      if (!sources.length || sources.length > maxSources) throw new Error(`请选择 ${maxSources === 1 ? '一个文件' : '1–50 个文件'}`);
      const parsed = parseCommandValue(schema, parameters) as Record<string, unknown>;
      if (selected.tool.kind === 'file-output' && (!destination || !outputName.trim())) throw new Error('请选择目标目录并填写新文件名');
      setError(''); setPending('prepare');
      const execution = await pluginCommandApi.prepare({ libraryId, pluginId: selected.plugin.id, commandId: selected.command.id,
        nodeIds: sources.map(node => node.id), parameters: parsed,
        ...(selected.tool.kind === 'file-output' ? { destination: { parentId: destination!.id, fileName: outputName.trim() } } : {}),
      });
      if (current === generation.current) accept(execution, true);
    } catch (cause) { if (current === generation.current) setError(cause instanceof Error ? cause.message : '准备插件命令失败'); }
    finally { if (current === generation.current) setPending(value => value === 'prepare' ? '' : value); }
  };
  const act = async (execution: PluginCommandExecution, action: 'approve' | 'cancel' | 'reconcile') => {
    const current = generation.current;
    const pendingKey = `${action}:${execution.id}`;
    setError(''); setPending(pendingKey);
    try {
      const updated = await pluginCommandApi[action]({ libraryId, executionId: execution.id, expectedRevision: execution.revision });
      if (current === generation.current) accept(updated, true);
    } catch (cause) { if (current === generation.current) setError(cause instanceof Error ? cause.message : '操作失败'); }
    finally { if (current === generation.current) setPending(value => value === pendingKey ? '' : value); }
  };

  const confirmPicker = (selection: LibraryNodePickerSelection) => {
    if (picker === 'destination') setDestination({ id: selection.node.id, label: selection.pathLabel });
    else setSources(current => maxSources === 1 ? [selection.node]
      : current.some(node => node.id === selection.node.id) ? current : [...current, selection.node].slice(0, maxSources));
    setPicker(null);
  };
  const treeIds = selectedNodeIds?.length ? selectedNodeIds : selectedTreeNode?.type === 'file' ? [selectedTreeNode.id] : [];
  return <>
    <WorkspaceHeader><div className="header-copy"><div className="header-title">插件命令</div>
      <div className="header-desc">选择文件和参数，直接运行已安装的插件。</div></div></WorkspaceHeader>
    <CommandWorkspaceBody><div className="content">
      {error && <div role="alert" className="error">{error}</div>}
      {!commands.length ? <section className="command-panel"><h3>还没有可用的插件命令</h3><p>在设置的插件管理中安装支持手动运行的插件包，并批准相应能力。</p></section> : <section className="command-panel">
        <div className="field"><label htmlFor="plugin-command-choice">命令</label><select id="plugin-command-choice" disabled={locked} value={selected?.command.id ?? commandId}
          onChange={event => setCommandId(event.target.value)}>
          {!selected && <option value={commandId}>该命令已不可用</option>}
          {commands.map(item => <option key={item.command.id} value={item.command.id}>{item.command.title} · {item.plugin.id}</option>)}
        </select></div>
        {selected && <>
          <div className="muted">{selected.tool.description}</div>
          {!approved && <p role="status">此命令尚未获准运行，请在插件管理中启用插件并批准相应能力。</p>}
          <div className="field"><strong>来源文件（{sources.length}/{maxSources}）</strong>
            <div className="source-list">{sources.map(node => <div key={node.id} className="source-row"><span>{fileName(node)}</span>
              <button type="button" disabled={locked} onClick={() => setSources(current => current.filter(item => item.id !== node.id))}>移除</button></div>)}</div>
            <div className="actions"><button type="button" disabled={locked || loadingSources || (maxSources > 1 && sources.length >= maxSources)} onClick={() => setPicker('source')}>{maxSources > 1 ? '添加文件' : '选择文件'}</button>
              <button type="button" disabled={locked || loadingSources || !treeIds.length} onClick={() => void chooseNodes(treeIds, maxSources)}>使用目录树所选文件</button></div>
            {loadingSources && <span role="status">正在读取文件信息…</span>}
          </div>
          {schema && Object.keys(schema.properties ?? {}).length > 0 && <div className="field"><strong>处理参数</strong>
            <CommandParameterForm schema={schema} value={parameters} onChange={setParameters} disabled={locked} /></div>}
          {selected.tool.kind === 'file-output' && <div className="field"><strong>保存为新文件</strong>
            <div className="actions"><span>{destination?.label ?? '请选择目标目录'}</span><button type="button" disabled={locked} onClick={() => setPicker('destination')}>选择目录</button></div>
            <label htmlFor="plugin-command-filename">文件名（含扩展名）</label><input id="plugin-command-filename" value={outputName} maxLength={240} disabled={locked} onChange={event => setOutputName(event.target.value)} placeholder={selected.tool.output.mediaTypes.length === 1 ? '例如：处理结果.json' : '例如：处理结果.csv 或 处理结果.json'} />
          </div>}
          <p className="muted">{selected.tool.kind === 'rename-proposal' ? '准备时向插件提供所选文件的名称；完整改名清单将另行确认。' : selected.tool.kind === 'file-output' ? '准备时允许插件读取所选文件；生成的新文件将在确认后保存。' : '运行时允许插件读取所选文件，并在下方显示结果。'}</p>
          <div className="actions"><button type="button" className="primary" disabled={!approved || locked || loadingSources || !sources.length} onClick={() => void submit()}>{pending === 'prepare' ? '正在准备…' : selected.tool.kind ? '准备并预览' : '运行命令'}</button></div>
        </>}
      </section>}
      {executions.length > 0 && <h3>执行记录</h3>}
      {executions.map(execution => <CommandExecutionCard key={execution.id} execution={execution}
        busy={pending === `cancel:${execution.id}` || pending === `reconcile:${execution.id}` || (pending === `approve:${execution.id}` && execution.status === 'awaiting-approval')}
        onApprove={() => void act(execution, 'approve')} onCancel={() => void act(execution, 'cancel')} onReconcile={() => void act(execution, 'reconcile')} />)}
    </div></CommandWorkspaceBody>
    <LibraryNodePickerModal libraryId={libraryId} visible={picker !== null} displayMode={picker === 'destination' ? 'folders' : 'files'}
      title={picker === 'destination' ? '选择新文件保存目录' : '选择插件处理的文件'} onCancel={() => setPicker(null)} onConfirm={confirmPicker} />
  </>;
}

export default function PluginCommandWorkspace(props: PluginCommandWorkspaceProps) {
  if (!pluginCommandApi.available()) return <CommandWorkspaceBody>插件命令需要在桌面客户端运行。</CommandWorkspaceBody>;
  let key: string;
  try { key = `${serializeAgentOwnerScope(pluginCommandApi.scope(props.libraryId).ownerScope)}:${props.libraryId}`; }
  catch { return <CommandWorkspaceBody>请登录后运行插件命令。</CommandWorkspaceBody>; }
  return <PluginCommandWorkspaceInner key={key} {...props} />;
}
