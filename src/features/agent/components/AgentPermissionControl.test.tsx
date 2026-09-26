import TestRenderer, { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import AgentPermissionControl from './AgentPermissionControl';
import { Popover } from '@douyinfe/semi-ui';
import { WorkspaceVisibilityContext } from '@/components/ui/workspace-visibility';

vi.mock('@douyinfe/semi-icons', () => ({
  IconShieldStroked: () => null,
  IconTick: () => <span data-testid="selected-tick" />,
}));
vi.mock('@douyinfe/semi-ui', () => ({
  Popover: ({ children, content }: { children: React.ReactNode; content: React.ReactNode }) => <>{children}{content}</>,
}));

describe('Agent permission selection', () => {
  it('hides its portal on page switch and does not reopen it on return', () => {
    const render = (active: boolean) => <WorkspaceVisibilityContext.Provider value={active}>
      <AgentPermissionControl value="ask" disabled={false} onChange={vi.fn()} />
    </WorkspaceVisibilityContext.Provider>;
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => { renderer = TestRenderer.create(render(true)); });
    const popover = renderer.root.findByType(Popover);
    act(() => popover.props.onVisibleChange(true));
    expect(popover.props.visible).toBe(true);
    act(() => renderer.update(render(false)));
    expect(popover.props.visible).toBe(false);
    act(() => renderer.update(render(true)));
    expect(popover.props.visible).toBe(false);
    act(() => renderer.unmount());
  });
  it('marks the authoritative selection with a tick and does not optimistically switch it', () => {
    const onChange = vi.fn();
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => { renderer = TestRenderer.create(<AgentPermissionControl value="full-access" disabled={false} onChange={onChange} />); });
    const options = renderer.root.findAllByProps({ role: 'menuitemradio' });
    expect(options.map(option => option.props['aria-checked'])).toEqual([false, true]);
    expect(options[1].findAllByProps({ 'data-testid': 'selected-tick' })).toHaveLength(1);
    act(() => options[0].props.onClick());
    expect(onChange).toHaveBeenCalledWith('ask');
    expect(options[1].props['aria-checked']).toBe(true);
    act(() => renderer.update(<AgentPermissionControl value="ask" disabled={false} onChange={onChange} />));
    expect(renderer.root.findAllByProps({ role: 'menuitemradio' }).map(option => option.props['aria-checked']))
      .toEqual([true, false]);
    act(() => renderer.update(<AgentPermissionControl value="group" grouped disabled={false} onChange={onChange} />));
    expect(renderer.root.findAllByProps({ role: 'menuitemradio' }).map(option => option.props['aria-checked']))
      .toEqual([false, true, false]);
    act(() => renderer.unmount());
  });
});
