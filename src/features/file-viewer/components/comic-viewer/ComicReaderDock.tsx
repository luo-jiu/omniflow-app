import { useEffect, useId, useRef, useState } from 'react';
import FloatingViewerDock, { FloatingViewerDockButton } from '@/components/ui/floating-viewer-dock';
import OutlineIcon from '@/components/ui/outline-icon';
import ViewerOptionsButton from '../ViewerOptionsButton';
import type { ComicReaderLayoutMode, ComicScrollColumnMode } from './comic-viewer-session';
import { ComicDockControls, ComicDockPanel } from './comic-reader-dock.styles';
import ComicScrollProgress from './ComicScrollProgress';

type Panel = 'reading' | 'pages';

export default function ComicReaderDock({ active, title, page, total, progress, animateProgress = false, layoutMode, columns, onProgressChange, onBackToTop, onLayoutChange, onColumnsChange }: {
  active: boolean;
  title: string;
  page: number;
  total: number;
  progress: number;
  animateProgress?: boolean;
  layoutMode: ComicReaderLayoutMode;
  columns: ComicScrollColumnMode;
  onProgressChange: (progress: number) => void;
  onBackToTop: () => void;
  onLayoutChange: (mode: ComicReaderLayoutMode) => void;
  onColumnsChange: (columns: ComicScrollColumnMode) => void;
}) {
  const [open, setOpen] = useState<Panel | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggers = useRef<Partial<Record<Panel, HTMLButtonElement>>>({});
  const id = useId();
  const current = Math.min(Math.max(page, 1), Math.max(total, 1));

  useEffect(() => { if (!active) setOpen(null); }, [active]);
  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    (panel?.querySelector<HTMLElement>('[aria-pressed="true"]') ?? panel?.querySelector<HTMLElement>('input, button'))?.focus({ preventScroll: true });
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(null);
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [open]);

  const close = () => {
    if (open) triggers.current[open]?.focus({ preventScroll: true });
    setOpen(null);
  };
  const triggerProps = (panel: Panel) => ({
    ref: (node: HTMLButtonElement | null) => { if (node) triggers.current[panel] = node; },
    'aria-expanded': open === panel,
    'aria-controls': open === panel ? `${id}-${panel}` : undefined,
    onClick: () => setOpen(previous => previous === panel ? null : panel),
  });

  return <FloatingViewerDock label="漫画" title={title} icon="book" placement="right" hideIdentity
    decoration={<ComicScrollProgress progress={progress} animate={animateProgress} onChange={onProgressChange} />}>
    <ComicDockControls ref={rootRef}
      onKeyDown={event => {
        // Keep range arrows and button Space activation away from reader shortcuts.
        event.stopPropagation();
        if (event.key === 'Escape') { event.preventDefault(); close(); }
      }}
      onKeyUp={event => event.stopPropagation()}
      onBlurCapture={event => {
        if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) setOpen(null);
      }}>
      <div className="comic-dock-anchor">
        <FloatingViewerDockButton className="comic-page-counter" title="当前页码" aria-label={`当前页：第 ${current} 页，共 ${total} 页`}>
          <span aria-hidden="true">{current}</span>
          <span className="comic-page-divider" aria-hidden="true" />
          <span aria-hidden="true">{total}</span>
        </FloatingViewerDockButton>
      </div>
      <FloatingViewerDockButton title="回到顶部" aria-label="回到顶部" onClick={() => { setOpen(null); onBackToTop(); }}>
        <OutlineIcon name="back-to-top" />
      </FloatingViewerDockButton>
      <div className="comic-dock-anchor">
        <FloatingViewerDockButton {...triggerProps('reading')} title="阅读模式" aria-label={`阅读模式：${layoutMode === 'flip' ? '翻页' : '滚动'}`}>
          <OutlineIcon name={layoutMode === 'flip' ? 'book' : 'scroll-pages'} />
        </FloatingViewerDockButton>
        {open === 'reading' && <ComicDockPanel ref={panelRef} id={`${id}-reading`} role="group" aria-label="阅读模式">
          <FloatingViewerDockButton title="滚动模式" aria-label="滚动模式" aria-pressed={layoutMode === 'scroll'}
            onClick={() => { if (layoutMode !== 'scroll') onLayoutChange('scroll'); close(); }}>
            <OutlineIcon name="scroll-pages" selected={layoutMode === 'scroll'} />
          </FloatingViewerDockButton>
          <FloatingViewerDockButton title="翻页模式" aria-label="翻页模式" aria-pressed={layoutMode === 'flip'}
            onClick={() => { if (layoutMode !== 'flip') onLayoutChange('flip'); close(); }}>
            <OutlineIcon name="book" selected={layoutMode === 'flip'} />
          </FloatingViewerDockButton>
        </ComicDockPanel>}
      </div>
      <div className="comic-dock-anchor">
        <FloatingViewerDockButton {...triggerProps('pages')} title="页布局" aria-label={`页布局：${columns === 2 ? '双页' : '单页'}`}>
          <OutlineIcon name={columns === 2 ? 'double-page' : 'single-page'} />
        </FloatingViewerDockButton>
        {open === 'pages' && <ComicDockPanel ref={panelRef} id={`${id}-pages`} role="group" aria-label="页布局">
          <FloatingViewerDockButton title="单页" aria-label="单页" aria-pressed={columns === 1}
            onClick={() => { if (columns !== 1) onColumnsChange(1); close(); }}>
            <OutlineIcon name="single-page" selected={columns === 1} />
          </FloatingViewerDockButton>
          <FloatingViewerDockButton title="双页" aria-label="双页" aria-pressed={columns === 2}
            onClick={() => { if (columns !== 2) onColumnsChange(2); close(); }}>
            <OutlineIcon name="double-page" selected={columns === 2} />
          </FloatingViewerDockButton>
        </ComicDockPanel>}
      </div>
      <ViewerOptionsButton />
    </ComicDockControls>
  </FloatingViewerDock>;
}
