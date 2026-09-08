import TestRenderer, { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
vi.mock('@douyinfe/semi-icons', () => ({ IconSend: () => null, IconStop: () => null }));
import AgentSubmitButton from './AgentSubmitButton';

describe('Agent submit/stop command', () => {
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
