import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, describe, expect, it } from 'vitest';
import { WorkspaceVisibilityContext } from '@/components/ui/workspace-visibility';
import AgentToolAxPreview from './AgentToolAxPreview';

const renderers: TestRenderer.ReactTestRenderer[] = [];
const tree = 'AXWindow "OmniFlow"\n  AXButton "<img src=x onerror=alert(1)>"';

afterEach(() => { act(() => { renderers.splice(0).forEach(renderer => renderer.unmount()); }); });

function render(truncated = false) {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => { renderer = TestRenderer.create(<WorkspaceVisibilityContext.Provider value>
    <AgentToolAxPreview tree={tree} truncated={truncated} />
  </WorkspaceVisibilityContext.Provider>); });
  renderers.push(renderer);
  return renderer;
}

describe('shared window AX preview', () => {
  it.each([false, true])('labels a local subtree independently of summary truncation and closes it while hidden: %s', truncated => {
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => { renderer = TestRenderer.create(<WorkspaceVisibilityContext.Provider value>
      <AgentToolAxPreview tree={tree} truncated={truncated} scope={{ kind: 'element-ancestor', ancestorLevels: 2 }} scopeScanComplete />
    </WorkspaceVisibilityContext.Provider>); });
    renderers.push(renderer);
    expect(renderer.root.findByType('summary').children).toEqual(truncated ? ['AX', ' · 局部', ' · 已截断'] : ['AX', ' · 局部']);
    expect(renderer.root.findAllByType('p')).toHaveLength(0);
    act(() => renderer.root.findByType('details').props.onToggle({ currentTarget: { open: true } }));
    expect(renderer.root.findByType('p').children).toEqual(['局部范围：上溯 2 层；控件扫描完整，不代表全窗口。']);
    expect(renderer.root.findByType('pre').children).toEqual([tree]);
    act(() => renderer.update(<WorkspaceVisibilityContext.Provider value={false}>
      <AgentToolAxPreview tree={tree} truncated={truncated} scope={{ kind: 'element-ancestor', ancestorLevels: 2 }} scopeScanComplete />
    </WorkspaceVisibilityContext.Provider>));
    expect(renderer.toJSON()).toBeNull();
  });

  it.each([
    { scope: { kind: 'window' } as const, complete: false, notice: '窗口控件扫描不完整。' },
    { scope: { kind: 'element-ancestor', ancestorLevels: 0 } as const, complete: false,
      notice: '局部范围：控件自身；控件扫描不完整，不代表全窗口。' },
  ])('shows truthful scan scope independently of tree availability: %j', ({ scope, complete, notice }) => {
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => { renderer = TestRenderer.create(<WorkspaceVisibilityContext.Provider value>
      <AgentToolAxPreview tree={tree} truncated={false} scope={scope} scopeScanComplete={complete} />
    </WorkspaceVisibilityContext.Provider>); });
    renderers.push(renderer);
    act(() => renderer.root.findByType('details').props.onToggle({ currentTarget: { open: true } }));
    expect(renderer.root.findByType('p').children).toEqual([notice]);
  });

  it.each([false, true])('uses an expandable AX label with truthful truncation=%s and plain readable text', truncated => {
    const renderer = render(truncated);
    expect(renderer.root.findByType('summary').children).toEqual(truncated ? ['AX', ' · 已截断'] : ['AX']);
    expect(renderer.root.findAllByType('pre')).toHaveLength(0);
    act(() => renderer.root.findByType('details').props.onToggle({ currentTarget: { open: true } }));
    expect(renderer.root.findByType('pre').children).toEqual([tree]);
    expect(renderer.root.findAllByType('img')).toHaveLength(0);
    act(() => renderer.root.findByType('details').props.onToggle({ currentTarget: { open: false } }));
    expect(renderer.root.findAllByType('pre')).toHaveLength(0);
  });

  it('releases expanded AX text while hidden and returns with the disclosure closed', () => {
    const renderer = render();
    act(() => renderer.root.findByType('details').props.onToggle({ currentTarget: { open: true } }));
    expect(renderer.root.findAllByType('pre')).toHaveLength(1);
    act(() => renderer.update(<WorkspaceVisibilityContext.Provider value={false}>
      <AgentToolAxPreview tree={tree} truncated={false} />
    </WorkspaceVisibilityContext.Provider>));
    expect(renderer.toJSON()).toBeNull();
    act(() => renderer.update(<WorkspaceVisibilityContext.Provider value>
      <AgentToolAxPreview tree={tree} truncated={false} />
    </WorkspaceVisibilityContext.Provider>));
    expect(renderer.root.findAllByType('pre')).toHaveLength(0);
  });
});
