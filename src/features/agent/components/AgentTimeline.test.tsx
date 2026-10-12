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
}));

vi.mock('./AgentMessageContent', () => ({
  default: ({ content }: { content: string }) => <div>{content}</div>,
}));

vi.mock('./AgentToolActivityCard', () => ({
  default: ({ onExpand }: { onExpand?: () => void }) => (
    <button data-testid="tool-expand" onClick={onExpand} type="button">展开</button>
  ),
}));
vi.mock('./AgentToolActivityGroup', () => ({
  default: ({ activities, onExpand }: {
    activities: AgentToolActivitySnapshot[];
    onExpand?: () => void;
  }) => activities.map(activity => (
    <button data-testid="tool-expand" key={activity.id} onClick={onExpand} type="button">展开</button>
  )),
}));
vi.mock('./AgentAttachmentPreview', () => ({ default: () => null }));

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
  it('preserves one computer entry and the live status slot while a new scroll operation prepares', () => {
    const run: AgentRunSnapshot = { id: 'run-1', sessionId: 'session-1', model: 'test', profileId: 'test',
      reasoningEffort: 'medium', revision: 1, status: 'running', userPrompt: 'test',
      createdAt: '2026-09-10T00:00:00Z', updatedAt: '2026-09-10T00:00:00Z' };
    const observe: AgentToolActivitySnapshot = { ...toolActivity(),
      call: { id: 'observe', input: {}, name: 'computer.observe' },
      toolMetadata: { kind: 'business', risk: 'read', builtinComputerTool: 'observe' },
      preparation: { preparedActionId: 'prepared-observe', snapshotHash: 'a'.repeat(64), action: {
        kind: 'computer.observe', version: 2, libraryId: 3, targetId: '12022dc1-f61c-4c2a-aac6-2963b60e5f7a',
        applicationLabel: 'OmniFlow', windowLabel: 'Win Agent' } } };
    const preparing: AgentToolActivitySnapshot = { ...toolActivity(), id: 'scroll', ordinal: 2,
      call: { id: 'scroll', input: {}, name: 'computer.scroll' }, status: 'preparing',
      permissionBehavior: 'ask', result: undefined, toolMetadata: { kind: 'business', risk: 'write', builtinComputerTool: 'scroll' } };
    const props = { approvalBusyIds: new Set<string>(), interactionBusyIds: new Set<string>(), libraryId: 3,
      ownerScope: null, onResolveApproval: vi.fn(), messages: [], runs: [run], toolActivities: [observe] };
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => { renderer = TestRenderer.create(<AgentTimeline {...props} />); });
    renderers.push(renderer);
    const entries = () => renderer.root.findAll(node => node.type === 'div' && node.props.className === 'agent-timeline-entry');
    const slot = () => renderer.root.findAll(node => node.type === 'div' && node.props['data-agent-live-status-slot'])[0];
    expect(entries()).toHaveLength(1);
    const computerEntry = entries()[0];
    const statusSlot = slot();
    expect(statusSlot.props['data-agent-live-status']).toBe('working');
    act(() => renderer.update(<AgentTimeline {...props} runs={[{ ...run, status: 'preparing', revision: 2 }]}
      toolActivities={[observe, preparing]} />));
    expect(entries()).toEqual([computerEntry]);
    expect(slot()).toBe(statusSlot);
    expect(statusSlot.props['aria-hidden']).toBe(true);
    expect(statusSlot.findAllByType('span')).toHaveLength(0);
    const scroll: AgentToolActivitySnapshot = { ...preparing, status: 'running', permissionBehavior: 'allow',
      preparation: { preparedActionId: 'prepared-scroll', snapshotHash: 'a'.repeat(64), action: {
        kind: 'computer.scroll', version: 1, libraryId: 3, targetId: '12022dc1-f61c-4c2a-aac6-2963b60e5f7a',
        applicationLabel: 'OmniFlow', windowLabel: 'Win Agent', observationId: '237e3952-2a40-4c7b-b2f4-bec335a79cce',
        elementId: 'b5de6d3f-b8ec-4e73-a6be-81b717adf7ba', direction: 'up', unit: 'page' } } };
    act(() => renderer.update(<AgentTimeline {...props} toolActivities={[observe, scroll]} />));
    expect(entries()).toEqual([computerEntry]);
    expect(slot()).toBe(statusSlot);
    act(() => renderer.update(<AgentTimeline {...props} toolActivities={[observe, { ...scroll, status: 'completed', result: { ok: true } }]} />));
    expect(entries()).toEqual([computerEntry]);
    expect(slot()).toBe(statusSlot);
    expect(statusSlot.props['data-agent-live-status']).toBe('working');
    expect(statusSlot.props['aria-hidden']).toBeUndefined();
    act(() => renderer.update(<AgentTimeline {...props} runs={[{ ...run, status: 'completed' }]} />));
    expect(slot()).toBeUndefined();
  });

  it('shows a continued task as one question and collapses all attempts under one final result', () => {
    const stopped: AgentRunSnapshot = {
      id: 'continued-root', sessionId: 'continued-session', model: 'test', profileId: 'test', reasoningEffort: 'medium',
      revision: 1, status: 'cancelled', userPrompt: '整理文件',
      createdAt: '2026-09-12T00:00:00Z', updatedAt: '2026-09-12T00:00:10Z', finishedAt: '2026-09-12T00:00:10Z',
    };
    const resumed: AgentRunSnapshot = { ...stopped, id: 'continued-final', resumesRunId: stopped.id, status: 'completed',
      createdAt: '2026-09-12T01:00:00Z', updatedAt: '2026-09-12T01:00:20Z', finishedAt: '2026-09-12T01:00:20Z' };
    const question = { id: 'continued-question', role: 'user' as const, runId: stopped.id, sessionId: stopped.sessionId,
      createdAt: stopped.createdAt, content: '整理文件' };
    const final = { ...commentary(), id: 'continued-answer', runId: resumed.id, sessionId: stopped.sessionId,
      createdAt: resumed.finishedAt!, content: '统一最终结果', assistantItem: { ...commentary().assistantItem, phase: 'final' as const } };
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => { renderer = TestRenderer.create(<AgentTimeline approvalBusyIds={new Set()} interactionBusyIds={new Set()}
      libraryId={3} ownerScope={null} onResolveApproval={vi.fn()} runs={[stopped, resumed]}
      messages={[question, { ...commentary(), runId: stopped.id, sessionId: stopped.sessionId, createdAt: '2026-09-12T00:00:01Z' },
        { ...question, id: 'continued-user-audit', runId: resumed.id, createdAt: resumed.createdAt }, final]}
      toolActivities={[{ ...toolActivity(), runId: stopped.id, sessionId: stopped.sessionId, createdAt: '2026-09-12T00:00:02Z' }]} />); });
    renderers.push(renderer);
    expect(renderer.root.findAll(node => node.type === 'div' && Boolean(node.props['data-agent-question']))).toHaveLength(1);
    const elapsed = renderer.root.findAll(node => node.type === 'div' && Boolean(node.props['data-agent-elapsed']));
    expect(elapsed).toHaveLength(1);
    expect(elapsed[0].findAllByType('span').some(node => node.children.includes('用时 30s'))).toBe(true);
    expect(renderer.root.findByProps({ 'aria-expanded': false })).toBeTruthy();
    expect(renderer.root.findAllByType(AgentMessageContent).some(node => node.props.content === '统一最终结果')).toBe(true);
    act(() => renderer.root.findByProps({ 'aria-expanded': false }).props.onClick());
    expect(renderer.root.findAll(node => node.type === 'div' && node.props.className === 'agent-timeline-entry' && node.props['aria-hidden'] === true)).toHaveLength(0);
  });

  it('shows plain thinking text without a leading icon during provider waiting', () => {
    const run: AgentRunSnapshot = { id: 'thinking', sessionId: 'thinking', model: 'test', profileId: 'test',
      reasoningEffort: 'medium', revision: 1, status: 'running', userPrompt: 'test',
      createdAt: '2026-09-10T00:00:00Z', updatedAt: '2026-09-10T00:00:00Z' };
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => { renderer = TestRenderer.create(<AgentTimeline approvalBusyIds={new Set()} interactionBusyIds={new Set()}
      libraryId={3} ownerScope={null} onResolveApproval={vi.fn()} messages={[]} runs={[run]} toolActivities={[]} />); });
    renderers.push(renderer);
    const status = renderer.root.findByProps({ 'data-agent-live-status': 'working' });
    expect(status.findAllByType('span').some(node => node.children.includes('正在思考'))).toBe(true);
    expect(status.findAllByType('svg')).toHaveLength(0);
    const empty = { ...commentary(), id: 'thinking-item', runId: run.id, sessionId: run.sessionId, content: '',
      assistantItem: { ...commentary().assistantItem, phase: 'unknown' as const, status: 'streaming' as const } };
    const renderMessage = (content: string) => <AgentTimeline approvalBusyIds={new Set()} interactionBusyIds={new Set()}
      libraryId={3} ownerScope={null} onResolveApproval={vi.fn()} messages={[{ ...empty, content }]} runs={[run]} toolActivities={[]} />;
    act(() => renderer.update(renderMessage('')));
    const entry = renderer.root.findByProps({ className: 'agent-timeline-entry' });
    expect(entry.props['data-empty']).toBe(true);
    act(() => renderer.update(renderMessage('开始回复')));
    expect(renderer.root.findByProps({ className: 'agent-timeline-entry' })).toBe(entry);
    expect(entry.props['data-empty']).toBeUndefined();
    expect(renderer.root.findAllByProps({ 'data-agent-live-status': 'working' })).toHaveLength(0);
  });
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
