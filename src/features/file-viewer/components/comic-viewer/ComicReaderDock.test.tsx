import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ComicReaderDock from './ComicReaderDock';
import ComicScrollProgress from './ComicScrollProgress';
import { ComicDockControls } from './comic-reader-dock.styles';
let renderer: TestRenderer.ReactTestRenderer;
const makeProps = () => ({ active: true, title: '漫画样本', page: 3, total: 20, progress: 0.25, layoutMode: 'scroll' as const, columns: 1 as const, onProgressChange: vi.fn(), onBackToTop: vi.fn(), onLayoutChange: vi.fn(), onColumnsChange: vi.fn() });
const button = (label: string) => renderer.root.findAllByType('button').find(node => node.props['aria-label'] === label)!;
const mount = (props = makeProps()) => { act(() => { renderer = TestRenderer.create(<ComicReaderDock {...props} />); }); return props; };
beforeEach(() => vi.stubGlobal('document', { addEventListener: vi.fn(), removeEventListener: vi.fn() }));
afterEach(() => { act(() => renderer?.unmount()); vi.unstubAllGlobals(); });
it('shows neutral state controls, keeps back-to-top and exposes an external circular progress slider', () => {
 const props=mount(); expect(renderer.root.findAllByProps({className:'viewer-dock-identity'})).toHaveLength(0); expect(button('回到顶部')).toBeDefined(); expect(renderer.root.findByProps({role:'slider'}).props['aria-valuenow']).toBe(25); expect(renderer.root.findByType(ComicScrollProgress).props.animate).toBe(false);
 act(()=>renderer.update(<ComicReaderDock {...props} layoutMode="flip" columns={2} animateProgress/>)); expect(button('回到顶部')).toBeDefined(); expect(button('阅读模式：翻页')).toBeDefined(); expect(button('页布局：双页')).toBeDefined(); expect(renderer.root.findByProps({role:'slider'}).props['aria-valuenow']).toBe(25); expect(renderer.root.findByType(ComicScrollProgress).props.animate).toBe(true);
});
it('moves the external progress slider without opening a page bubble', () => { const props=mount(); const slider=renderer.root.findByProps({role:'slider'}); act(()=>slider.props.onPointerDown({currentTarget:{getBoundingClientRect:()=>({top:0,height:100}),setPointerCapture:vi.fn()},clientY:80,pointerId:1})); expect(props.onProgressChange).toHaveBeenCalledWith(0.8); expect(renderer.root.findAllByType('input')).toHaveLength(0); });
it('maps clicks on the right, bottom, and left sides of the closed ring', () => {
 const props=mount(); const slider=renderer.root.findByProps({role:'slider'}); const currentTarget={getBoundingClientRect:()=>({left:0,top:0,width:40,height:100}),setPointerCapture:vi.fn()};
 act(()=>slider.props.onPointerDown({button:0,currentTarget,clientX:39,clientY:50,pointerId:1}));
 expect(props.onProgressChange.mock.calls.at(-1)?.[0]).toBeCloseTo(0.25, 2);
 act(()=>slider.props.onPointerDown({button:0,currentTarget,clientX:20,clientY:99,pointerId:3}));
 expect(props.onProgressChange.mock.calls.at(-1)?.[0]).toBeCloseTo(0.5, 2);
 act(()=>slider.props.onPointerDown({button:0,currentTarget,clientX:1,clientY:50,pointerId:2}));
 expect(props.onProgressChange.mock.calls.at(-1)?.[0]).toBeCloseTo(0.75, 2);
});
it('opens choices without changing mode and selecting current is a no-op', () => { const props=mount(); act(()=>button('阅读模式：滚动').props.onClick()); expect(props.onLayoutChange).not.toHaveBeenCalled(); expect(button('滚动模式').props['aria-pressed']).toBe(true); act(()=>button('滚动模式').props.onClick()); expect(props.onLayoutChange).not.toHaveBeenCalled(); act(()=>button('阅读模式：滚动').props.onClick()); act(()=>button('翻页模式').props.onClick()); expect(props.onLayoutChange).toHaveBeenCalledWith('flip'); });
it('isolates control keys and closes choices on Escape or inactive', () => { const props=mount(); act(()=>button('阅读模式：滚动').props.onClick()); const event={key:'Escape',preventDefault:vi.fn(),stopPropagation:vi.fn()}; act(()=>renderer.root.findByType(ComicDockControls).props.onKeyDown(event)); expect(event.stopPropagation).toHaveBeenCalledOnce(); expect(button('阅读模式：滚动').props['aria-expanded']).toBe(false); act(()=>button('页布局：单页').props.onClick()); act(()=>renderer.update(<ComicReaderDock {...props} active={false}/>)); expect(button('页布局：单页').props['aria-expanded']).toBe(false); });
