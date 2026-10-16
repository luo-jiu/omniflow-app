import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AgentToolActivitySnapshot } from '@/shared/agent/agent.types';
import AgentToolActivityGroup from './AgentToolActivityGroup';
import { useAgentToolDetailLayout } from '../agent-tool-detail-layout';

vi.mock('@douyinfe/semi-icons', () => ({
  IconChevronRightStroked: () => null,
  IconSearch: () => null,
}));

vi.mock('./AgentToolActivityCard', () => ({
  default: (props: DetailFixtureProps) => <DetailFixture {...props} />,
}));

interface DetailFixtureProps {
  activity: AgentToolActivitySnapshot;
  detailsVisible: boolean;
  onExpand?: () => void;
}

function DetailFixture({ activity, detailsVisible, onExpand }: DetailFixtureProps) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  const observation = activity.call.name === 'computer.observe';
  useAgentToolDetailLayout(ref, activity.id, observation && open && detailsVisible, observation);
  return <div data-activity-id={activity.id}>{activity.call.name}
    {observation ? <>
      <button data-observation-toggle={activity.id} onClick={() => { onExpand?.(); setOpen(value => !value); }} />
      <div ref={ref} data-layout-body={activity.id} />
    </> : null}
  </div>;
}

const renderers: TestRenderer.ReactTestRenderer[] = [];

function activity(
  id: string,
  ordinal: number,
  operationKind: NonNullable<AgentToolActivitySnapshot['toolMetadata']>['operationKind'],
): AgentToolActivitySnapshot {
  return {
    call: { id: `call-${id}`, input: {}, name: operationKind === 'search' ? 'file.search' : 'file.read' },
    createdAt: `2026-09-08T00:00:0${ordinal}.000Z`,
    id,
    ordinal,
    permissionBehavior: 'allow',
    result: { message: `${id} completed`, ok: true },
    revision: 1,
    runId: 'run-1',
    sessionId: 'session-1',
    status: 'completed',
    toolMetadata: {
      groupKind: 'resource-read',
      kind: 'business',
      operationKind,
      risk: 'read',
    },
  };
}

function textContent(instance: TestRenderer.ReactTestInstance): string {
  return instance.children.map(child => (
    typeof child === 'string' ? child : textContent(child)
  )).join('');
}

afterEach(() => {
  renderers.splice(0).forEach(renderer => act(() => renderer.unmount()));
  vi.unstubAllGlobals();
});

describe('AgentToolActivityGroup', () => {
  it('uses one muted read summary and reveals the ordered activities on demand', () => {
    const onExpand = vi.fn();
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <AgentToolActivityGroup
          activities={[
            activity('read-1', 1, 'read'),
            activity('search-2', 2, 'search'),
          ]}
          approvalBusyIds={new Set()}
          interactionBusyIds={new Set()}
          libraryId={3}
          onExpand={onExpand}
          onResolveApproval={vi.fn()}
          ownerScope={null}
        />,
      );
    });
    renderers.push(renderer);

    const toggle = renderer.root.findByProps({ className: 'agent-activity-group-toggle' });
    expect(toggle.props['aria-expanded']).toBe(false);
    expect(textContent(toggle)).toBe('已完成 搜索资料库');
    expect(textContent(renderer.root)).not.toContain('搜索 1');
    expect(renderer.root.findByProps({ className: 'agent-activity-group-collapse' }).props['aria-hidden'])
      .toBe(true);

    act(() => toggle.props.onClick());

    expect(onExpand).toHaveBeenCalledTimes(1);
    expect(renderer.root.findByProps({ className: 'agent-activity-group-toggle' }).props['aria-expanded'])
      .toBe(true);
    expect(renderer.root.findByProps({ className: 'agent-activity-group-collapse' }).props['aria-hidden'])
      .toBe(false);
    expect(renderer.root.findAllByProps({ 'data-activity-id': 'read-1' })).toHaveLength(1);
    expect(renderer.root.findAllByProps({ 'data-activity-id': 'search-2' })).toHaveLength(1);
    expect(textContent(renderer.root.findByProps({ className: 'agent-activity-group-items' })))
      .toBe('file.readfile.search');

    act(() => renderer.root.findByProps({ className: 'agent-activity-group-toggle' }).props.onClick());
    expect(onExpand).toHaveBeenCalledTimes(2);
  });

  it('preserves mixed step identities and controlled actions while a different tool kind appends', () => {
    const onAction = vi.fn();
    const onResolveApproval = vi.fn();
    const read = activity('read', 1, 'read');
    const write: AgentToolActivitySnapshot = { ...activity('write', 2, 'read'),
      call: { id: 'call-write', name: 'file.write', input: {} }, permissionBehavior: 'ask',
      approval: { approvalId: 'approved-write', status: 'approved', preview: { title: '保存', description: '', risk: 'write' } } };
    const failedPlugin: AgentToolActivitySnapshot = { ...activity('plugin', 3, 'read'),
      call: { id: 'call-plugin', name: 'example.rename', input: {} }, status: 'failed',
      result: { ok: false, message: '提交结果未知', data: { mutationCommitState: 'commit_unknown' } },
      pluginSource: { pluginId: 'example', pluginVersion: '1', packageFingerprint: 'a', toolId: 'rename', registrationId: 'plugin:rename' } };
    const shell: AgentToolActivitySnapshot = { ...activity('shell', 4, 'read'),
      call: { id: 'call-shell', name: 'shell.run', input: {} }, status: 'cancelled', result: { ok: false, message: '命令已取消' } };
    const group = (activities: AgentToolActivitySnapshot[]) => <AgentToolActivityGroup activities={activities}
      approvalBusyIds={new Set(['approved-write'])} interactionBusyIds={new Set()} receiptBusyIds={new Set(['plugin'])}
      libraryId={3} ownerScope={null} onResolveApproval={onResolveApproval} onAction={onAction} />;
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => { renderer = TestRenderer.create(group([read, write, failedPlugin])); });
    renderers.push(renderer);
    act(() => renderer.root.findByProps({ className: 'agent-activity-group-toggle' }).props.onClick());
    const originalCards = renderer.root.findAllByType(DetailFixture);
    expect(originalCards.map(card => card.props.activity)).toEqual([read, write, failedPlugin]);
    expect(originalCards[1].props).toMatchObject({ approvalBusy: true, onResolveApproval, onAction });
    expect(originalCards[2].props).toMatchObject({ receiptBusy: true, onResolveApproval, onAction });

    act(() => renderer.update(group([read, write, failedPlugin, shell])));
    const cards = renderer.root.findAllByType(DetailFixture);
    expect(cards.slice(0, 3)).toEqual(originalCards);
    expect(cards.map(card => card.props.activity)).toEqual([read, write, failedPlugin, shell]);
    expect(cards.every(card => card.props.detailsVisible)).toBe(true);
    expect(renderer.root.findByProps({ className: 'agent-activity-group-toggle' }).props['aria-expanded']).toBe(true);
  });

  it('reveals an observation at the end of a long group and reverses without an unbounded height', () => {
    const resizeCallbacks = new Set<() => void>();
    vi.stubGlobal('ResizeObserver', class {
      constructor(private callback: () => void) { resizeCallbacks.add(callback); }
      observe() {}
      disconnect() { resizeCallbacks.delete(this.callback); }
    });
    vi.stubGlobal('window', { getComputedStyle: () => ({ marginTop: '4px', marginBottom: '4px' }) });
    const items = { style: { maxHeight: '' } };
    let visibleDetailHeight = 0;
    let naturalBodyHeight = 180;
    let summaryHeight = 20 * 23;
    const collapse = { getBoundingClientRect: () => ({ height: visibleDetailHeight }) };
    const body = {
      closest: () => collapse,
      getBoundingClientRect: () => ({ height: naturalBodyHeight }),
    };
    const tail = { ...activity('tail', 20, 'read'), call: { id: 'tail-call', name: 'computer.observe', input: {} } };
    const group = (activities = [...Array.from({ length: 19 }, (_, index) => activity(`read-${index}`, index, 'read')), tail]) => (
      <AgentToolActivityGroup activities={activities}
        approvalBusyIds={new Set()} interactionBusyIds={new Set()} libraryId={3}
        onResolveApproval={vi.fn()} ownerScope={null} />
    );
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(group(), {
        createNodeMock: element => {
          if (element.props.className === 'agent-activity-group-items') return items;
          if (element.props.className === 'agent-activity-group-content') return {
            getBoundingClientRect: () => ({ height: summaryHeight + visibleDetailHeight }),
          };
          return element.props['data-layout-body'] ? body : null;
        },
      });
    });
    renderers.push(renderer);
    act(() => renderer.root.findByProps({ className: 'agent-activity-group-toggle' }).props.onClick());
    const toggleDetail = () => act(() => renderer.root.findByProps({ 'data-observation-toggle': 'tail' }).props.onClick());
    toggleDetail();
    expect(items.style.maxHeight).toBe('648px'); // All 20 summaries plus the complete detail, including margins.
    expect(resizeCallbacks.size).toBe(1);

    visibleDetailHeight = 70; // Reverse before the grid has finished opening.
    toggleDetail();
    expect(items.style.maxHeight).toBe('256px');
    expect(resizeCallbacks.size).toBe(0);
    toggleDetail();
    expect(items.style.maxHeight).toBe('648px');

    naturalBodyHeight = 300; // Late image/AX content still expands to its complete natural height.
    act(() => resizeCallbacks.forEach(callback => callback()));
    expect(items.style.maxHeight).toBe('768px');
    summaryHeight += 23; // A later click/scroll has no detail body to resize.
    act(() => renderer.update(group([...Array.from({ length: 19 }, (_, index) => activity(`read-${index}`, index, 'read')), tail, activity('later-scroll', 21, 'read')])));
    expect(items.style.maxHeight).toBe('791px');
    act(() => renderer.root.findByProps({ className: 'agent-activity-group-toggle' }).props.onClick());
    expect(items.style.maxHeight).toBe('256px');
    expect(resizeCallbacks.size).toBe(0);
  });
});
