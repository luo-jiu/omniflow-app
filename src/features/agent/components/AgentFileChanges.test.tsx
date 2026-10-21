import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentToolActivitySnapshot } from '@/shared/agent/agent.types';
import type { AgentFileChangeList, AgentFileChangeSummary, AgentFileDiffResult } from '@/shared/agent/agent-file-changes';
import AgentFileChanges from './AgentFileChanges';
import { listAgentFileChanges, readAgentFileDiff } from '../services/agent.api';

vi.mock('../services/agent.api', () => ({ listAgentFileChanges: vi.fn(), readAgentFileDiff: vi.fn() }));
const list = vi.mocked(listAgentFileChanges);
const read = vi.mocked(readAgentFileDiff);
const ownerScope = { backendScope: 'https://example.test', accountScope: 'user:7' };
const activity: AgentToolActivitySnapshot = { id: 'tool-1', runId: 'run-1', sessionId: 'session-1',
  revision: 2, ordinal: 1, status: 'completed', createdAt: '', permissionBehavior: 'allow',
  call: { id: 'call-1', name: 'file.write', input: {} } };
const props = { ownerScope, libraryId: 3, sessionId: 'session-1', runIds: ['run-1'], activities: [activity] };
const change = (overrides: Partial<AgentFileChangeSummary> = {}): AgentFileChangeSummary => ({
  id: 'change-1', operationId: 'op-1', toolRunId: 'tool-1', runId: 'run-1', scope: 'library',
  nodeId: 10, path: '/one.txt', kind: 'update', state: 'committed', available: true,
  beforeRevision: 'a', afterRevision: 'b', createdAt: 1, ...overrides,
});
const result = (overrides: Partial<AgentFileDiffResult> = {}): AgentFileDiffResult => ({
  path: '/one.txt', scope: 'library', state: 'committed', available: true,
  patch: '--- a/one.txt\n+++ b/one.txt\n@@ -1 +1 @@\n-old\n+new', truncated: false, baseline: 'operation', ...overrides,
});
const summary = (changes: AgentFileChangeSummary[]): AgentFileChangeList => ({ changes, coverage: 'structured-file-writes', truncated: false });
let renderer: TestRenderer.ReactTestRenderer | undefined;
async function mount() {
  await act(async () => { renderer = TestRenderer.create(<AgentFileChanges {...props} />); });
}
async function open() {
  await act(async () => { renderer!.root.findByProps({ className: 'changes-trigger' }).props.onClick(); });
}
function renderedText() { return JSON.stringify(renderer!.toJSON()); }
function chooseFile(path: string) {
  const file = renderer!.root.findAllByType('button').find(item => item.props.className === 'changes-file'
    && item.findByProps({ className: 'changes-file-path' }).children.includes(path))!;
  file.props.onClick();
}
afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  vi.resetAllMocks();
});

describe('Agent independent file change review', () => {
  it('shows a pending summary without claiming zero changes and reads diff only on demand', async () => {
    let finish!: (value: AgentFileChangeList) => void;
    list.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    read.mockResolvedValue(result());
    await mount();
    expect(renderedText()).toContain('改动加载中');
    expect(renderedText()).not.toContain('改动 0');
    expect(read).not.toHaveBeenCalled();
    await open();
    expect(renderer!.root.findByProps({ 'aria-label': 'Agent 文件改动' }).type).toBe('section');
    await act(async () => { finish(summary([change()])); });
    expect(renderedText()).toContain('改动 1');
    expect(list).toHaveBeenCalledWith({ ownerScope, libraryId: 3, sessionId: 'session-1', runIds: ['run-1'] });
    expect(read).toHaveBeenCalledWith(expect.objectContaining({ changeId: 'change-1', pageLines: 200 }), expect.any(AbortSignal));
    expect(renderedText()).toContain('+new');
    expect(renderedText()).toContain('file.write / file.patch');
    await act(async () => renderer!.root.findByProps({ 'aria-label': '返回对话' }).props.onClick());
    expect(renderer!.root.findAllByProps({ 'aria-label': 'Agent 文件改动' })).toHaveLength(0);
  });

  it('reads the net result of a continuous chain and can select a single operation', async () => {
    list.mockResolvedValue(summary([change(), change({ id: 'change-2', operationId: 'op-2', beforeRevision: 'b', afterRevision: 'c', createdAt: 2 })]));
    read.mockResolvedValue(result({ baseline: 'run' }));
    await mount();
    await open();
    expect(read).toHaveBeenLastCalledWith(expect.objectContaining({ changeId: 'change-1', throughChangeId: 'change-2' }), expect.any(AbortSignal));
    expect(renderer!.root.findAllByProps({ className: 'changes-file' })).toHaveLength(1);
    await act(async () => renderer!.root.findByProps({ 'aria-label': '差异范围' }).props.onChange({ target: { value: 'change-1' } }));
    expect(read.mock.lastCall![0]).not.toHaveProperty('throughChangeId');
    expect(read.mock.lastCall![0].changeId).toBe('change-1');
  });

  it('keeps unknown commits separate and does not aggregate a discontinuous chain', async () => {
    list.mockResolvedValue(summary([change(), change({ id: 'unknown', state: 'commit_unknown', beforeRevision: 'other', afterRevision: 'candidate', createdAt: 2 })]));
    read.mockResolvedValue(result({ state: 'commit_unknown' }));
    await mount();
    await open();
    expect(renderedText()).toContain('1 项待核对');
    expect(renderedText()).toContain('候选内容不代表已写入文件');
    expect(read.mock.lastCall![0]).toMatchObject({ changeId: 'unknown' });
    expect(read.mock.lastCall![0]).not.toHaveProperty('throughChangeId');
    expect(renderer!.root.findByProps({ 'aria-label': '差异范围' }).findAllByType('option').map(item => item.props.value)).toEqual(['change-1', 'unknown']);
  });

  it('keeps host writes as individual operations even when their content hashes form a chain', async () => {
    list.mockResolvedValue(summary([change({ scope: 'host', nodeId: undefined }),
      change({ scope: 'host', nodeId: undefined, id: 'host-second', beforeRevision: 'b', afterRevision: 'c', createdAt: 2 })]));
    read.mockResolvedValue(result({ scope: 'host' }));
    await mount();
    await open();
    expect(read.mock.lastCall![0]).not.toHaveProperty('throughChangeId');
    expect(renderedText()).toContain('本机路径不能证明文件身份');
  });

  it('retains operation facts when historical snapshots have expired', async () => {
    list.mockResolvedValue(summary([change({ available: false })]));
    read.mockResolvedValue(result({ available: false, patch: '' }));
    await mount();
    await open();
    expect(renderedText()).toContain('改动 1');
    expect(renderedText()).toContain('历史快照已清理或不可用');
    expect(renderer!.root.findAllByProps({ 'aria-label': '统一差异' })).toHaveLength(0);
  });

  it('shows a net-zero result while retaining the individual operation history', async () => {
    list.mockResolvedValue(summary([change(), change({ id: 'back-to-a', beforeRevision: 'b', afterRevision: 'a', createdAt: 2 })]));
    read.mockResolvedValue(result({ patch: '', baseline: 'run' }));
    await mount();
    await open();
    expect(renderedText()).toContain('改动 0');
    expect(renderedText()).toContain('净改动为零');
    expect(renderer!.root.findByProps({ 'aria-label': '差异范围' }).findAllByType('option')).toHaveLength(3);
  });

  it('does not claim zero difference when the computation limit prevents a patch', async () => {
    list.mockResolvedValue(summary([change()]));
    read.mockResolvedValue(result({ patch: '', truncated: true, warning: '历史文件行数超过差异计算上限' }));
    await mount();
    await open();
    expect(renderedText()).toContain('改动 1');
    expect(renderedText()).toContain('差异计算受限，历史快照仍保留');
    expect(renderedText()).toContain('历史文件行数超过差异计算上限');
    expect(renderedText()).not.toContain('该范围没有文本净差异');
    expect(renderedText()).not.toContain('差异过长');
  });

  it('reports a summary error explicitly and permits a manual retry', async () => {
    list.mockRejectedValueOnce(new Error('unavailable'));
    list.mockResolvedValueOnce(summary([change()]));
    read.mockResolvedValue(result());
    await mount();
    expect(renderedText()).toContain('改动读取失败');
    expect(renderedText()).not.toContain('改动 0');
    await open();
    await act(async () => renderer!.root.findAllByType('button').find(item => item.children.includes('刷新'))!.props.onClick());
    expect(renderedText()).toContain('改动 1');
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('refreshes only when a captured tool revision changes or the user requests it', async () => {
    list.mockResolvedValue(summary([change()]));
    read.mockResolvedValue(result());
    await mount();
    await act(async () => renderer!.update(<AgentFileChanges {...props} activities={[{ ...activity }]} />));
    expect(list).toHaveBeenCalledTimes(1);
    await act(async () => renderer!.update(<AgentFileChanges {...props} activities={[{ ...activity, revision: 3 }]} />));
    expect(list).toHaveBeenCalledTimes(2);
    await open();
    await act(async () => renderer!.root.findAllByType('button').find(item => item.children.includes('刷新'))!.props.onClick());
    expect(list).toHaveBeenCalledTimes(3);
  });

  it('rejects late summary results after an account scope switch', async () => {
    let finishOld!: (value: AgentFileChangeList) => void;
    let finishNew!: (value: AgentFileChangeList) => void;
    list.mockReturnValueOnce(new Promise(resolve => { finishOld = resolve; }));
    list.mockReturnValueOnce(new Promise(resolve => { finishNew = resolve; }));
    await mount();
    await open();
    await act(async () => renderer!.update(<AgentFileChanges {...props} ownerScope={{ ...ownerScope, accountScope: 'user:8' }} />));
    await act(async () => { finishOld(summary([change({ path: '/private-old-file' })])); });
    expect(renderedText()).not.toContain('/private-old-file');
    expect(renderer!.root.findAllByProps({ 'aria-label': 'Agent 文件改动' })).toHaveLength(0);
    await act(async () => { finishNew(summary([])); });
    expect(list.mock.lastCall![0].ownerScope.accountScope).toBe('user:8');
  });

  it('ignores a late diff after the user selects a different file', async () => {
    let finishFirst!: (value: AgentFileDiffResult) => void;
    list.mockResolvedValue(summary([change(), change({ id: 'second', nodeId: 11, path: '/two.txt' })]));
    read.mockReturnValueOnce(new Promise(resolve => { finishFirst = resolve; }));
    read.mockResolvedValueOnce(result({ path: '/two.txt', patch: '+second file' }));
    await mount();
    await open();
    await act(async () => chooseFile('/two.txt'));
    expect(read.mock.calls[0][1]?.aborted).toBe(true);
    await act(async () => { finishFirst(result({ patch: '+stale first file' })); });
    expect(renderedText()).toContain('+second file');
    expect(renderedText()).not.toContain('+stale first file');
  });

  it('loads one page at a time and replaces the displayed patch when moving between pages', async () => {
    list.mockResolvedValue(summary([change()]));
    const page = { index: 0, totalPages: 2, startLine: 1, endLine: 200, totalLines: 250,
      continuedFromPrevious: false, continuesOnNext: false, nextCursor: 'opaque:1' };
    read.mockResolvedValueOnce(result({ patch: '+first-page-only', page }));
    read.mockResolvedValueOnce(result({ patch: '+second-page-only', page: { ...page, index: 1, startLine: 201, endLine: 250,
      nextCursor: undefined, previousCursor: 'opaque:0', continuedFromPrevious: true } }));
    read.mockResolvedValueOnce(result({ patch: '+first-page-returned', page }));
    await mount(); await open();
    expect(read.mock.lastCall![0]).toMatchObject({ pageLines: 200 });
    expect(read.mock.lastCall![0]).not.toHaveProperty('cursor');
    const button = (label: string) => renderer!.root.findAllByType('button').find(item => item.children.includes(label))!;
    expect(button('上一页').props.disabled).toBe(true);
    await act(async () => button('下一页').props.onClick());
    expect(read.mock.lastCall![0].cursor).toBe('opaque:1');
    expect(renderedText()).toContain('+second-page-only');
    expect(renderedText()).not.toContain('+first-page-only');
    expect(renderedText()).toContain('长行已分段');
    expect(button('下一页').props.disabled).toBe(true);
    await act(async () => button('上一页').props.onClick());
    expect(read.mock.lastCall![0].cursor).toBe('opaque:0');
    expect(renderedText()).toContain('+first-page-returned');
    expect(read).toHaveBeenCalledTimes(3);
  });

  it('shows explicit page expiry and requests a fresh first page only after the user chooses it', async () => {
    list.mockResolvedValue(summary([change()]));
    read.mockResolvedValueOnce(result({ page: { index: 0, totalPages: 2, startLine: 1, endLine: 200, totalLines: 250,
      continuedFromPrevious: false, continuesOnNext: false, nextCursor: 'opaque:1' } }));
    read.mockRejectedValueOnce(new Error('差异分页已过期或范围已变化，请重新读取首屏'));
    read.mockResolvedValueOnce(result({ patch: '+fresh-first-page' }));
    await mount(); await open();
    await act(async () => renderer!.root.findAllByType('button').find(item => item.children.includes('下一页'))!.props.onClick());
    expect(renderedText()).toContain('差异分页已过期'); expect(read).toHaveBeenCalledTimes(2);
    await act(async () => renderer!.root.findAllByType('button').find(item => item.children.includes('返回首屏'))!.props.onClick());
    expect(read.mock.lastCall![0]).not.toHaveProperty('cursor');
    expect(renderedText()).toContain('+fresh-first-page');
  });

  it.each(['返回对话', '改动入口'])('reopens from a fresh first page after closing page three through %s', async closeThrough => {
    list.mockResolvedValue(summary([change()]));
    const page = { index: 0, totalPages: 3, startLine: 1, endLine: 200, totalLines: 450,
      continuedFromPrevious: false, continuesOnNext: false, nextCursor: 'expired:1' };
    read.mockResolvedValueOnce(result({ patch: '+old-first-page', page }));
    read.mockResolvedValueOnce(result({ patch: '+old-second-page', page: { ...page, index: 1, startLine: 201, endLine: 400,
      previousCursor: 'expired:0', nextCursor: 'expired:2' } }));
    read.mockResolvedValueOnce(result({ patch: '+old-third-page', page: { ...page, index: 2, startLine: 401, endLine: 450,
      previousCursor: 'expired:1', nextCursor: undefined } }));
    let finishReopen!: (value: AgentFileDiffResult) => void;
    read.mockReturnValueOnce(new Promise(resolve => { finishReopen = resolve; }));
    const next = () => renderer!.root.findAllByType('button').find(item => item.children.includes('下一页'))!.props.onClick();
    await mount(); await open();
    await act(async () => next());
    await act(async () => next());
    expect(read.mock.lastCall![0].cursor).toBe('expired:2');
    expect(renderedText()).toContain('+old-third-page');
    const closedSignal = read.mock.lastCall![1]!;
    if (closeThrough === '返回对话') {
      await act(async () => renderer!.root.findByProps({ 'aria-label': '返回对话' }).props.onClick());
    } else await open();
    expect(closedSignal.aborted).toBe(true);
    expect(renderer!.root.findAllByProps({ 'aria-label': 'Agent 文件改动' })).toHaveLength(0);
    await open();
    expect(read).toHaveBeenCalledTimes(4);
    expect(read.mock.lastCall![0]).not.toHaveProperty('cursor');
    expect(renderedText()).toContain('正在读取差异');
    expect(renderedText()).not.toContain('+old-third-page');
    expect(renderedText()).not.toContain('+old-first-page');
    await act(async () => { finishReopen(result({ patch: '+fresh-first-page', page: { ...page, nextCursor: 'fresh:1' } })); });
    expect(renderedText()).toContain('+fresh-first-page');
    expect(renderedText()).not.toContain('差异分页已过期');
  });

  it('cancels an outstanding worker read when review closes or unmounts and rejects its late page', async () => {
    list.mockResolvedValue(summary([change()]));
    let finish!: (value: AgentFileDiffResult) => void;
    read.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    await mount(); await open();
    const signal = read.mock.lastCall![1]!;
    await act(async () => renderer!.root.findByProps({ 'aria-label': '返回对话' }).props.onClick());
    expect(signal.aborted).toBe(true);
    read.mockReturnValueOnce(new Promise(() => undefined));
    await open(); const unmountSignal = read.mock.lastCall![1]!;
    expect(read.mock.lastCall![0]).not.toHaveProperty('cursor');
    await act(async () => { finish(result({ patch: '+late-closed-page' })); });
    expect(renderedText()).not.toContain('+late-closed-page');
    expect(renderedText()).toContain('正在读取差异');
    act(() => renderer!.unmount()); renderer = undefined;
    expect(unmountSignal.aborted).toBe(true);
  });

  it('bounds continuation requests to 16 real Run IDs and discloses the limited scope', async () => {
    const runIds = Array.from({ length: 20 }, (_, index) => `run-${index}`);
    list.mockResolvedValue(summary([]));
    await act(async () => { renderer = TestRenderer.create(<AgentFileChanges {...props} runIds={runIds}
      activities={[{ ...activity, runId: 'run-19' }]} />); });
    await open();
    expect(list.mock.lastCall![0].runIds).toEqual(runIds.slice(-16));
    expect(renderedText()).toContain('最近 16 次执行');
  });
});
