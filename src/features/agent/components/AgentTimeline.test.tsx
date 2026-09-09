import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  AgentAssistantItemSnapshot,
  AgentToolActivitySnapshot,
  AgentRunSnapshot,
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
  it.each(['running', 'preparing', 'awaiting_approval', 'awaiting_interaction', 'cancelled', 'failed', 'interrupted', 'completed'] as const)(
    'keeps %s without a final answer visible and removes the fold control even on reload', status => {
      const run: AgentRunSnapshot = {
        id: `no-final-${status}`, sessionId: `no-final-${status}`, model: 'test', profileId: 'test', reasoningEffort: 'medium',
        revision: 1, status, userPrompt: 'test', createdAt: '2026-09-09T00:00:00Z', updatedAt: '2026-09-09T00:01:28Z',
      };
      const props = { approvalBusyIds: new Set<string>(), interactionBusyIds: new Set<string>(), libraryId: 3,
        ownerScope: null, onResolveApproval: vi.fn(), runs: [run],
        messages: [{ ...commentary(), runId: run.id, sessionId: run.sessionId }], toolActivities: [] };
      let renderer!: TestRenderer.ReactTestRenderer;
      act(() => { renderer = TestRenderer.create(<AgentTimeline {...props} />); });
      renderers.push(renderer);
      expect(renderer.root.findByProps({ 'data-agent-elapsed': run.id }).findAllByType('button')).toHaveLength(0);
      expect(renderer.root.findAll(node => node.type === 'div' && node.props.className === 'agent-timeline-entry' && node.props['aria-hidden'] === true)).toHaveLength(0);
      if (status === 'cancelled') expect(JSON.stringify(renderer.toJSON())).toContain('你在 1m 28s 停止了任务');
    },
  );

  it('starts restored final answers collapsed and preserves manual expansion across page remounts', () => {
    const run: AgentRunSnapshot = {
      id: 'restored-failure', sessionId: 'expansion-persistence', model: 'test', profileId: 'test', reasoningEffort: 'medium',
      revision: 1, status: 'completed', userPrompt: 'test',
      createdAt: '2026-09-08T00:00:00Z', updatedAt: '2026-09-08T00:00:10Z',
    };
    const props = {
      approvalBusyIds: new Set<string>(), interactionBusyIds: new Set<string>(), libraryId: 3,
      ownerScope: null, onResolveApproval: vi.fn(),
      messages: [{ ...commentary(), runId: run.id, sessionId: run.sessionId },
        { ...commentary(), id: 'restored-final', runId: run.id, sessionId: run.sessionId,
          assistantItem: { ...commentary().assistantItem, phase: 'final' as const }, content: '最终结果' }], runs: [run],
      toolActivities: [{ ...toolActivity(), runId: run.id, sessionId: run.sessionId, status: 'failed' as const }],
    };
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => { renderer = TestRenderer.create(<AgentTimeline {...props} />); });
    renderers.push(renderer);
    expect(renderer.root.findByProps({ 'aria-expanded': false })).toBeTruthy();
    act(() => renderer.root.findByProps({ 'aria-expanded': false }).props.onClick());
    act(() => renderer.update(<AgentTimeline {...props} runs={[{ ...run, revision: 2 }]} />));
    expect(renderer.root.findByProps({ 'aria-expanded': true })).toBeTruthy();
    act(() => renderer.unmount());
    act(() => { renderer = TestRenderer.create(<AgentTimeline {...props} />); });
    renderers.push(renderer);
    expect(renderer.root.findByProps({ 'aria-expanded': true })).toBeTruthy();
    expect(renderer.root.findAll(node => node.type === 'div' && node.props.className === 'agent-timeline-entry' && node.props['aria-hidden'] === true)).toHaveLength(0);
    act(() => renderer.update(<AgentTimeline {...props} libraryId={4} />));
    expect(renderer.root.findByProps({ 'aria-expanded': false })).toBeTruthy();
  });

  it('collapses only a successful finished process and expands it without remounting tools', () => {
    const run: AgentRunSnapshot = {
      id: 'run-1', sessionId: 'session-1', model: 'test', profileId: 'test', reasoningEffort: 'medium',
      revision: 1, status: 'running', userPrompt: 'test',
      createdAt: '2026-09-08T00:00:00Z', updatedAt: '2026-09-08T00:00:00Z',
    };
    const final: AgentAssistantItemSnapshot = {
      ...commentary(), id: 'final-1', content: '最终总结',
      assistantItem: { ...commentary().assistantItem, phase: 'final', status: 'completed', turnOrdinal: 2 },
    };
    const props = {
      approvalBusyIds: new Set<string>(), interactionBusyIds: new Set<string>(), libraryId: 3,
      ownerScope: null, onResolveApproval: vi.fn(), onToolExpand: vi.fn(),
      messages: [commentary(), final], runs: [run], toolActivities: [toolActivity()],
    };
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => { renderer = TestRenderer.create(<AgentTimeline {...props} />); });
    renderers.push(renderer);
    const tool = renderer.root.findByProps({ 'data-testid': 'tool-expand' });
    expect(renderer.root.findAll(node => node.type === 'div' && node.props.className === 'agent-timeline-entry' && node.props['aria-hidden'] === true)).toHaveLength(0);
    const completed = { ...run, status: 'completed' as const, finishedAt: '2026-09-08T00:01:02Z' };
    act(() => renderer.update(<AgentTimeline {...props} runs={[completed]} />));
    expect(renderer.root.findAll(node => node.type === 'div' && node.props.className === 'agent-timeline-entry' && node.props['aria-hidden'] === true)).toHaveLength(2);
    expect(renderer.root.findByProps({ 'data-testid': 'tool-expand' })).toBe(tool);
    act(() => renderer.root.findByProps({ 'aria-expanded': false }).props.onClick());
    expect(renderer.root.findAll(node => node.type === 'div' && node.props.className === 'agent-timeline-entry' && node.props['aria-hidden'] === true)).toHaveLength(0);
    expect(props.onToolExpand).toHaveBeenCalledOnce();
    expect(renderer.root.findByProps({ 'data-testid': 'tool-expand' })).toBe(tool);
    act(() => renderer.root.findByProps({ 'aria-expanded': true }).props.onClick());
    expect(renderer.root.findAll(node => node.type === 'div' && node.props.className === 'agent-timeline-entry' && node.props['aria-hidden'] === true)).toHaveLength(2);
    act(() => renderer.update(<AgentTimeline {...props} runs={[completed]}
      toolActivities={[{ ...toolActivity(), status: 'failed', result: { ok: false, message: '读取失败' } }]} />));
    expect(renderer.root.findAll(node => node.type === 'div' && node.props.className === 'agent-timeline-entry' && node.props['aria-hidden'] === true)).toHaveLength(2);
    act(() => renderer.root.findByProps({ 'aria-expanded': false }).props.onClick());
    expect(renderer.root.findAll(node => node.type === 'div' && node.props.className === 'agent-timeline-entry' && node.props['aria-hidden'] === true)).toHaveLength(0);
    act(() => renderer.update(<AgentTimeline {...props} runs={[completed]}
      toolActivities={[{ ...toolActivity(), status: 'awaiting_approval' }]} />));
    expect(renderer.root.findAll(node => node.type === 'div' && node.props.className === 'agent-timeline-entry' && node.props['aria-hidden'] === true)).toHaveLength(0);
    act(() => renderer.update(<AgentTimeline {...props} runs={[completed]}
      messages={[commentary()]} />));
    expect(renderer.root.findAll(node => node.type === 'div' && node.props.className === 'agent-timeline-entry' && node.props['aria-hidden'] === true)).toHaveLength(0);
    act(() => renderer.update(<AgentTimeline {...props} runs={[{ ...completed, status: 'interrupted' }]} />));
    expect(renderer.root.findAll(node => node.type === 'div' && node.props.className === 'agent-timeline-entry' && node.props['aria-hidden'] === true)).toHaveLength(0);
  });

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
