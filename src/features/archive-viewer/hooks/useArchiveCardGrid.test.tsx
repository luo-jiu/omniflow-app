import TestRenderer, { act } from 'react-test-renderer';
import { expect, it, vi } from 'vitest';
import { useArchiveCardGrid } from './useArchiveCardGrid';

it('keeps card widths fixed across column thresholds and shrinks only below one card', () => {
  const element = { clientWidth: 590 };
  let resize = () => {};
  const disconnect = vi.fn();
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resize = callback; }
    observe() {}
    disconnect = disconnect;
  });
  vi.stubGlobal('getComputedStyle', () => ({ paddingLeft: '13px', paddingRight: '13px' }));
  function Grid() {
    const { viewportRef, wrapperStyle } = useArchiveCardGrid({ baseCardWidth: 275, gridGap: 15 });
    return <section ref={viewportRef} style={wrapperStyle} />;
  }
  let renderer: TestRenderer.ReactTestRenderer | undefined;
  try {
    act(() => { renderer = TestRenderer.create(<Grid />, { createNodeMock: () => element }); });
    for (const [width, columns, cardWidth] of [[590, '1', '275px'], [591, '2', '275px'],
      [800, '2', '275px'], [881, '3', '275px'], [200, '1', '174px']]) {
      act(() => { element.clientWidth = Number(width); resize(); });
      expect(renderer!.root.findByType('section').props.style).toMatchObject({
        '--archive-column-count': columns, '--archive-card-width': cardWidth, '--archive-card-gap': '15px',
      });
    }
  } finally {
    act(() => renderer?.unmount());
    vi.unstubAllGlobals();
  }
  expect(disconnect).toHaveBeenCalledOnce();
});
