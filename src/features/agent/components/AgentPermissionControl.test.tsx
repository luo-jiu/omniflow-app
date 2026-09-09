import TestRenderer, { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import AgentPermissionControl from './AgentPermissionControl';

vi.mock('@douyinfe/semi-icons', () => ({
  IconShieldStroked: () => null,
  IconTick: () => <span data-testid="selected-tick" />,
}));
vi.mock('@douyinfe/semi-ui', () => ({
  Popover: ({ children, content }: { children: React.ReactNode; content: React.ReactNode }) => <>{children}{content}</>,
}));

describe('Agent permission selection', () => {
  it('marks the authoritative selection with a tick and does not optimistically switch it', () => {
    const onChange = vi.fn();
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => { renderer = TestRenderer.create(<AgentPermissionControl value="full-access" disabled={false} onChange={onChange} />); });
    const options = renderer.root.findAllByProps({ role: 'menuitemradio' });
    expect(options.map(option => option.props['aria-checked'])).toEqual([false, false, true]);
    expect(options[2].findAllByProps({ 'data-testid': 'selected-tick' })).toHaveLength(1);
    act(() => options[0].props.onClick());
    expect(onChange).toHaveBeenCalledWith('ask');
    expect(options[2].props['aria-checked']).toBe(true);
    act(() => renderer.update(<AgentPermissionControl value="ask" disabled={false} onChange={onChange} />));
    expect(renderer.root.findAllByProps({ role: 'menuitemradio' }).map(option => option.props['aria-checked']))
      .toEqual([true, false, false]);
    act(() => renderer.unmount());
  });
});
