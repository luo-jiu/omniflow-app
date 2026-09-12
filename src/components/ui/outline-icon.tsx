import { Activity, ArrowLeft, ArrowRight, Bookmark, CloudUpload, Copy, FolderClosed, Globe, History, House, LoaderCircle, Plus, RotateCw, Settings, SlidersHorizontal, Sparkles, Star, Trash2, Wrench } from 'lucide-react';
import styled from 'styled-components';

const icons = { bookmark: Bookmark, upload: CloudUpload, copy: Copy, history: History, home: House, plus: Plus, settings: Settings, trash: Trash2, star: Star, activity: Activity, wrench: Wrench, agent: Sparkles, folder: FolderClosed, tools: SlidersHorizontal, browser: Globe, refresh: RotateCw, back: ArrowLeft, forward: ArrowRight, loading: LoaderCircle };

const Slot = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 16px;
  height: 16px;
  line-height: 0;
  color: var(--app-text-secondary);
  &, && svg, && svg * { transition: none; }
  button:has(&) { transition: none; }
  button:hover &, button:focus-visible & { color: var(--app-text); }
  button:disabled & { color: var(--app-text-muted); }
  &[data-selected='true'], button:hover &[data-selected='true'], button:focus-visible &[data-selected='true'] { color: var(--app-accent); }
  &&& svg { display: block; width: 16px; height: 16px; overflow: visible; }
  && svg, && svg * { color: inherit; fill: none; }
  && svg * { vector-effect: non-scaling-stroke; }
`;

export default function OutlineIcon({ name, selected = false }: { name: keyof typeof icons; selected?: boolean }) {
  const Icon = icons[name];
  return <Slot className="app-outline-icon" aria-hidden="true" data-selected={selected}>
    <Icon size={16} strokeWidth={1.25} focusable="false" />
  </Slot>;
}
