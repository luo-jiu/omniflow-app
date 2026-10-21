import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Popover } from '@douyinfe/semi-ui';
import type { AgentAppContext, AgentSessionSummary } from '@/shared/agent/agent.types';
import type { SelectedTreeNode } from '@/features/file-explorer';
import { resolveTreeSelection } from '@/features/file-explorer/components/directory-tree/utils/tree-selection';
import AgentWorkspace from './AgentWorkspace';

const mocks = vi.hoisted(() => ({
  organize: vi.fn(), updateSessionInfo: vi.fn(), stop: vi.fn(),
  computerControls: vi.fn(), refreshGroups: vi.fn(), toastError: vi.fn(), sessionOptions: vi.fn(),
}));

vi.mock('@douyinfe/semi-ui', () => ({
  Popover: ({ children, content, visible }: {
    children: React.ReactNode; content: React.ReactNode; visible: boolean;
  }) => <>{children}{visible ? content : null}</>,
  Toast: { error: mocks.toastError, warning: vi.fn(), info: vi.fn() },
}));
vi.mock('@douyinfe/semi-icons', () => ({
  IconShieldStroked: () => null, IconTick: () => null,
  IconSend: () => null, IconStop: () => null,
}));
vi.mock('@/components/ui/outline-icon', () => ({ default: () => null }));
vi.mock('@/components/ui/compact-confirm', () => ({ openCompactConfirm: vi.fn() }));
vi.mock('@/features/file-explorer/services/tree-locate', () => ({ locateNodeInDirectoryTree: vi.fn() }));
vi.mock('@/features/ai-services/ai-service.api', () => ({
  fetchAIServiceProfiles: vi.fn(async () => ({ activeProfileId: 'profile', profiles: [{ id: 'profile' }] })),
  fetchActiveAIServiceModels: vi.fn(async () => ['model']),
}));
vi.mock('@/features/ai-services/components/AIModelSettingsControl', () => ({ default: () => null }));
vi.mock('./components/AgentMemoryManager', () => ({ default: () => null }));
vi.mock('./components/AgentSessionManager', () => ({ default: () => null }));
vi.mock('./components/AgentTimeline', () => ({ default: () => null }));
vi.mock('./components/AgentSessionPeek', () => ({ default: () => null }));
vi.mock('./components/AgentConversationIndex', () => ({ default: () => null }));
vi.mock('./components/AgentSessionGroupEditor', () => ({ default: () => null }));
vi.mock('./components/AgentSessionGroupPicker', () => ({ default: () => null }));
vi.mock('./components/AgentAttachmentStrip', () => ({ AgentAttachmentStrip: () => null }));
vi.mock('./hooks/useAgentWorkspaceRendering', () => ({ useAgentWorkspaceRendering: vi.fn() }));
vi.mock('./hooks/useAgentComposerAutoHeight', () => ({ useAgentComposerAutoHeight: vi.fn() }));
vi.mock('./hooks/useAgentComposerDockMetrics', () => ({ useAgentComposerDockMetrics: vi.fn() }));
vi.mock('./hooks/useAgentComputerControls', () => ({
  useAgentComputerControls: mocks.computerControls, isAgentComputerRunCurrent: () => true,
}));
vi.mock('./hooks/useAgentSessionGroups', () => ({
  useAgentSessionGroups: () => ({
    summary: { groups: [], total: 0, archivedCount: 0, ungroupedCount: 0 },
    pages: {}, loading: false, loadGroup: vi.fn(), refresh: mocks.refreshGroups,
  }),
}));
vi.mock('./hooks/useAgentMemories', () => ({ useAgentMemories: () => ({ memories: [], total: 0 }) }));
vi.mock('./hooks/useAgentSessionResume', () => ({ useAgentSessionResume: () => resume }));
vi.mock('./agent-model-preferences', () => ({
  loadAgentModelPreferences: () => ({ model: 'model', reasoningEffort: 'medium' }),
  saveAgentModelPreferences: vi.fn(),
}));
vi.mock('./agent-session-selection', () => ({
  loadAgentSessionSelection: vi.fn(), saveAgentSessionSelection: vi.fn(),
}));
vi.mock('./services/agent.api', () => ({
  organizeAgentSession: mocks.organize,
  listAgentSessions: vi.fn(async () => ({ sessions: [], total: 0 })),
  deleteAgentSession: vi.fn(), getAgentSession: vi.fn(), archiveAgentSession: vi.fn(),
  saveAgentSessionGroup: vi.fn(), deleteAgentSessionGroup: vi.fn(), renameAgentSession: vi.fn(),
}));
vi.mock('./hooks/useAgentSession', () => ({
  useAgentSession: function useMockSession(options: { appContext: AgentAppContext }) {
    mocks.sessionOptions(options);
    const [, refresh] = React.useReducer(value => value + 1, 0);
    return {
      ...currentSession,
      updateSessionInfo: (value: AgentSessionSummary) => {
        mocks.updateSessionInfo(value);
        currentSession = { ...currentSession, sessionInfo: value };
        refresh();
      },
    };
  },
}));

const ownerScope = { accountScope: 'test-account', backendScope: 'test-backend' };
const workspaceProps: React.ComponentProps<typeof AgentWorkspace> = {
  ownerScope, libraryId: 3, rootNodeId: 1, firstSelectedTreeNode: null, selectedNodeIds: [], selectedTreeNode: null,
};
const resume = { loading: false, failed: false, select: vi.fn(), retry: vi.fn() };
const treeNodes: SelectedTreeNode[] = [
  { id: 11, key: 'root:11', libraryId: 3, parentId: 20, type: 'file', name: 'main', ext: 'cpp' },
  { id: 12, key: 'root:12', libraryId: 3, parentId: 1, type: 'dir', name: '源码' },
  { id: 13, key: 'root:13', libraryId: 3, parentId: 20, type: 'file', name: 'notes.md', ext: 'md' },
  { id: 14, key: 'root:14', libraryId: 3, parentId: 1, type: 'dir', name: '资料' },
];

function summary(id: string): AgentSessionSummary {
  return {
    id, libraryId: 3, title: id, permissionMode: 'ask', groupId: null, revision: 1,
    createdAt: '2026-10-21T00:00:00Z', updatedAt: '2026-10-21T00:00:00Z',
    lastMessagePreview: '', messageCount: 0,
  };
}

function session(id: string) {
  return {
    sessionId: id as string | null, sessionInfo: summary(id) as AgentSessionSummary | null,
    isBusy: true, isStreaming: true, isPreparing: false,
    draft: '', attachments: { entries: [], ready: true },
    messages: [], runs: [], toolActivities: [],
    approvalBusyIds: new Set(), interactionBusyIds: new Set(), receiptBusyIds: new Set(),
    resumableRunId: null, error: null, warning: null,
    restore: vi.fn(), reset: vi.fn(), submit: vi.fn(), continueTask: vi.fn(), stop: mocks.stop,
    setDraft: vi.fn(), readComputerDraft: vi.fn(), compareAndSetComputerDraft: vi.fn(),
    resolveApproval: vi.fn(), submitInteraction: vi.fn(), reconcileOperation: vi.fn(),
  };
}

function deferred() {
  let resolve!: (value: AgentSessionSummary) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<AgentSessionSummary>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

let currentSession = session('session-a');
let renderer: TestRenderer.ReactTestRenderer | undefined;

async function renderWorkspace(overrides: Partial<typeof workspaceProps> = {}) {
  await act(async () => { renderer = TestRenderer.create(<AgentWorkspace {...workspaceProps} {...overrides} />); });
}

function updateTreeSelection(selectedNodeIds: number[]) {
  const primaryId = selectedNodeIds.at(-1);
  const selectedTreeNode = treeNodes.find(node => node.id === primaryId) || null;
  const firstSelectedTreeNode = treeNodes.find(node => node.id === selectedNodeIds[0]) || null;
  act(() => renderer!.update(<AgentWorkspace {...workspaceProps}
    selectedNodeIds={selectedNodeIds} selectedTreeNode={selectedTreeNode} firstSelectedTreeNode={firstSelectedTreeNode} />));
}

function appContext(): AgentAppContext {
  return mocks.sessionOptions.mock.lastCall?.[0].appContext;
}

function expectSelectionLabel(label: string) {
  const renderedLabel = renderer!.root.findByProps({ className: 'agent-context-label' });
  const text = renderedLabel.findByProps({ className: 'agent-context-text' }).children.join('');
  const suffix = renderedLabel.findAllByProps({ className: 'agent-context-suffix' })[0]?.children.join('') || '';
  expect(text + suffix).toBe(label);
  expect(renderedLabel.props.title).toBe(label);
}

function permissionTrigger() {
  return renderer!.root.find(node => node.type === 'button'
    && String(node.props['aria-label']).startsWith('Agent 权限模式：'));
}

function chooseFullAccess() {
  expect(permissionTrigger().props.disabled).toBe(false);
  act(() => renderer!.root.findByType(Popover).props.onVisibleChange(true));
  act(() => renderer!.root.findAllByProps({ role: 'menuitemradio' }).at(-1)!.props.onClick());
}

function expectCurrentRunControlsAvailable() {
  expect(mocks.computerControls.mock.lastCall?.[0].blocked).toBe(false);
  const stop = renderer!.root.findByProps({ 'aria-label': '停止 Agent' });
  expect(stop.props.disabled).toBe(false);
  const preventDefault = vi.fn();
  act(() => stop.props.onClick({ preventDefault }));
  expect(preventDefault).toHaveBeenCalledOnce();
  expect(mocks.stop).toHaveBeenCalledOnce();
}

describe('AgentWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.organize.mockReset();
    vi.useFakeTimers();
    vi.stubGlobal('window', {
      electronWindow: { platform: 'darwin' },
      addEventListener: vi.fn(), removeEventListener: vi.fn(), setTimeout, clearTimeout,
    });
    resume.loading = false;
    currentSession = session('session-a');
  });

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('allows a running session to change permissions, preserving current Run controls while saving', async () => {
    const request = deferred();
    mocks.organize.mockReturnValueOnce(request.promise);
    await renderWorkspace();
    chooseFullAccess();
    expect(mocks.organize).toHaveBeenCalledWith(ownerScope, 3, 'session-a', {
      revision: 1, groupId: null, permissionMode: 'full-access',
    });
    expect(permissionTrigger().props.disabled).toBe(true);
    expect(permissionTrigger().props['aria-label']).toBe('Agent 权限模式：询问访问');
    expect(mocks.updateSessionInfo).not.toHaveBeenCalled();
    expectCurrentRunControlsAvailable();

    const updated = { ...summary('session-a'), permissionMode: 'full-access' as const, revision: 2 };
    await act(async () => { request.resolve(updated); });
    expect(mocks.updateSessionInfo.mock.calls).toEqual([[updated]]);
    expect(mocks.refreshGroups).toHaveBeenCalledOnce();
    expect(permissionTrigger().props.disabled).toBe(false);
    expect(permissionTrigger().props['aria-label']).toBe('Agent 权限模式：完全访问');
  });

  it('keeps the authoritative value on failure and releases saving so the user can retry', async () => {
    const failed = deferred();
    mocks.organize.mockReturnValueOnce(failed.promise);
    await renderWorkspace();
    chooseFullAccess();
    await act(async () => { failed.reject(new Error('权限保存失败')); });
    expect(mocks.toastError.mock.calls).toEqual([['权限保存失败']]);
    expect(mocks.updateSessionInfo).not.toHaveBeenCalled();
    expect(permissionTrigger().props['aria-label']).toBe('Agent 权限模式：询问访问');
    expect(permissionTrigger().props.disabled).toBe(false);

    mocks.organize.mockResolvedValueOnce({ ...summary('session-a'), permissionMode: 'full-access', revision: 2 });
    chooseFullAccess();
    await act(async () => {});
    expect(mocks.organize).toHaveBeenCalledTimes(2);
    expect(permissionTrigger().props['aria-label']).toBe('Agent 权限模式：完全访问');
  });

  it.each(['resolve', 'reject'] as const)('ignores a late %s after A → B → A without unlocking the new save', async (outcome) => {
    const oldRequest = deferred();
    const newRequest = deferred();
    mocks.organize.mockReturnValueOnce(oldRequest.promise).mockReturnValueOnce(newRequest.promise);
    await renderWorkspace();
    chooseFullAccess();
    act(() => { currentSession = session('session-b'); renderer!.update(<AgentWorkspace {...workspaceProps} />); });
    expect(permissionTrigger().props.disabled).toBe(false);
    act(() => { currentSession = session('session-a'); renderer!.update(<AgentWorkspace {...workspaceProps} />); });
    chooseFullAccess();
    await act(async () => {
      if (outcome === 'resolve') oldRequest.resolve({ ...summary('session-a'), revision: 2 });
      else oldRequest.reject(new Error('迟到的旧请求失败'));
    });
    expect(mocks.updateSessionInfo).not.toHaveBeenCalled();
    expect(mocks.toastError).not.toHaveBeenCalled();
    expect(mocks.refreshGroups).not.toHaveBeenCalled();
    expect(permissionTrigger().props.disabled).toBe(true);
    expect(permissionTrigger().props['aria-label']).toBe('Agent 权限模式：询问访问');
    expectCurrentRunControlsAvailable();

    const updated = { ...summary('session-a'), permissionMode: 'full-access' as const, revision: 3 };
    await act(async () => { newRequest.resolve(updated); });
    expect(mocks.updateSessionInfo.mock.calls).toEqual([[updated]]);
    expect(permissionTrigger().props.disabled).toBe(false);
    expect(permissionTrigger().props['aria-label']).toBe('Agent 权限模式：完全访问');
  });

  it.each(['preparing', 'restoring', 'missing metadata'] as const)('disables permission changes while %s', async (state) => {
    if (state === 'preparing') currentSession.isPreparing = true;
    if (state === 'restoring') resume.loading = true;
    if (state === 'missing metadata') currentSession.sessionInfo = null;
    await renderWorkspace();
    expect(permissionTrigger().props.disabled).toBe(true);
    expect(mocks.organize).not.toHaveBeenCalled();
  });

  it.each([
    { node: treeNodes[0], label: '选中：main.cpp', directory: { id: 20, name: '当前目录' } },
    { node: treeNodes[1], label: '选中：源码', directory: { id: 12, name: '源码' } },
    { node: treeNodes[2], label: '选中：notes.md', directory: { id: 20, name: '当前目录' } },
  ])('shows the single selection as $label and preserves its current directory', async ({ node, label, directory }) => {
    await renderWorkspace({ selectedTreeNode: node, selectedNodeIds: [node.id] });
    expectSelectionLabel(label);
    expect(appContext().selectedNodeIds).toEqual([node.id]);
    expect(appContext().currentDirectory).toEqual(directory);
  });

  it('passes a Shift range containing a folder and immediately updates when the range changes', async () => {
    await renderWorkspace({ selectedTreeNode: treeNodes[0], selectedNodeIds: [11] });
    const range = resolveTreeSelection({
      visibleNodes: treeNodes, targetKey: 'root:13', anchorKey: 'root:11',
      selectedNodeIds: [11], withRange: true, withToggle: false,
    })!;
    expect(range.selectedNodeIds).toEqual([11, 12, 13]);
    updateTreeSelection(range.selectedNodeIds);
    expectSelectionLabel('选中：main.cpp 等');
    expect(appContext().selectedNodeIds).toEqual([11, 12, 13]);
    expect(appContext().currentDirectory).toEqual({ id: 20, name: '当前目录' });

    const previousContext = appContext();
    const changed = resolveTreeSelection({
      visibleNodes: treeNodes, targetKey: 'root:11', anchorKey: range.anchorKey,
      selectedNodeIds: range.selectedNodeIds, withRange: false, withToggle: true,
    })!;
    updateTreeSelection(changed.selectedNodeIds);
    expectSelectionLabel('选中：源码 等');
    expect(appContext()).not.toBe(previousContext);
    expect(appContext().selectedNodeIds).toEqual([12, 13]);
    expect(previousContext.selectedNodeIds).toEqual([11, 12, 13]);
    expect(appContext().currentDirectory).toEqual({ id: 20, name: '当前目录' });

    const single = resolveTreeSelection({
      visibleNodes: treeNodes, targetKey: 'root:14', anchorKey: changed.anchorKey,
      selectedNodeIds: changed.selectedNodeIds, withRange: false, withToggle: false,
    })!;
    updateTreeSelection(single.selectedNodeIds);
    expectSelectionLabel('选中：资料');
    expect(appContext().selectedNodeIds).toEqual([14]);
    expect(appContext().currentDirectory).toEqual({ id: 14, name: '资料' });
  });

  it('passes Cmd discrete selections and clears the current context as nodes are deselected', async () => {
    await renderWorkspace({ selectedTreeNode: treeNodes[0], selectedNodeIds: [11] });
    const multiple = resolveTreeSelection({
      visibleNodes: treeNodes, targetKey: 'root:14', anchorKey: 'root:11',
      selectedNodeIds: [11], withRange: false, withToggle: true,
    })!;
    expect(multiple.selectedNodeIds).toEqual([11, 14]);
    updateTreeSelection(multiple.selectedNodeIds);
    expectSelectionLabel('选中：main.cpp 等');
    expect(appContext().selectedNodeIds).toEqual([11, 14]);
    expect(appContext().currentDirectory).toEqual({ id: 14, name: '资料' });

    const single = resolveTreeSelection({
      visibleNodes: treeNodes, targetKey: 'root:11', anchorKey: multiple.anchorKey,
      selectedNodeIds: multiple.selectedNodeIds, withRange: false, withToggle: true,
    })!;
    updateTreeSelection(single.selectedNodeIds);
    expectSelectionLabel('选中：资料');
    expect(appContext().selectedNodeIds).toEqual([14]);
    expect(appContext().currentDirectory).toEqual({ id: 14, name: '资料' });

    const empty = resolveTreeSelection({
      visibleNodes: treeNodes, targetKey: 'root:14', anchorKey: single.anchorKey,
      selectedNodeIds: single.selectedNodeIds, withRange: false, withToggle: true,
    })!;
    updateTreeSelection(empty.selectedNodeIds);
    expectSelectionLabel('选中：资料库根目录');
    expect(appContext().selectedNodeIds).toEqual([]);
    expect(appContext().currentDirectory).toEqual({ id: 1, name: '资料库根目录' });
  });
});
