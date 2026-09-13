import TestRenderer, { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
vi.mock('@douyinfe/semi-icons', () => ({ IconSend: () => null, IconStop: () => null }));
import AgentSubmitButton from './AgentSubmitButton';

describe('Agent submit/stop command', () => {
  it('uses a play command after stopping and prevents it from submitting a message', () => {
    const onResume = vi.fn();
    const preventDefault = vi.fn();
    const renderer = TestRenderer.create(<AgentSubmitButton streaming={false} busy={false} canSubmit={false}
      resumable canResume onStop={vi.fn()} onResume={onResume} />);
    const button = renderer.root.findByType('button');
    expect(button.props.type).toBe('button');
    expect(button.props['aria-label']).toBe('继续 Agent 任务');
    expect(button.props.disabled).toBe(false);
    expect(button.findByType('svg').props.className).toContain('lucide-play');
    act(() => button.props.onClick({ preventDefault }));
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(onResume).toHaveBeenCalledOnce();
    act(() => renderer.update(<AgentSubmitButton streaming={false} busy={false} canSubmit onStop={vi.fn()} />));
    expect(button.props.type).toBe('submit');
    act(() => renderer.unmount());
  });
  it('cancels the click default even when stopping immediately changes the button into submit', () => {
    const preventDefault = vi.fn();
    const onStop = vi.fn(() => {
      expect(preventDefault).toHaveBeenCalledOnce();
      renderer.update(<AgentSubmitButton streaming={false} busy={false} canSubmit onStop={onStop} />);
    });
    const renderer = TestRenderer.create(<AgentSubmitButton streaming busy canSubmit onStop={onStop} />);
    act(() => { renderer.root.findByType('button').props.onClick({ preventDefault }); });
    expect(onStop).toHaveBeenCalledOnce();
    expect(renderer.root.findByType('button').props.type).toBe('submit');
    renderer.unmount();
  });
});
