import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ComicViewer from './index';
import ComicReaderDock from './ComicReaderDock';

const session = vi.hoisted(() => ({ capture: vi.fn(), markInteracted: vi.fn(), notifyRetentionChanged: vi.fn(), waitForInitialRestore: vi.fn(async () => 'none') }));
vi.mock('@/features/file-viewer/session', () => ({ useViewerSession: () => session, acknowledgeLatestPendingValue: vi.fn() }));
vi.mock('@/features/file-explorer/services/file.api', () => ({
  getChildrenByNodeId: async () => [1, 2, 3].map(id => ({ id, name: `${id}.png`, ext: 'png', type: 'file' })),
  fetchNodeDetailById: async () => ({}),
  batchGetFileLinks: async () => new Map([1, 2, 3].map(id => [id, `https://fixture.invalid/${id}.png`])),
  updateNodeConfig: vi.fn(async () => undefined),
}));
vi.mock('@douyinfe/semi-ui', () => ({ Modal: () => null, Popover: () => null, Slider: () => null, Spin: () => null }));
vi.mock('@/components/ui/context-menu', () => ({ default: () => null }));
vi.mock('./ComicReaderDock', () => ({ default: () => null }));
vi.mock('../ViewerOptionsButton', () => ({ default: () => null }));

let renderer: TestRenderer.ReactTestRenderer;
const listeners = new Map<string, Set<(event: unknown) => void>>();
const key = (type: string, code: string) => act(() => {
  for (const listener of listeners.get(type) ?? []) listener({ code, key: code === 'Space' ? ' ' : code, preventDefault: vi.fn(), stopPropagation: vi.fn(), target: null });
});
const stage = () => renderer.root.findAllByType('div').find(node => String(node.props.className).startsWith('flip-stage'))!;
const drag = () => {
  act(() => stage().props.onMouseDown({ button: 0, clientX: 100, clientY: 100, preventDefault: vi.fn(), currentTarget: { focus: vi.fn() } }));
  act(() => stage().props.onMouseMove({ buttons: 1, clientX: 140, clientY: 130 }));
};
const transform = () => renderer.root.findAllByType('img')[0].props.style.transform as string;

beforeEach(async () => {
  listeners.clear();
  vi.stubGlobal('HTMLElement', class {});
  vi.stubGlobal('Image', class { src = ''; decoding = ''; });
  vi.stubGlobal('window', {
    addEventListener: (type: string, handler: (event: unknown) => void) => { const bucket = listeners.get(type) ?? new Set(); bucket.add(handler); listeners.set(type, bucket); },
    removeEventListener: (type: string, handler: (event: unknown) => void) => listeners.get(type)?.delete(handler),
    requestAnimationFrame: () => 1, cancelAnimationFrame: vi.fn(), setTimeout: () => 1, clearTimeout: vi.fn(),
  });
  await act(async () => { renderer = TestRenderer.create(<ComicViewer accountScope="test" contentRevision={null} folderNodeId={12} fileUrl="comic://test" libraryId={3} tabId="test" />); });
  act(() => renderer.root.findByType(ComicReaderDock).props.onLayoutChange('flip'));
});
afterEach(() => { act(() => renderer?.unmount()); vi.unstubAllGlobals(); });

it('does not pan or turn a page after an ordinary drag, but still turns on a simple click', () => {
  drag();
  expect(transform()).toContain('translate(0px, 0px)');
  act(() => stage().props.onMouseUp());
  const click = (clientX: number) => ({ button: 0, clientX, currentTarget: { getBoundingClientRect: () => ({ left: 0, width: 300 }) } });
  act(() => stage().props.onClick(click(150)));
  expect(renderer.root.findByType(ComicReaderDock).props.page).toBe(1);
  act(() => stage().props.onClick(click(150)));
  expect(renderer.root.findByType(ComicReaderDock).props.page).toBe(2);
  act(() => stage().props.onClick(click(10)));
  expect(renderer.root.findByType(ComicReaderDock).props.page).toBe(1);
  act(() => stage().props.onClick(click(290)));
  expect(renderer.root.findByType(ComicReaderDock).props.page).toBe(2);
  act(() => stage().props.onClick(click(290)));
  expect(renderer.root.findByType(ComicReaderDock).props.page).toBe(3);
});

it('requires held Space for single-page panning and stops on release or window blur', () => {
  key('keydown', 'Space');
  drag();
  expect(transform()).toContain('translate(40px, 30px)');
  key('keyup', 'Space');
  act(() => stage().props.onMouseMove({ buttons: 1, clientX: 180, clientY: 180 }));
  expect(transform()).toContain('translate(40px, 30px)');
  key('keydown', 'Space');
  key('blur', '');
  expect(stage().props.className).not.toContain('can-pan');
});

it('clears single-page offset on entering double-page and forbids panning even with Space', () => {
  key('keydown', 'Space'); drag();
  expect(transform()).toContain('translate(40px, 30px)');
  act(() => renderer.root.findByType(ComicReaderDock).props.onColumnsChange(2));
  expect(transform()).toContain('translate(0px, 0px)');
  key('keydown', 'Space'); drag();
  expect(transform()).toContain('translate(0px, 0px)');
  expect(stage().props.className).not.toContain('can-pan');
});
