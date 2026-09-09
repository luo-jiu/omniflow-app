import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  AgentAssistantItemSnapshot,
  AgentToolActivitySnapshot,
} from '@/shared/agent/agent.types';
import AgentTimeline from './AgentTimeline';
import AgentMessageContent from './AgentMessageContent';

vi.mock('@douyinfe/semi-icons', () => ({
  IconAlertCircle: () => null,
  IconShrink: () => null,
  IconMore: () => null,
}));

vi.mock('./AgentMessageContent', () => ({
  default: ({ content }: { content: string }) => <div>{content}</div>,
}));

vi.mock('./AgentToolActivityCard', () => ({
  default: ({ onExpand }: { onExpand?: () => void }) => (
    <button data-testid="tool-expand" onClick={onExpand} type="button">展开</button>
  ),
}));
vi.mock('./AgentToolActivityGroup', () => ({ default: () => null }));

const renderers: TestRenderer.ReactTestRenderer[] = [];

function commentary(): AgentAssistantItemSnapshot {
  return {
    assistantItem: {
      finishedAt: '2026-09-08T00:00:01.000Z',
      phase: 'commentary',
      revision: 2,
      status: 'completed',
      turnOrdinal: 1,
      updatedAt: '2026-09-08T00:00:01.000Z',
    },
    content: '我先读取相关文件。',
    createdAt: '2026-09-08T00:00:01.000Z',
    id: 'commentary-1',
    role: 'assistant',
    runId: 'run-1',
    sessionId: 'session-1',
  };
}

function toolActivity(): AgentToolActivitySnapshot {
  return {
    call: { id: 'call-1', input: {}, name: 'file.read' },
    createdAt: '2026-09-08T00:00:02.000Z',
    id: 'tool-1',
    ordinal: 1,
    permissionBehavior: 'allow',
    result: { message: '读取完成', ok: true },
    revision: 1,
    runId: 'run-1',
    sessionId: 'session-1',
    status: 'completed',
    toolMetadata: {
      kind: 'business',
      risk: 'read',
    },
  };
}

afterEach(() => {
  renderers.splice(0).forEach(renderer => act(() => renderer.unmount()));
});

describe('AgentTimeline commentary presentation', () => {
  it('renders process replies as icon-free conversation-like text', () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <AgentTimeline
          approvalBusyIds={new Set()}
          interactionBusyIds={new Set()}
          libraryId={3}
          messages={[commentary()]}
          onResolveApproval={vi.fn()}
          ownerScope={null}
          runs={[]}
          toolActivities={[]}
        />,
      );
    });
    renderers.push(renderer);

    const workItem = renderer.root.findByProps({ 'data-work-kind': 'commentary' });
    expect(workItem.props['data-variant']).toBe('work');
    expect(workItem.findByProps({ className: 'agent-work-item-content' }).findByType(AgentMessageContent).props.content)
      .toEqual('我先读取相关文件。');
    expect(workItem.findByProps({ className: 'agent-work-item-content' }).findByType(AgentMessageContent).findByType('div').children)
      .toEqual(['我先读取相关文件。']);
    expect(workItem.findAllByProps({ className: 'agent-work-item-icon' })).toHaveLength(0);
  });

  it('forwards tool expansion so the workspace can pause scroll following', () => {
    const onToolExpand = vi.fn();
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <AgentTimeline
          approvalBusyIds={new Set()}
          interactionBusyIds={new Set()}
          libraryId={3}
          messages={[]}
          onResolveApproval={vi.fn()}
          onToolExpand={onToolExpand}
          ownerScope={null}
          runs={[]}
          toolActivities={[toolActivity()]}
        />,
      );
    });
    renderers.push(renderer);

    act(() => renderer.root.findByProps({ 'data-testid': 'tool-expand' }).props.onClick());
    expect(onToolExpand).toHaveBeenCalledTimes(1);
  });
});
