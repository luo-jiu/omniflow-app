import TestRenderer, { act } from 'react-test-renderer';
import { expect, it, vi } from 'vitest';
import { useArchiveCardGrid } from './useArchiveCardGrid';

it('does not rerender the card tree or read layout during continuous resizing', () => {
  const callbacks = new Set<() => void>();
  const element = { clientWidth: 900 };
  const measure = vi.fn(() => ({ paddingLeft: '13px', paddingRight: '13px' }));
  const observe = vi.fn();
  vi.stubGlobal('getComputedStyle', measure);
  vi.stubGlobal('ResizeObserver', class {
    constructor(private callback: () => void) { callbacks.add(callback); }
    observe = observe;
    disconnect() { callbacks.delete(this.callback); }
  });
  let renders = 0;
  function Grid() {
    const { viewportRef, wrapperStyle } = useArchiveCardGrid({ baseCardWidth: 275, gridGap: 15 });
    renders += 1;
    return <section ref={viewportRef} style={wrapperStyle}>
      {Array.from({ length: 200 }, (_, index) => <article key={index}>Card {index}</article>)}
    </section>;
  }
  let renderer: TestRenderer.ReactTestRenderer | undefined;
  try {
    act(() => { renderer = TestRenderer.create(<Grid />, { createNodeMock: () => element }); });
    // Separate commits represent resize notifications across successive frames.
    for (let frame = 0; frame < 120; frame += 1) {
      act(() => {
        element.clientWidth = 600 + frame * 4;
        callbacks.forEach(callback => callback());
      });
    }
    expect(renders).toBe(1);
    expect(measure).not.toHaveBeenCalled();
    expect(observe).not.toHaveBeenCalled();
  } finally {
    act(() => renderer?.unmount());
    vi.unstubAllGlobals();
  }
});

it('keeps the scroll viewport and grid configuration stable across unrelated renders', () => {
  const configs: ReturnType<typeof useArchiveCardGrid>[] = [];
  function Grid({ width = 275, gap = 15 }: { width?: number; gap?: number }) {
    const config = useArchiveCardGrid({ baseCardWidth: width, gridGap: gap });
    configs.push(config);
    return <section ref={config.viewportRef} style={config.wrapperStyle} />;
  }
  let renderer: TestRenderer.ReactTestRenderer | undefined;
  try {
    act(() => { renderer = TestRenderer.create(<Grid />); });
    act(() => { renderer!.update(<Grid />); });
    expect(configs[1].viewportRef).toBe(configs[0].viewportRef);
    expect(configs[1].wrapperStyle).toBe(configs[0].wrapperStyle);
    act(() => { renderer!.update(<Grid width={220} gap={18} />); });
    expect(configs[2].viewportRef).toBe(configs[0].viewportRef);
    expect(configs[2].wrapperStyle).toEqual({
      '--archive-card-min-width': '220px',
      '--archive-card-gap': '18px',
    });
  } finally {
    act(() => renderer?.unmount());
  }
});
