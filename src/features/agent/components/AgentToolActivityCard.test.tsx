import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  AgentOwnerScope,
  AgentShellPreparedActionPublicV1,
  AgentToolActivitySnapshot,
} from '@/shared/agent/agent.types';
import type { AgentShellLogPageV1 } from '@/shared/agent/shell/agent-shell.types';
import { readAgentShellLogPage } from '../services/agent.api';
import AgentToolActivityCard from './AgentToolActivityCard';

vi.mock('@douyinfe/semi-icons', () => ({
  IconAlertCircle: () => null,
  IconChevronDown: () => null,
  IconChevronRight: () => null,
  IconFile: () => null,
  IconFolder: () => null,
  IconSpin: () => null,
  IconTickCircle: () => null,
}));

vi.mock('../services/agent.api', () => ({
  readAgentShellLogPage: vi.fn(),
}));

vi.mock('./AgentConfirmationCard', () => ({
  default: () => React.createElement('div', { 'data-testid': 'confirmation-card' }),
}));

vi.mock('./AgentInteractionBlock', () => ({
  default: () => null,
}));

const OWNER_SCOPE: AgentOwnerScope = {
  accountScope: 'account-7',
  backendScope: 'https://api.example.test',
};
const renderers: TestRenderer.ReactTestRenderer[] = [];
const readShellLogPageMock = vi.mocked(readAgentShellLogPage);

function shellAction(command = 'pwd\nprintf "done"'): AgentShellPreparedActionPublicV1 {
  return {
    aiDestination: {
      identityHash: `v1:${'a'.repeat(64)}`,
      profileLabel: 'Local AI',
      providerType: 'openai',
    },
    assessment: {
      facets: ['filesystem.read', 'process_launch'],
      operations: [{ argvPrefix: [], effects: ['filesystem.read'], executable: 'pwd' }],
      persistentRuleEligible: false,
      risk: 'read',
      unresolved: [],
    },
    command,
    commandHash: `sha256:${'b'.repeat(64)}`,
    cwd: { kind: 'run-workspace', path: 'work' },
    dataScope: { stagedInputs: [], unresolvedWorkspaceRead: false },
    environment: [],
    kind: 'shell.run',
    provider: { dialect: 'zsh', id: 'system-zsh', version: '5.9' },
    timeoutMs: 10_000,
    version: 1,
  };
}

function shellActivity(
  overrides: Partial<AgentToolActivitySnapshot> = {},
): AgentToolActivitySnapshot {
  return {
    call: { id: 'call-1', input: { command: 'untrusted call input' }, name: 'shell.run' },
    createdAt: '2026-09-02T00:00:00.000Z',
    finishedAt: '2026-09-02T00:00:01.000Z',
    id: 'tool-run-1',
    ordinal: 1,
    permissionBehavior: 'allow',
    preparation: {
      action: shellAction(),
      preparedActionId: 'prepared-1',
      snapshotHash: 'c'.repeat(64),
    },
    result: {
      data: {
        durationMs: 13,
        exitCode: 0,
        previewTruncated: true,
        stderrTail: 'must stay hidden',
        stdoutTail: 'must stay hidden',
      },
      message: 'Shell 命令执行完成',
      ok: true,
    },
    revision: 2,
    runId: 'run-1',
    sessionId: 'session-1',
    status: 'completed',
    ...overrides,
  };
}

function logPage(overrides: Partial<AgentShellLogPageV1> = {}): AgentShellLogPageV1 {
  return {
    availableRanges: [{ firstSequence: 1, lastSequence: 1 }],
    executionId: 'execution-1',
    expired: false,
    frames: [{
      executionId: 'execution-1',
      observedAt: '2026-09-02T00:00:00.100Z',
      sequence: 1,
      stream: 'stdout',
      text: 'first page\n',
    }],
    nextAvailableSequence: null,
    pageFirstSequence: 1,
    pageLastSequence: 1,
    requestedAfter: null,
    unavailableThrough: null,
    ...overrides,
  };
}

function renderCard(
  activity: AgentToolActivitySnapshot,
  ownerScope: AgentOwnerScope | null = OWNER_SCOPE,
) {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(cardElement(activity, ownerScope));
  });
  renderers.push(renderer);
  return renderer;
}

function cardElement(
  activity: AgentToolActivitySnapshot,
  ownerScope: AgentOwnerScope | null = OWNER_SCOPE,
  libraryId = 3,
) {
  return React.createElement(AgentToolActivityCard, {
    activity,
    approvalBusy: false,
    interactionBusy: false,
    libraryId,
    onResolveApproval: vi.fn(),
    ownerScope,
  });
}

function textContent(instance: TestRenderer.ReactTestInstance): string {
  return instance.children.map(child => (
    typeof child === 'string' ? child : textContent(child)
  )).join('');
}

afterEach(() => {
  renderers.splice(0).forEach((renderer) => {
    act(() => renderer.unmount());
  });
  vi.clearAllMocks();
});

describe('AgentToolActivityCard Shell presentation', () => {
  it('renders a file read as one row with controlled node navigation and opt-in details', () => {
    const onAction = vi.fn();
    const activity: AgentToolActivitySnapshot = {
      call: { id: 'read-call', input: {}, name: 'file.stat' }, id: 'read-tool', ordinal: 1,
      createdAt: '2026-09-07T00:00:00Z',
      permissionBehavior: 'allow', revision: 1, runId: 'read-run', sessionId: 'read-session', status: 'completed',
      toolMetadata: { kind: 'business', risk: 'read', groupKind: 'resource-read', operationKind: 'stat' },
      result: { ok: true, message: 'private-to-details summary', data: { id: 8, name: 'agent-orchestrator.ts' } },
    };
    const renderer = TestRenderer.create(<AgentToolActivityCard activity={activity} approvalBusy={false} interactionBusy={false}
      libraryId={3} onAction={onAction} onResolveApproval={vi.fn()} ownerScope={OWNER_SCOPE} />);
    renderers.push(renderer);
    expect(textContent(renderer.root)).toContain('已读取agent-orchestrator.ts');
    expect(renderer.root.findAllByProps({ className: 'agent-activity-body' })).toHaveLength(0);
    act(() => renderer.root.findByProps({ className: 'agent-activity-subject' }).props.onClick());
    expect(onAction).toHaveBeenCalledWith({ action: 'tree.revealNode', label: 'agent-orchestrator.ts', libraryId: 3, nodeId: 8 });
    act(() => renderer.root.findByProps({ 'aria-label': '展开工具详情' }).props.onClick());
    expect(textContent(renderer.root)).toContain('private-to-details summary');
  });
  it('renders a borderless single-line summary without result metadata by default', () => {
    const renderer = renderCard(shellActivity());
    const summary = renderer.root.findByProps({ className: 'agent-shell-summary' });
    const text = textContent(renderer.root);

    expect(summary.type).toBe('button');
    expect(summary.props['aria-expanded']).toBe(false);
    expect(text).toContain('执行了');
    expect(text).toContain('pwd\\nprintf "done"');
    expect(text).not.toContain('耗时');
    expect(text).not.toContain('退出码');
    expect(text).not.toContain('输出截断');
    expect(text).not.toContain('must stay hidden');
    expect(renderer.root.findAllByType('article')).toHaveLength(0);
    expect(renderer.root.findAllByProps({ role: 'region' })).toHaveLength(0);
  });

  it('uses one safe whitespace-preserving command projection everywhere it exposes the command', async () => {
    const unsafeCommand = "  printf 'a  b'\tline\nnext\u001b\u202e  ";
    const expectedCommand = "  printf 'a  b'\\tline\\nnext\\u001b\\u202e  ";
    readShellLogPageMock.mockResolvedValueOnce(logPage());
    const renderer = renderCard(shellActivity({
      preparation: {
        action: shellAction(unsafeCommand),
        preparedActionId: 'prepared-1',
        snapshotHash: 'c'.repeat(64),
      },
    }));
    const summaryButton = renderer.root.findByProps({ className: 'agent-shell-summary' });
    const summaryCommand = renderer.root.findByProps({ className: 'agent-shell-summary-command' });

    expect(textContent(summaryCommand)).toBe(expectedCommand);
    expect(summaryCommand.props.title).toBe(expectedCommand);
    expect(summaryButton.props['aria-label']).toBe(`执行了 ${expectedCommand}`);
    expect(textContent(summaryCommand)).not.toContain("'a b'");

    await act(async () => {
      summaryButton.props.onClick();
    });
    expect(textContent(renderer.root.findByProps({ className: 'agent-shell-terminal-command' })))
      .toBe(`$ ${expectedCommand}`);
  });

  it('loads owner-bound log pages only after expansion and appends the next page', async () => {
    readShellLogPageMock
      .mockResolvedValueOnce(logPage({ nextCursor: 'cursor-2' }))
      .mockResolvedValueOnce(logPage({
        availableRanges: [{ firstSequence: 1, lastSequence: 2 }],
        frames: [{
          executionId: 'execution-1',
          observedAt: '2026-09-02T00:00:00.200Z',
          sequence: 2,
          stream: 'stderr',
          text: 'second page\n',
        }],
        pageFirstSequence: 2,
        pageLastSequence: 2,
        requestedAfter: 1,
      }));
    const renderer = renderCard(shellActivity());
    const summary = renderer.root.findByProps({ className: 'agent-shell-summary' });

    expect(readShellLogPageMock).not.toHaveBeenCalled();
    await act(async () => {
      summary.props.onClick();
    });

    expect(readShellLogPageMock).toHaveBeenNthCalledWith(1, {
      libraryId: 3,
      maxBytes: 128 * 1024,
      maxFrames: 128,
      ownerScope: OWNER_SCOPE,
      runId: 'run-1',
      sessionId: 'session-1',
      toolRunId: 'tool-run-1',
      version: 1,
    });
    const terminal = renderer.root.findByProps({
      'aria-label': 'Shell 输出',
      className: 'agent-shell-terminal',
      role: 'region',
    });
    expect(textContent(terminal)).toContain('first page');
    const more = renderer.root.findAllByType('button')
      .find(button => textContent(button) === '继续读取');

    await act(async () => {
      more?.props.onClick();
    });

    expect(readShellLogPageMock).toHaveBeenNthCalledWith(2, expect.objectContaining({
      cursor: 'cursor-2',
      ownerScope: OWNER_SCOPE,
      runId: 'run-1',
      sessionId: 'session-1',
      toolRunId: 'tool-run-1',
    }));
    expect(textContent(renderer.root.findByProps({ role: 'region' }))).toContain('first page');
    expect(textContent(renderer.root.findByProps({ role: 'region' }))).toContain('second page');
  });

  it('ignores an old log response after the rendered Tool activity changes', async () => {
    let resolveOldPage!: (page: AgentShellLogPageV1) => void;
    readShellLogPageMock
      .mockImplementationOnce(() => new Promise(resolve => { resolveOldPage = resolve; }))
      .mockResolvedValueOnce(logPage({
        executionId: 'execution-2',
        frames: [{
          executionId: 'execution-2',
          observedAt: '2026-09-02T00:00:02.000Z',
          sequence: 2,
          stream: 'stdout',
          text: 'new activity output\n',
        }],
        pageFirstSequence: 2,
        pageLastSequence: 2,
      }));
    const renderer = renderCard(shellActivity());
    await act(async () => {
      renderer.root.findByProps({ className: 'agent-shell-summary' }).props.onClick();
      await Promise.resolve();
    });

    const nextActivity = shellActivity({
      id: 'tool-run-2',
      runId: 'run-2',
      sessionId: 'session-2',
    });
    act(() => renderer.update(cardElement(nextActivity)));
    await act(async () => {
      renderer.root.findByProps({ className: 'agent-shell-summary' }).props.onClick();
    });
    expect(textContent(renderer.root.findByProps({ role: 'region' })))
      .toContain('new activity output');

    await act(async () => {
      resolveOldPage(logPage({
        frames: [{
          executionId: 'execution-1',
          observedAt: '2026-09-02T00:00:00.100Z',
          sequence: 1,
          stream: 'stdout',
          text: 'stale private output\n',
        }],
      }));
      await Promise.resolve();
    });

    expect(textContent(renderer.root)).not.toContain('stale private output');
    expect(textContent(renderer.root)).toContain('new activity output');
  });

  it('shows a stable error instead of rendering raw IPC failure details', async () => {
    readShellLogPageMock.mockRejectedValueOnce(
      new Error('ENOENT: /Users/private/Library/Application Support/OmniFlow/shell.log'),
    );
    const renderer = renderCard(shellActivity());

    await act(async () => {
      renderer.root.findByProps({ className: 'agent-shell-summary' }).props.onClick();
    });
    const text = textContent(renderer.root);

    expect(text).toContain('详细输出读取失败');
    expect(text).not.toContain('/Users/private');
    expect(text).not.toContain('ENOENT');
  });

  it('keeps a failed Shell execution visible without exposing result internals', () => {
    const activity = shellActivity({
      result: {
        data: { exitCode: 127, stderrTail: 'private stderr' },
        message: 'command failed',
        ok: false,
      },
      status: 'failed',
    });
    const renderer = renderCard(activity);
    const text = textContent(renderer.root);

    expect(text).toContain('执行失败');
    expect(text).toContain('pwd\\nprintf "done"');
    expect(text).not.toContain('command failed');
    expect(text).not.toContain('private stderr');
    expect(text).not.toContain('127');
  });

  it.each([
    ['missing owner scope', shellActivity(), null],
    ['missing result', shellActivity({ result: undefined, status: 'running' }), OWNER_SCOPE],
  ])('does not offer a false expansion when %s', (_label, activity, ownerScope) => {
    const renderer = renderCard(activity, ownerScope);

    expect(renderer.root.findAllByProps({ className: 'agent-shell-summary' })[0]?.type).toBe('div');
    expect(renderer.root.findAllByProps({ role: 'region' })).toHaveLength(0);
    expect(readShellLogPageMock).not.toHaveBeenCalled();
  });

  it('never falls back to untrusted call input when the prepared action is unavailable', () => {
    const activity = shellActivity({
      call: {
        id: 'call-1',
        input: { command: 'cat /private/secret-from-call-input' },
        name: 'shell.run',
      },
      preparation: undefined,
    });
    const renderer = renderCard(activity);
    const text = textContent(renderer.root);

    expect(text).toContain('Shell 命令');
    expect(text).not.toContain('/private/secret-from-call-input');
  });

  it('keeps a pending Shell approval on the confirmation-card path', () => {
    const activity = shellActivity({
      approval: {
        approvalId: 'approval-1',
        preview: {
          description: '运行准备好的命令',
          details: [],
          risk: 'read',
          title: '运行 Shell 命令',
        },
        status: 'pending',
      },
      result: undefined,
      status: 'awaiting_approval',
    });
    const renderer = renderCard(activity);

    expect(renderer.root.findAllByProps({ 'data-testid': 'confirmation-card' })).toHaveLength(1);
    expect(renderer.root.findAllByProps({ className: 'agent-shell-summary' })).toHaveLength(0);
  });
});
