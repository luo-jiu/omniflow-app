import React from 'react';
import styled from 'styled-components';
import { ArrowLeft, FileDiff, X } from 'lucide-react';
import type { AgentOwnerScope, AgentToolActivitySnapshot } from '@/shared/agent/agent.types';
import type {
  AgentFileChangeList,
  AgentFileChangeListRequest,
  AgentFileChangeSummary,
  AgentFileDiffRequest,
  AgentFileDiffResult,
} from '@/shared/agent/agent-file-changes';
import { listAgentFileChanges, readAgentFileDiff } from '../services/agent.api';
import { interactiveItemStyles } from '@/components/ui/theme-foundation-styles';
import { workspaceScrollbarStyles } from '@/components/ui/workspace-scrollbar';

const Changes = styled.div`
  display: contents;
  .changes-trigger { margin-left: auto; gap: 5px; }
  .changes-panel {
    container-type: inline-size;
    flex: 1 0 100%;
    min-width: 0;
    margin-top: 8px;
    border: 1px solid var(--app-border);
    border-radius: var(--app-radius-medium);
    background: var(--app-bg-elevated);
    color: var(--app-text);
    font-size: 12px;
    line-height: 1.5;
    overflow: hidden;
  }
  .changes-panel button {
    min-height: 28px;
    padding: 3px 7px;
    border-radius: var(--app-radius-medium);
    ${interactiveItemStyles}
  }
  .changes-header { display: flex; align-items: center; gap: 8px; padding: 8px 10px; }
  .changes-header strong { flex: 1; }
  .changes-coverage { margin: 0; padding: 0 10px 8px; color: var(--app-text-secondary); }
  .changes-warning { margin: 0; padding: 8px 10px; color: var(--app-text-secondary); }
  .changes-body {
    display: grid;
    grid-template-columns: minmax(130px, 210px) minmax(0, 1fr);
    height: min(480px, 60vh);
    min-height: 220px;
    border-top: 1px solid var(--app-border);
  }
  .changes-files { min-width: 0; overflow: auto; padding: 5px; border-right: 1px solid var(--app-border); ${workspaceScrollbarStyles} }
  .changes-panel .changes-file {
    display: flex; flex-direction: column; align-items: flex-start; gap: 2px;
    width: 100%; min-width: 0; margin-bottom: 3px; text-align: left;
  }
  .changes-file[aria-pressed='true'] { background: var(--app-control-selected-bg); color: var(--app-text); }
  .changes-file-path { max-width: 100%; overflow-wrap: anywhere; }
  .changes-file-state { color: var(--app-text-muted); font-size: 11px; }
  .changes-detail { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
  .changes-detail-header { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; padding: 6px 8px; border-bottom: 1px solid var(--app-border); }
  .changes-detail-header > span { flex: 1; min-width: 0; overflow-wrap: anywhere; }
  .changes-detail select { max-width: 100%; min-height: 28px; border: 1px solid var(--app-border); border-radius: var(--app-radius-medium); background: var(--app-bg-elevated); color: var(--app-text); font: inherit; }
  .changes-patch { flex: 1; min-height: 0; margin: 0; overflow: auto; padding: 10px; font-family: 'JetBrains Mono', monospace; font-size: 12px; line-height: 1.6; white-space: pre; ${workspaceScrollbarStyles} }
  .changes-patch code { display: block; min-width: max-content; }
  .changes-patch-line { display: block; min-height: 1.6em; }
  .changes-patch-line[data-kind='added'] { color: var(--semi-color-success); background: color-mix(in srgb, var(--semi-color-success) 9%, transparent); }
  .changes-patch-line[data-kind='removed'] { color: var(--semi-color-danger); background: color-mix(in srgb, var(--semi-color-danger) 9%, transparent); }
  .changes-patch-line[data-kind='hunk'] { color: var(--app-accent); }
  .changes-panel .changes-back-files { display: none; }
  .changes-pagination { display: flex; align-items: center; flex-wrap: wrap; justify-content: flex-end; gap: 7px; padding: 6px 8px; border-top: 1px solid var(--app-border); color: var(--app-text-secondary); }
  @container (max-width: 560px) {
    .changes-body { grid-template-columns: minmax(0, 1fr); }
    .changes-body[data-show-diff='true'] .changes-files { display: none; }
    .changes-body[data-show-diff='false'] .changes-detail { display: none; }
    .changes-panel .changes-back-files { display: inline-flex; }
    .changes-files { border-right: 0; }
  }
`;

interface FileGroup {
  key: string;
  path: string;
  scope: AgentFileChangeSummary['scope'];
  runId: string;
  operations: AgentFileChangeSummary[];
  continuous: boolean;
  netZero: boolean;
}

function groupChanges(changes: AgentFileChangeSummary[]): FileGroup[] {
  const groups = new Map<string, FileGroup>();
  for (const change of changes) {
    const key = JSON.stringify([change.runId, change.scope, change.nodeId ?? change.path]);
    let group = groups.get(key);
    if (!group) {
      group = { key, path: change.path, scope: change.scope, runId: change.runId, operations: [], continuous: true, netZero: false };
      groups.set(key, group);
    }
    group.operations.push(change);
  }
  for (const group of groups.values()) {
    group.operations.sort((a, b) => a.createdAt - b.createdAt);
    group.continuous = group.scope === 'library' && group.operations.every((operation, index) => operation.state === 'committed'
      && operation.path === group.path
      && (index === 0 || operation.beforeRevision === group.operations[index - 1].afterRevision));
    group.netZero = group.continuous && group.operations[0].beforeRevision === group.operations.at(-1)!.afterRevision;
  }
  return [...groups.values()];
}

function stateLabel(state: AgentFileChangeSummary['state']): string {
  return state === 'commit_unknown' ? '提交待核对' : state === 'uncommitted' ? '未提交' : '已提交';
}

function patchLineKind(line: string): string {
  if (line.startsWith('@@')) return 'hunk';
  if (line.startsWith('+') && !line.startsWith('+++ ')) return 'added';
  if (line.startsWith('-') && !line.startsWith('--- ')) return 'removed';
  return 'context';
}

export default function AgentFileChanges({ ownerScope, libraryId, sessionId, runIds, activities }: {
  ownerScope: AgentOwnerScope;
  libraryId: number;
  sessionId: string;
  runIds: string[];
  activities: AgentToolActivitySnapshot[];
}) {
  const runKey = JSON.stringify(runIds.slice(-16));
  const scopeKey = JSON.stringify([ownerScope.backendScope, ownerScope.accountScope, libraryId, sessionId, runKey]);
  const request = React.useMemo<AgentFileChangeListRequest>(() => ({
    ownerScope: { backendScope: ownerScope.backendScope, accountScope: ownerScope.accountScope },
    libraryId, sessionId, runIds: JSON.parse(runKey) as string[],
  }), [libraryId, ownerScope.accountScope, ownerScope.backendScope, runKey, sessionId]);
  const eligible = activities.filter(activity => request.runIds.includes(activity.runId)
    && (activity.call.name === 'file.write' || activity.call.name === 'file.patch'));
  const revisionKey = eligible.map(activity => `${activity.id}:${activity.revision}`).join('|');
  const capturePending = eligible.some(activity => ['preparing', 'running', 'awaiting_approval', 'awaiting_interaction'].includes(activity.status));
  const [refresh, setRefresh] = React.useState(0);
  const queryKey = `${scopeKey}:${revisionKey}:${refresh}`;
  const [summary, setSummary] = React.useState<{ key: string; value?: AgentFileChangeList; error?: boolean }>({ key: '' });
  const [openScope, setOpenScope] = React.useState<string | null>(null);
  const [selection, setSelection] = React.useState<{ scope: string; key: string; operation: string } | null>(null);
  const [showDiff, setShowDiff] = React.useState(false);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const open = openScope === scopeKey;
  const data = summary.key === queryKey ? summary.value : undefined;
  const failed = summary.key === queryKey && summary.error;
  const groups = React.useMemo(() => groupChanges(data?.changes ?? []), [data]);
  const selected = groups.find(group => selection?.scope === scopeKey && selection.key === group.key) ?? groups[0];
  const operation = selected && selection?.scope === scopeKey && selection.key === selected.key
    && (selection.operation === 'net' && selected.continuous || selected.operations.some(item => item.id === selection.operation))
    ? selection.operation : selected?.continuous ? 'net' : selected?.operations.at(-1)?.id;
  const selectedOperation = selected?.operations.find(item => item.id === operation);
  const baseDiffRequest = React.useMemo<AgentFileDiffRequest | null>(() => {
    if (!selected || !operation) return null;
    const first = selectedOperation ?? selected.operations[0];
    return { ownerScope: request.ownerScope, libraryId, sessionId, changeId: first.id,
      ...(operation === 'net' && selected.operations.length > 1 ? { throughChangeId: selected.operations.at(-1)!.id } : {}) };
  }, [libraryId, operation, request.ownerScope, selected, selectedOperation, sessionId]);
  const baseDiffKey = JSON.stringify([queryKey, baseDiffRequest]);
  const [pageSelection, setPageSelection] = React.useState<{ key: string; cursor?: string } | null>(null);
  const cursor = pageSelection?.key === baseDiffKey ? pageSelection.cursor : undefined;
  const diffRequest = React.useMemo<AgentFileDiffRequest | null>(() => baseDiffRequest
    ? { ...baseDiffRequest, pageLines: 200, ...(cursor ? { cursor } : {}) } : null, [baseDiffRequest, cursor]);
  const diffKey = JSON.stringify([queryKey, diffRequest]);
  const [diff, setDiff] = React.useState<{ key: string; value?: AgentFileDiffResult; error?: string }>({ key: '' });
  const diffData = diff.key === diffKey ? diff.value : undefined;
  const diffFailed = diff.key === diffKey && diff.error;
  const patch = React.useMemo(() => {
    const source = diffData?.patch ?? '';
    const lines = source.slice(0, 250_000).split('\n');
    return { lines: lines.slice(0, 4_000), truncated: source.length > 250_000 || lines.length > 4_000 };
  }, [diffData?.patch]);

  React.useEffect(() => {
    if (!revisionKey) return;
    let cancelled = false;
    Promise.resolve().then(() => listAgentFileChanges(request)).then(value => {
      if (!cancelled) setSummary({ key: queryKey, value });
    }, () => {
      if (!cancelled) setSummary({ key: queryKey, error: true });
    });
    return () => { cancelled = true; };
  }, [queryKey, request, revisionKey]);

  React.useEffect(() => {
    if (!open || !diffRequest) return;
    let cancelled = false;
    const controller = new AbortController();
    Promise.resolve().then(() => {
      controller.signal.throwIfAborted();
      return readAgentFileDiff(diffRequest, controller.signal);
    }).then(value => {
      if (!cancelled) setDiff({ key: diffKey, value });
    }, error => {
      if (!cancelled) setDiff({ key: diffKey, error: error instanceof Error ? error.message.slice(0, 250) : '差异读取失败' });
    });
    return () => { cancelled = true; controller.abort(); };
  }, [diffKey, diffRequest, open]);

  if (!eligible.length) return null;
  const changedResources = new Set(groups.filter(group => !group.netZero && group.operations.some(item => item.state === 'committed'))
    .map(group => JSON.stringify([group.scope, group.operations[0].nodeId ?? group.path])));
  const unknown = data?.changes.filter(change => change.state === 'commit_unknown').length ?? 0;
  const label = failed ? '改动读取失败' : !data ? '改动加载中…'
    : !data.changes.length && capturePending ? '改动记录中…'
      : `改动 ${changedResources.size}${data.truncated ? '+' : ''}${unknown ? ` · ${unknown} 项待核对` : ''}`;
  const resetReview = () => { setPageSelection(null); setDiff({ key: '' }); setShowDiff(false); };
  const close = () => { resetReview(); setOpenScope(null); triggerRef.current?.focus(); };

  return <Changes>
    <button type="button" className="changes-trigger" ref={triggerRef} aria-expanded={open}
      aria-label={label} onClick={() => { resetReview(); setOpenScope(open ? null : scopeKey); }}>
      <FileDiff size={14} strokeWidth={1.25} aria-hidden="true" />{label}
    </button>
    {open ? <section className="changes-panel" aria-label="Agent 文件改动">
      <div className="changes-header"><strong>文件改动{runIds.length > 1 ? ` · ${request.runIds.length} 次执行` : ''}</strong>
        <button type="button" onClick={() => setRefresh(value => value + 1)}>刷新</button>
        <button type="button" aria-label="返回对话" onClick={close}><X size={14} aria-hidden="true" />返回对话</button>
      </div>
      <p className="changes-coverage">仅记录 file.write / file.patch，其他写入（包括 Shell）不在此列表。差异来自操作时保存的版本。</p>
      {runIds.length > 16 ? <p className="changes-warning">当前显示最近 16 次执行的记录。</p> : null}
      {data?.truncated ? <p className="changes-warning">改动记录超出展示上限，当前列表不完整。</p> : null}
      {!data ? <p className="changes-warning" role="status">{failed ? '改动读取失败，请刷新重试。' : '正在读取改动记录…'}</p>
        : !groups.length ? <p className="changes-warning">{capturePending ? '文件操作尚未结算，已提交改动会随工具结果更新。' : '本轮没有捕获到文件改动记录。'}</p>
          : <div className="changes-body" data-show-diff={showDiff}>
            <nav className="changes-files" aria-label="改动文件">
              {groups.map(group => <button type="button" className="changes-file" key={group.key}
                aria-pressed={selected?.key === group.key} onClick={() => {
                  setSelection({ scope: scopeKey, key: group.key, operation: group.continuous ? 'net' : group.operations.at(-1)!.id });
                  setShowDiff(true);
                }}>
                <span className="changes-file-path">{group.path}</span>
                <span className="changes-file-state">{group.scope === 'host' ? '本机' : '资料库'}
                  {runIds.length > 1 ? ` · 执行 ${request.runIds.indexOf(group.runId) + 1}` : ''}
                  {' · '}{group.netZero ? '净改动为零' : group.operations.some(item => item.state === 'commit_unknown') ? '含提交待核对' : stateLabel(group.operations.at(-1)!.state)}
                  {group.operations.some(item => !item.available) ? ' · 含不可用快照' : ''}
                </span>
              </button>)}
            </nav>
            <div className="changes-detail">
              <div className="changes-detail-header">
                <button type="button" className="changes-back-files" onClick={() => setShowDiff(false)}><ArrowLeft size={14} />文件列表</button>
                <span>{selected?.path}</span>
                {selected && selected.operations.length > 1 ? <select aria-label="差异范围" value={operation}
                  onChange={event => setSelection({ scope: scopeKey, key: selected.key, operation: event.target.value })}>
                  {selected.continuous ? <option value="net">本次执行净改动</option> : null}
                  {selected.operations.map((item, index) => <option key={item.id} value={item.id}>操作 {index + 1} · {stateLabel(item.state)}</option>)}
                </select> : null}
              </div>
              {selected && !selected.continuous && selected.operations.length > 1 ? <p className="changes-warning">{selected.scope === 'host'
                ? '本机路径不能证明文件身份，按单次操作查看。' : '版本链不连续或含未确认提交，按单次操作查看。'}</p> : null}
              {!diffData ? <div className="changes-warning" role="status">{diffFailed ? `差异读取失败：${diffFailed}` : '正在读取差异…'}
                {diffFailed && cursor ? <button type="button" onClick={() => setPageSelection({ key: baseDiffKey })}>返回首屏</button> : null}
              </div>
                : <>
                  {diffData.state !== 'committed' ? <p className="changes-warning">{stateLabel(diffData.state)}；候选内容不代表已写入文件。</p> : null}
                  {diffData.warning ? <p className="changes-warning">{diffData.warning}</p> : null}
                  {!diffData.available ? <p className="changes-warning">历史快照已清理或不可用，操作记录仍保留。</p>
                    : !diffData.patch ? <p className="changes-warning">{diffData.truncated
                      ? '差异计算受限，历史快照仍保留。' : '该范围没有文本净差异。'}</p>
                      : <pre className="changes-patch" tabIndex={0} aria-label="统一差异"><code>{patch.lines.map((line, index) =>
                        <span className="changes-patch-line" key={index} data-kind={patchLineKind(line)}>{line}</span>)}</code></pre>}
                  {diffData.patch && (diffData.truncated || patch.truncated) ? <p className="changes-warning">差异过长，当前内容已截断。</p> : null}
                  {diffData.page && diffData.page.totalPages > 1 ? <nav className="changes-pagination" aria-label="差异分页">
                    <span>第 {diffData.page.index + 1} / {diffData.page.totalPages} 页 · {diffData.page.startLine}–{diffData.page.endLine} 行</span>
                    {diffData.page.continuedFromPrevious || diffData.page.continuesOnNext ? <span>长行已分段</span> : null}
                    <button type="button" disabled={!diffData.page.previousCursor}
                      onClick={() => setPageSelection({ key: baseDiffKey, cursor: diffData.page!.previousCursor })}>上一页</button>
                    <button type="button" disabled={!diffData.page.nextCursor}
                      onClick={() => setPageSelection({ key: baseDiffKey, cursor: diffData.page!.nextCursor })}>下一页</button>
                  </nav> : null}
                </>}
            </div>
          </div>}
    </section> : null}
  </Changes>;
}
