import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import styled from 'styled-components';
import OutlineIcon, { type OutlineIconName } from '@/components/ui/outline-icon';
import { workspaceScrollbarStyles } from '@/components/ui/workspace-scrollbar';
import { focusVisibleStyles, interactiveItemStyles, selectedItemStyles, textToneStyles } from '@/components/ui/theme-foundation-styles';

const categories: { id: string; label: string; icon: OutlineIconName }[] = [
  { id: 'appearance', label: '外观', icon: 'tools' },
  { id: 'general', label: '通用', icon: 'settings' },
  { id: 'files', label: '文件与存储', icon: 'folder' },
  { id: 'browser', label: '浏览器', icon: 'browser' },
  { id: 'plugins', label: '插件', icon: 'wrench' },
  { id: 'about', label: '关于与更新', icon: 'help' },
];

const Layout = styled.div`
  display: grid;
  grid-template-columns: max(16px, calc((100% - 1024px) / 2)) 140px minmax(0, 1fr);
  flex: 1;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
  container-type: inline-size;

  .settings-navigation {
    grid-column: 2;
    margin: 24px 0;
    padding-right: 12px;
    border-right: 1px solid var(--app-border);
    overflow: auto;
    ${workspaceScrollbarStyles}
  }

  .settings-category {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    min-height: 32px;
    margin-bottom: 2px;
    padding: 6px 12px;
    border: 0;
    border-radius: var(--app-radius-medium);
    ${textToneStyles('secondary')}
    background: transparent;
    text-align: left;
    font-size: 14px;
    line-height: 20px;
    cursor: pointer;
    ${interactiveItemStyles}
  }

  .settings-category:not(:disabled):not([aria-disabled='true']):hover { ${textToneStyles('primary')} }
  .settings-category[aria-current='location'] {
    ${selectedItemStyles}
  }

  .settings-content-scroll {
    grid-column: 3;
    min-width: 0;
    overflow: auto;
    overscroll-behavior: contain;
    scrollbar-gutter: stable;
    padding: 24px;
    ${workspaceScrollbarStyles}
    ${focusVisibleStyles}
  }

  .settings-content-inner { min-width: 600px; max-width: 860px; }
  [data-settings-section] { padding: 28px 0; border-top: 1px solid var(--app-border); }
  [data-settings-section]:first-child { padding-top: 0; border-top: 0; }
  [data-settings-section]:last-child { padding-bottom: 0; }
  .settings-section-title { margin: 0 0 12px; font-size: 18px; font-weight: 600; line-height: 26px; }
  [aria-label='外观设置'] { padding-top: 0; border-bottom: 0; }
  [aria-label='外观设置'] > h3 { display: none; }

  @container (max-width: 680px) {
    .settings-navigation { margin: 20px 0; }
    .settings-category { padding: 6px 8px; gap: 8px; }
    .settings-content-scroll { padding: 20px 16px 24px; }
    .setting-item { flex-wrap: wrap; gap: 12px; }
    && .setting-control-group, && .app-update-actions { max-width: 100%; flex-wrap: wrap; }
  }
`;

export default function SettingsSections({ children, initialCategory, onCategoryChange }: {
  children: ReactNode;
  initialCategory: string;
  onCategoryChange: (id: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const offsets = useRef<{ id: string; top: number }[]>([]);
  const initialCategoryRef = useRef(initialCategory);
  const [active, setActive] = useState(initialCategory);

  useLayoutEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    const sections = Array.from(scroll.querySelectorAll<HTMLElement>('[data-settings-section]'));
    let frame: number | null = null;
    const updateActive = () => {
      frame = null;
      const atBottom = scroll.scrollHeight > scroll.clientHeight
        && scroll.scrollTop + scroll.clientHeight >= scroll.scrollHeight - 2;
      const current = atBottom ? offsets.current.at(-1) : [...offsets.current].reverse().find(item => item.top <= scroll.scrollTop + 40);
      const id = current?.id ?? categories[0].id;
      setActive(id);
      onCategoryChange(id);
    };
    const scheduleUpdate = () => {
      if (frame === null) frame = requestAnimationFrame(updateActive);
    };
    const measure = () => {
      const origin = scroll.getBoundingClientRect().top - scroll.scrollTop;
      offsets.current = sections.map(section => ({
        id: section.dataset.settingsSection!,
        top: section.getBoundingClientRect().top - origin,
      }));
      scheduleUpdate();
    };
    measure();
    const initialTop = offsets.current.find(item => item.id === initialCategoryRef.current)?.top ?? 0;
    scroll.scrollTop = Math.max(0, initialTop - 24);
    const observer = new ResizeObserver(measure);
    observer.observe(scroll);
    sections.forEach(section => observer.observe(section));
    scroll.addEventListener('scroll', scheduleUpdate, { passive: true });
    return () => {
      observer.disconnect();
      scroll.removeEventListener('scroll', scheduleUpdate);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [onCategoryChange]);

  return <Layout>
    <nav className="settings-navigation" aria-label="设置分类">
      {categories.map(category => <button
        key={category.id}
        type="button"
        className="settings-category"
        aria-current={active === category.id ? 'location' : undefined}
        onClick={() => {
          const top = offsets.current.find(item => item.id === category.id)?.top ?? 0;
          scrollRef.current?.scrollTo({ top: Math.max(0, top - 24), behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
        }}
      ><OutlineIcon name={category.icon} selected={active === category.id} /><span>{category.label}</span></button>)}
    </nav>
    <div className="settings-content-scroll" ref={scrollRef} tabIndex={0} role="region" aria-label="设置内容">
      <div className="settings-content-inner">{children}</div>
    </div>
  </Layout>;
}
