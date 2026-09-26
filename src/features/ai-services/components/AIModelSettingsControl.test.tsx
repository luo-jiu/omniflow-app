import TestRenderer, { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { Popover } from '@douyinfe/semi-ui';
import { WorkspaceVisibilityContext } from '@/components/ui/workspace-visibility';
import AIModelSettingsControl from './AIModelSettingsControl';

vi.mock('@douyinfe/semi-icons', () => ({ IconChevronDown: () => null, IconChevronRight: () => null, IconTick: () => null }));

vi.mock('@douyinfe/semi-ui', () => ({
  Popover: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  InputNumber: () => null,
}));

describe('Model menu workspace visibility', () => {
  it('closes when leaving a retained workspace and stays closed until explicitly reopened', () => {
    const render = (active: boolean) => <WorkspaceVisibilityContext.Provider value={active}>
      <AIModelSettingsControl availableModels={[]} loadingModels={false} model="test-model" modelSourceKey="profile"
        onLoadModels={vi.fn(async () => true)} onModelChange={vi.fn()} onReasoningEffortChange={vi.fn()} reasoningEffort="auto" />
    </WorkspaceVisibilityContext.Provider>;
    let view!: TestRenderer.ReactTestRenderer;
    act(() => { view = TestRenderer.create(render(true)); });
    const popover = view.root.findByType(Popover);
    act(() => popover.props.onVisibleChange(true));
    expect(popover.props.visible).toBe(true);
    act(() => view.update(render(false)));
    expect(popover.props.visible).toBe(false);
    act(() => view.update(render(true)));
    expect(popover.props.visible).toBe(false);
    act(() => popover.props.onVisibleChange(true));
    expect(popover.props.visible).toBe(true);
    act(() => view.unmount());
  });
});
