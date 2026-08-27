import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  AgentChatStreamEvent,
  AgentMediaExtractAudioPreparedActionPublicV1,
  AgentRunSnapshot,
  AgentSessionSnapshot,
  AgentToolApprovalSnapshot,
  AgentToolActivitySnapshot,
} from '@/shared/agent/agent.types';
import { useAgentSession } from './useAgentSession';

const apiMocks = vi.hoisted(() => ({
  completeAgentToolExecution: vi.fn(),
  getAgentSession: vi.fn(),
  markAgentToolExecutionCommitted: vi.fn(),
  resolveAgentToolApproval: vi.fn(),
  startAgentChat: vi.fn(),
  stopAgentChat: vi.fn(),
  submitAgentInteraction: vi.fn(),
  subscribeAgentChat: vi.fn(),
}));

const contextMocks = vi.hoisted(() => ({
  readAgentPerception: vi.fn(),
}));

const executorMocks = vi.hoisted(() => ({
  executeAgentRendererTool: vi.fn(),
}));

vi.mock('../services/agent.api', () => apiMocks);
vi.mock('../services/agent-context.api', () => contextMocks);
vi.mock('../services/agent-tool-executor', () => executorMocks);

const OWNER_SCOPE = {
  accountScope: 'user:7',
  backendScope: 'http://127.0.0.1:8850/api',
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function run(revision: number, status: AgentRunSnapshot['status']): AgentRunSnapshot {
  return {
    createdAt: '2026-08-23T00:00:00.000Z',
    currentStep: status === 'running' ? '请求 AI 服务' : '等待确认',
    id: 'run-1',
    model: 'model-a',
    profileId: 'profile-a',
    reasoningEffort: 'medium',
    revision,
    sessionId: 'session-1',
    status,
    updatedAt: `2026-08-23T00:00:0${revision}.000Z`,
    userPrompt: '处理当前文件',
  };
}

function activity(
  revision: number,
  status: AgentToolActivitySnapshot['status'],
  planStepId?: string,
): AgentToolActivitySnapshot {
  return {
    call: { id: 'call-1', input: {}, name: 'file.list' },
    createdAt: '2026-08-23T00:00:00.000Z',
    id: 'activity-1',
    ordinal: 1,
    permissionBehavior: 'allow',
    ...(planStepId ? { planStepId } : {}),
    revision,
    runId: 'run-1',
    sessionId: 'session-1',
    status,
  };
}

function withPlan(snapshot: AgentRunSnapshot): AgentRunSnapshot {
  return {
    ...snapshot,
    plan: {
      createdAt: '2026-08-23T00:00:01.000Z',
      steps: [
        { expectedToolName: 'file.list', id: 'step-1', ordinal: 1, title: '读取目录' },
        { expectedToolName: 'file.stat', id: 'step-2', ordinal: 2, title: '检查文件' },
      ],
      title: '检查当前文件',
      version: 1,
    },
  };
}

function mediaPreparedAction(
  overrides: Partial<AgentMediaExtractAudioPreparedActionPublicV1> = {},
): AgentMediaExtractAudioPreparedActionPublicV1 {
  return {
    conflictPolicy: 'auto_rename',
    destination: 'library',
    fallbackPolicy: 'prompt_local',
    kind: 'media.extractAudio',
    libraryId: 3,
    outputFileName: 'movie-audio.m4a',
    outputFormat: 'm4a',
    parentId: 10,
    sourceNodeId: 8,
    targetLabel: '视频',
    version: 1,
    ...overrides,
  };
}

function sessionSnapshot(): AgentSessionSnapshot {
  return {
    createdAt: '2026-08-23T00:00:00.000Z',
    id: 'session-1',
    lastMessagePreview: '处理当前文件',
    lastRunStatus: 'running',
    libraryId: 3,
    messageCount: 1,
    messages: [{
      content: '处理当前文件',
      createdAt: '2026-08-23T00:00:00.000Z',
      id: 'message-1',
      role: 'user',
      runId: 'run-1',
      sessionId: 'session-1',
    }],
    runs: [run(1, 'running')],
    title: '处理当前文件',
    toolActivities: [activity(1, 'running')],
    updatedAt: '2026-08-23T00:00:01.000Z',
  };
}

function renderSessionHook() {
  let current: ReturnType<typeof useAgentSession> | null = null;
  const onSessionChanged = vi.fn();
  function Harness() {
    current = useAgentSession({
      appContext: {
        currentDirectory: { id: 10, name: '视频' },
        libraryId: 3,
        platform: 'darwin',
        selectedNodeIds: [],
      },
      model: 'model-a',
      onSessionChanged,
      ownerScope: OWNER_SCOPE,
      profileId: 'profile-a',
      reasoningEffort: 'medium',
    });
    return null;
  }

  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(React.createElement(Harness));
  });
  return {
    get current() {
      if (!current) throw new Error('Agent session hook was not rendered');
      return current;
    },
    onSessionChanged,
    unmount: () => act(() => renderer.unmount()),
  };
}

describe('useAgentSession event coordination', () => {
  let listener: ((event: AgentChatStreamEvent) => void) | null;

  beforeEach(() => {
    vi.clearAllMocks();
    listener = null;
    apiMocks.subscribeAgentChat.mockImplementation((nextListener) => {
      listener = nextListener;
      return vi.fn();
    });
    apiMocks.stopAgentChat.mockResolvedValue(true);
    apiMocks.completeAgentToolExecution.mockResolvedValue(true);
    apiMocks.markAgentToolExecutionCommitted.mockResolvedValue(true);
    contextMocks.readAgentPerception.mockResolvedValue({
      collectedAt: '2026-08-23T00:00:00.000Z',
      selectedNodes: [],
    });
  });

  it('applies events that arrive while a session snapshot is being restored', async () => {
    const snapshotRequest = deferred<AgentSessionSnapshot>();
    apiMocks.getAgentSession.mockReturnValue(snapshotRequest.promise);
    const hook = renderSessionHook();
    let restorePromise!: Promise<boolean>;

    act(() => {
      restorePromise = hook.current.restore('session-1');
    });
    expect(listener).not.toBeNull();
    act(() => {
      listener?.({
        run: withPlan(run(2, 'awaiting_approval')),
        runId: 'run-1',
        sessionId: 'session-1',
        type: 'run-updated',
      });
      const completedActivity = {
        ...activity(2, 'completed', 'step-1'),
        finishedAt: '2026-08-23T00:00:02.000Z',
        result: { message: '读取完成', ok: true },
      };
      listener?.({
        activity: completedActivity,
        call: completedActivity.call,
        result: completedActivity.result,
        runId: 'run-1',
        sessionId: 'session-1',
        type: 'tool-completed',
      });
    });

    await act(async () => {
      snapshotRequest.resolve(sessionSnapshot());
      await restorePromise;
    });

    expect(hook.current.runs).toEqual([withPlan(run(2, 'awaiting_approval'))]);
    expect(hook.current.toolActivities).toEqual([
      expect.objectContaining({
        planStepId: 'step-1',
        revision: 2,
        status: 'completed',
      }),
    ]);
    hook.unmount();
  });

  it('buffers started and Run updates that arrive before a new-session start returns', async () => {
    const startRequest = deferred<{ runId: string; sessionId: string }>();
    apiMocks.startAgentChat.mockReturnValue(startRequest.promise);
    const hook = renderSessionHook();
    let submitPromise!: Promise<void>;

    await act(async () => {
      submitPromise = hook.current.submit('处理当前文件');
      await Promise.resolve();
    });
    act(() => {
      listener?.({
        run: run(1, 'running'),
        runId: 'run-1',
        sessionId: 'session-1',
        type: 'started',
      });
      listener?.({
        delta: '工具调用前',
        runId: 'run-1',
        sessionId: 'session-1',
        type: 'delta',
      });
      listener?.({
        activity: activity(1, 'running'),
        call: activity(1, 'running').call,
        runId: 'run-1',
        sessionId: 'session-1',
        type: 'tool-started',
      });
      listener?.({
        delta: '工具调用后',
        runId: 'run-1',
        sessionId: 'session-1',
        type: 'delta',
      });
      listener?.({
        run: run(2, 'awaiting_approval'),
        runId: 'run-1',
        sessionId: 'session-1',
        type: 'run-updated',
      });
    });

    await act(async () => {
      startRequest.resolve({ runId: 'run-1', sessionId: 'session-1' });
      await submitPromise;
    });

    expect(hook.current.sessionId).toBe('session-1');
    expect(hook.current.runs).toEqual([run(2, 'awaiting_approval')]);
    expect(hook.current.messages.map(message => ({
      content: message.content,
      role: message.role,
      toolCallId: message.toolCallId,
    }))).toEqual([
      { content: '处理当前文件', role: 'user', toolCallId: undefined },
      { content: '工具调用前', role: 'assistant', toolCallId: undefined },
      { content: '正在调用 file.list', role: 'tool', toolCallId: 'call-1' },
      { content: '工具调用后', role: 'assistant', toolCallId: undefined },
    ]);
    expect(hook.onSessionChanged).toHaveBeenCalledWith('session-1');
    hook.unmount();
  });

  it('anchors a started Run to the optimistic user message before an existing-session start returns', async () => {
    apiMocks.getAgentSession.mockResolvedValue({
      ...sessionSnapshot(),
      lastRunStatus: 'completed',
      runs: [run(1, 'completed')],
    });
    const startRequest = deferred<{ runId: string; sessionId: string }>();
    apiMocks.startAgentChat.mockReturnValue(startRequest.promise);
    const hook = renderSessionHook();

    await act(async () => {
      await hook.current.restore('session-1');
    });
    let submitPromise!: Promise<void>;
    await act(async () => {
      submitPromise = hook.current.submit('继续处理');
      await Promise.resolve();
    });
    const nextRun = {
      ...run(1, 'running'),
      id: 'run-2',
      userPrompt: '继续处理',
    };
    act(() => {
      listener?.({
        run: nextRun,
        runId: 'run-2',
        sessionId: 'session-1',
        type: 'started',
      });
    });

    expect(hook.current.messages.at(-1)).toMatchObject({
      content: '继续处理',
      runId: 'run-2',
      sessionId: 'session-1',
    });
    expect(hook.current.runs.at(-1)).toEqual(nextRun);

    await act(async () => {
      startRequest.resolve({ runId: 'run-2', sessionId: 'session-1' });
      await submitPromise;
    });
    hook.unmount();
  });

  it('preserves fallback approval preparation and submits the edited discriminator unchanged', async () => {
    apiMocks.resolveAgentToolApproval.mockResolvedValue({ approved: false });
    apiMocks.getAgentSession.mockResolvedValue(sessionSnapshot());
    const hook = renderSessionHook();
    await act(async () => {
      await hook.current.restore('session-1');
    });
    const preparedAction = mediaPreparedAction();
    const approval: AgentToolApprovalSnapshot = {
      approvalId: 'approval-prepared',
      call: { id: 'call-prepared', input: {}, name: 'media.extractAudio' },
      preparation: {
        action: preparedAction,
        preparedActionId: 'prepared-action-1',
        snapshotHash: 'a'.repeat(64),
      },
      preview: {
        description: '从当前视频提取音频',
        risk: 'write',
        title: '提取音频',
      },
      runId: 'run-1',
      sessionId: 'session-1',
    };
    const preparation = approval.preparation;
    if (!preparation) throw new Error('expected prepared approval');

    act(() => {
      listener?.({
        approval,
        runId: approval.runId,
        sessionId: approval.sessionId,
        type: 'tool-approval-required',
      });
    });

    expect(hook.current.toolActivities).toEqual(expect.arrayContaining([
      expect.objectContaining({
        preparation,
        status: 'awaiting_approval',
      }),
    ]));
    const editedAction = mediaPreparedAction({
      outputFileName: 'renamed.mp3',
      outputFormat: 'mp3',
    });
    await act(async () => {
      await hook.current.resolveApproval(approval, true, editedAction);
    });

    expect(apiMocks.resolveAgentToolApproval).toHaveBeenCalledWith({
      approvalId: approval.approvalId,
      approved: true,
      libraryId: 3,
      ownerScope: OWNER_SCOPE,
      preparedAction: editedAction,
      preparedActionId: preparation.preparedActionId,
      runId: approval.runId,
      sessionId: approval.sessionId,
    });
    hook.unmount();
  });
});
