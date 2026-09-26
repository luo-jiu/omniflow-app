import React from 'react';
import { AppearanceViewContext } from '@/features/appearance/appearance.context';
import { toPluginThemeSnapshot } from '@/features/appearance/plugin-theme';
import { LibraryNodePickerModal, type LibraryNodePickerSelection, type SelectedTreeNode } from '@/features/file-explorer';
import { fetchNodeDetailById } from '@/features/file-explorer/services/file.api';
import { CommandExecutionCard } from '@/features/plugin-commands/CommandExecutionCard';
import { commandCommittedMutation, commandIsActive, mergeCommandProjection } from '@/features/plugin-commands/command-projection';
import { startPluginCommandRuntime } from '@/features/plugin-commands/command-runtime';
import { WorkspaceHeader } from '@/features/tool-workspace/styles';
import { pluginCommandApi } from '@/service/plugins/plugin-command.api';
import { pluginManagementApi } from '@/service/plugins/plugin-management.api';
import { pluginWorkspaceApi } from '@/service/plugins/plugin-workspace.api';
import { serializeAgentOwnerScope } from '@/shared/agent/agent-owner-scope';
import { isPluginWorkspaceAllowed } from '@/shared/plugin-management';
import type { PluginCommandExecution } from '@/shared/plugins/manual-command.types';
import type { PluginWorkspaceDestination } from '@/shared/plugins/workspace.types';
import { PluginWorkspaceBody } from './styles';

export interface PluginWorkspaceProps {
  workspaceId: string;
  libraryId: number;
  rootNodeId?: number | null;
  selectedTreeNode?: SelectedTreeNode | null;
  selectedNodeIds?: number[];
  onRefreshDirectory?: (directoryId: number) => Promise<void> | void;
}
type Source = { id: number; name: string; ext?: string; parentId: number };
const sourceName = (source: Source) => source.ext && !source.name.toLowerCase().endsWith(`.${source.ext.toLowerCase()}`)
  ? `${source.name}.${source.ext}` : source.name;
const failureMessage = (code?: string) => code === 'CONTENT_CHANGED' ? '来源文件已变化，请重新打开工具。'
  : code === 'FORBIDDEN' ? '当前文件或插件能力未获准，请检查资料库权限和插件管理。'
    : code === 'DESTINATION_REQUIRED' || code === 'INVALID_DESTINATION' ? '请选择保存目录并填写有效的新文件名。'
      : '插件工具暂不可用，请重新打开。';

function PluginWorkspaceInner({ workspaceId, libraryId, rootNodeId, selectedTreeNode, selectedNodeIds, onRefreshDirectory }: PluginWorkspaceProps) {
  const catalog = React.useSyncExternalStore(pluginManagementApi.subscribe, pluginManagementApi.getSnapshot);
  const appearance = React.useContext(AppearanceViewContext);
  const initialSource = selectedTreeNode?.libraryId === libraryId && selectedTreeNode.type === 'file'
    && (!selectedNodeIds?.length || selectedNodeIds.length === 1 && selectedNodeIds[0] === selectedTreeNode.id) ? selectedTreeNode : null;
  const [source, setSource] = React.useState<Source | null>(initialSource);
  const [destination, setDestination] = React.useState<{ id: number; label: string } | null>(() => initialSource?.parentId
    ? { id: initialSource.parentId, label: `来源所在目录 #${initialSource.parentId}` } : rootNodeId ? { id: rootNodeId, label: '/' } : null);
  const [fileName, setFileName] = React.useState('');
  const [picker, setPicker] = React.useState<'source' | 'destination' | null>(null);
  const [wantsOpen, setWantsOpen] = React.useState(false);
  const [ready, setReady] = React.useState(false);
  const [retry, setRetry] = React.useState(0);
  const [loadingSource, setLoadingSource] = React.useState(false);
  const [showReview, setShowReview] = React.useState(false);
  const [preparing, setPreparing] = React.useState<string | null>(null);
  const [executions, setExecutions] = React.useState<PluginCommandExecution[]>([]);
  const [pending, setPending] = React.useState('');
  const [error, setError] = React.useState('');
  const client = React.useRef<string | null>(null);
  const container = React.useRef<HTMLDivElement>(null);
  const layout = React.useRef<() => void>(() => undefined);
  const generation = React.useRef(0);
  const sourceGeneration = React.useRef(0);
  const revisions = React.useRef(new Map<string, number>());
  const refresh = React.useRef(onRefreshDirectory); refresh.current = onRefreshDirectory;
  const { accountScope, backendScope } = pluginCommandApi.scope(libraryId).ownerScope;
  const scope = React.useMemo(() => ({ libraryId, ownerScope: { accountScope, backendScope } }), [accountScope, backendScope, libraryId]);
  const ownerKey = serializeAgentOwnerScope(scope.ownerScope);
  const plugin = catalog?.plugins.find(item => item.workspaces?.some(workspace => workspace.id === workspaceId));
  const workspace = plugin?.workspaces?.find(item => item.id === workspaceId);
  const command = plugin?.commands?.find(item => item.id === workspace?.commandId);
  const tool = plugin?.agentTools?.find(item => item.id === command?.toolId);
  const allowed = Boolean(plugin && workspace && !catalog?.settingsRecoveryRequired
    && !(catalog?.safeMode && plugin.source === 'local') && isPluginWorkspaceAllowed(plugin, workspace));
  const fingerprint = plugin?.fingerprint;
  const pluginId = plugin?.id;
  const commandId = command?.id;
  const output = tool?.kind === 'file-output';
  const sourceId = source?.id;
  const active = executions.some(item => commandIsActive(item.status));
  const locked = Boolean(preparing || pending || active);
  const hidden = showReview || picker !== null || !ready;
  const hiddenRef = React.useRef(hidden); hiddenRef.current = hidden;
  const latestDestination = React.useRef<PluginWorkspaceDestination | null>(null);
  const syncedDestination = React.useRef('');
  latestDestination.current = output && destination && fileName.trim() ? { parentId: destination.id, fileName: fileName.trim() } : null;
  const themeRevision = React.useRef(0);
  const theme = React.useMemo(() => toPluginThemeSnapshot(appearance, ++themeRevision.current), [appearance]);
  const latestTheme = React.useRef(theme); latestTheme.current = theme;

  const accept = React.useCallback((execution: PluginCommandExecution, live: boolean) => {
    if (execution.commandId !== commandId || execution.source.pluginId !== pluginId || execution.libraryId !== libraryId
      || serializeAgentOwnerScope(execution.ownerScope) !== ownerKey || !pluginCommandApi.isCurrentScope(execution)
      || (revisions.current.get(execution.id) ?? -1) >= execution.revision) return;
    revisions.current.set(execution.id, execution.revision);
    setExecutions(current => mergeCommandProjection(current, execution));
    if (commandIsActive(execution.status)) setShowReview(true);
    if (live) for (const id of commandCommittedMutation(execution)?.parentIds ?? []) {
      const current = generation.current;
      void Promise.resolve().then(() => refresh.current?.(id)).catch(() => {
        if (current === generation.current) setError('操作已完成，但目录刷新失败；请手动刷新。');
      });
    }
  }, [commandId, libraryId, ownerKey, pluginId]);

  React.useEffect(() => {
    const current = ++generation.current;
    startPluginCommandRuntime(); pluginManagementApi.start();
    const unsubscribe = pluginCommandApi.subscribe(execution => { if (current === generation.current) accept(execution, true); });
    void pluginCommandApi.list(libraryId).then(items => {
      if (current !== generation.current) return;
      for (const item of items) accept(item, false);
    }).catch(() => { if (current === generation.current) setError('无法读取插件执行记录，请稍后重试。'); });
    return () => { generation.current += 1; sourceGeneration.current += 1; unsubscribe(); };
  }, [accept, libraryId]);

  React.useEffect(() => {
    if (!wantsOpen || !allowed || !sourceId) return;
    const id = crypto.randomUUID(); client.current = id;
    syncedDestination.current = '';
    let disposed = false;
    setReady(false); setError('');
    const updateLayout = () => {
      if (disposed) return;
      const rect = container.current?.getBoundingClientRect();
      void pluginWorkspaceApi.layout(id, hiddenRef.current || !rect ? null
        : { x: rect.x, y: rect.y, width: rect.width, height: rect.height }).catch(() => undefined);
    };
    layout.current = updateLayout;
    const stop = pluginWorkspaceApi.subscribe(event => {
      if (disposed || event.clientId !== id) return;
      if (event.type === 'preparing') {
        hiddenRef.current = true; updateLayout();
        setPreparing(event.requestId); setShowReview(true); setError('');
      } else if (event.type === 'execution') {
        setPreparing(null); setShowReview(true);
        void pluginCommandApi.list(libraryId).then(items => { if (!disposed) for (const item of items) accept(item, false); }).catch(() => undefined);
      } else if (event.type === 'error') {
        setPreparing(null); setError(failureMessage(event.code));
      } else {
        setReady(false); setWantsOpen(false); setPreparing(null);
        if (event.reason !== 'closed') setError('插件工具已停止，请检查插件状态后重新打开。');
      }
    });
    const observer = new ResizeObserver(updateLayout);
    if (container.current) observer.observe(container.current);
    window.addEventListener('resize', updateLayout); window.addEventListener('scroll', updateLayout, true);
    void pluginWorkspaceApi.open({ clientId: id, workspaceId, libraryId, nodeId: sourceId, theme: latestTheme.current,
      ...(latestDestination.current ? { destination: latestDestination.current } : {}) }).then(async result => {
      if (disposed) { void pluginWorkspaceApi.close(id).catch(() => undefined); return; }
      if (!result.ok) { setError(failureMessage(result.code)); setWantsOpen(false); return; }
      const nextDestination = latestDestination.current;
      await pluginWorkspaceApi.destination(id, nextDestination);
      if (!disposed) { syncedDestination.current = JSON.stringify(nextDestination); setReady(true); }
    }).catch(() => { if (!disposed) { setError('无法启动插件工具，请重新打开。'); setWantsOpen(false); } });
    return () => {
      disposed = true; stop(); observer.disconnect(); window.removeEventListener('resize', updateLayout); window.removeEventListener('scroll', updateLayout, true);
      if (client.current === id) { client.current = null; layout.current = () => undefined; }
      void pluginWorkspaceApi.close(id).catch(() => undefined);
    };
  }, [accept, allowed, fingerprint, libraryId, ownerKey, retry, sourceId, wantsOpen, workspaceId]);

  React.useLayoutEffect(() => { layout.current(); }, [hidden]);
  React.useEffect(() => { if (client.current && ready) void pluginWorkspaceApi.theme(client.current, theme).catch(() => undefined); }, [ready, theme]);
  React.useEffect(() => {
    if (!client.current || !ready || locked) return;
    const current = generation.current;
    const nextDestination = latestDestination.current, identity = JSON.stringify(nextDestination);
    if (identity === syncedDestination.current) return;
    void pluginWorkspaceApi.destination(client.current, nextDestination).then(() => {
      if (current === generation.current) syncedDestination.current = identity;
    }).catch(() => {
      if (current === generation.current) setError('保存目标同步失败，请重新打开工具后再试。');
    });
  }, [destination?.id, fileName, locked, ready]);

  const chooseSource = async (nodeId: number) => {
    const current = ++sourceGeneration.current;
    setLoadingSource(true); setWantsOpen(false); setError('');
    try {
      const node = await fetchNodeDetailById(nodeId);
      if (current !== sourceGeneration.current || !pluginCommandApi.isCurrentScope(scope)) return;
      if (node.libraryId !== libraryId || node.type !== 'file') throw new Error('invalid source');
      setSource(node);
      if (node.parentId > 0) setDestination({ id: node.parentId, label: `来源所在目录 #${node.parentId}` });
    } catch { if (current === sourceGeneration.current) setError('无法选择此文件，请选择当前资料库中的普通文件。'); }
    finally { if (current === sourceGeneration.current) setLoadingSource(false); }
  };
  const confirmPicker = (selection: LibraryNodePickerSelection) => {
    if (selection.node.libraryId !== libraryId) { setPicker(null); return; }
    if (picker === 'destination' && selection.node.type === 'dir') setDestination({ id: selection.node.id, label: selection.pathLabel });
    else if (picker === 'source' && selection.node.type === 'file') void chooseSource(selection.node.id);
    setPicker(null);
  };
  const act = async (execution: PluginCommandExecution, action: 'approve' | 'cancel' | 'reconcile') => {
    const current = generation.current, key = `${action}:${execution.id}`;
    setPending(key); setError('');
    try {
      const updated = await pluginCommandApi[action]({ libraryId, executionId: execution.id, expectedRevision: execution.revision });
      if (current === generation.current) accept(updated, true);
    } catch (cause) { if (current === generation.current) setError(cause instanceof Error ? cause.message : '操作失败，请重试。'); }
    finally { if (current === generation.current) setPending(value => value === key ? '' : value); }
  };
  const treeIds = selectedNodeIds?.length ? selectedNodeIds : selectedTreeNode?.type === 'file' ? [selectedTreeNode.id] : [];
  return <>
    <WorkspaceHeader><div className="header-copy"><div className="header-title">{workspace?.title ?? '插件工具'}</div>
      <div className="header-desc">选择来源文件，在工具内处理；保存前确认新文件。</div></div></WorkspaceHeader>
    <PluginWorkspaceBody>
      <div className="workspace-resource-bar">
        <div className="field"><strong>来源文件</strong><span className="source-label">{source ? sourceName(source) : '请选择一个文件'}</span>
          <div className="actions"><button type="button" disabled={locked || loadingSource} onClick={() => setPicker('source')}>选择文件</button>
            <button type="button" disabled={locked || loadingSource || treeIds.length !== 1} onClick={() => void chooseSource(treeIds[0])}>使用目录树所选文件</button></div></div>
        {output && <div className="field"><strong>保存为新文件</strong><div className="actions"><span>{destination?.label ?? '请选择保存目录'}</span>
          <button type="button" disabled={locked} onClick={() => setPicker('destination')}>选择目录</button></div>
          <label htmlFor="plugin-workspace-filename">文件名（含扩展名）</label><input id="plugin-workspace-filename" value={fileName} maxLength={240} disabled={locked}
            placeholder="例如：处理结果.json" onChange={event => setFileName(event.target.value)} /></div>}
      </div>
      <div className="actions workspace-host-status">
        <button type="button" className="primary" disabled={!allowed || !source || locked || loadingSource} onClick={() => { setShowReview(false); setWantsOpen(true); setRetry(value => value + 1); }}>{ready ? '重新打开工具' : '打开工具'}</button>
        {executions.length > 0 && !showReview && <button type="button" onClick={() => setShowReview(true)}>执行记录</button>}
        {showReview && <button type="button" disabled={locked} onClick={() => { setShowReview(false); setError(''); }}>返回编辑</button>}
        {loadingSource && <span role="status">正在读取文件信息…</span>}
        {wantsOpen && !ready && <span role="status">正在加载工具…</span>}
      </div>
      {error && <div role="alert" className="error workspace-host-status">{error}</div>}
      {!allowed && <p role="status">此工具尚未获准运行，请在插件管理中启用并批准相应能力。</p>}
      <div className="workspace-stage">
        <div ref={container} className="workspace-plugin-view" aria-hidden={hidden} style={{ display: showReview ? 'none' : undefined }}>
          {!ready && !wantsOpen && <p className="workspace-empty muted">打开工具后，插件可以读取上方选定的文件。</p>}
        </div>
        {showReview && <div className="workspace-review" aria-label="宿主执行确认">
          {preparing && <p role="status">正在准备处理结果…</p>}
          {executions.slice(0, 10).map(execution => <CommandExecutionCard key={execution.id} execution={execution}
            busy={pending === `cancel:${execution.id}` || pending === `reconcile:${execution.id}` || (pending === `approve:${execution.id}` && execution.status === 'awaiting-approval')}
            onApprove={() => void act(execution, 'approve')} onCancel={() => void act(execution, 'cancel')} onReconcile={() => void act(execution, 'reconcile')} />)}
          {executions.length > 10 && <p className="muted">更早的记录可在“插件工具”中查看。</p>}
        </div>}
      </div>
    </PluginWorkspaceBody>
    <LibraryNodePickerModal libraryId={libraryId} visible={picker !== null} displayMode={picker === 'destination' ? 'folders' : 'files'}
      title={picker === 'destination' ? '选择新文件保存目录' : '选择插件处理的文件'} onCancel={() => setPicker(null)} onConfirm={confirmPicker} />
  </>;
}

export default function PluginWorkspace(props: PluginWorkspaceProps) {
  if (!pluginWorkspaceApi.available() || !pluginCommandApi.available()) return <PluginWorkspaceBody>插件工具页面需要在桌面客户端运行。</PluginWorkspaceBody>;
  let key: string;
  try { key = `${serializeAgentOwnerScope(pluginCommandApi.scope(props.libraryId).ownerScope)}:${props.libraryId}:${props.workspaceId}`; }
  catch { return <PluginWorkspaceBody>请登录后打开插件工具。</PluginWorkspaceBody>; }
  return <PluginWorkspaceInner key={key} {...props} />;
}
