import type { ComponentType } from 'react';
import { ContributionRegistry } from '@/features/extensions/contribution-registry';
import { BUILT_IN_VIEWER_KINDS, builtInViewerId, isBuiltInViewerId, isViewerContributionId } from '@/shared/viewer-contribution-id';
import type { FileViewerFileType } from '@/shared/file-viewer-types';
import type { FileDispatcherProps } from './viewer.types';

export interface ViewerFacts {
  fileType: FileViewerFileType | null;
  fileName: string | null;
  libraryId: number | null;
  nodeId: number | null;
}
export interface ViewerContribution {
  readonly id: string;
  readonly title: string;
  readonly fileTypes: readonly FileViewerFileType[];
  readonly extensions?: readonly string[];
  readonly View: ComponentType<FileDispatcherProps>;
}
class ViewerRegistry extends ContributionRegistry<ViewerContribution> {
  private builtInRelease?: () => void;
  installBuiltIns(View: ComponentType<FileDispatcherProps>): () => void {
    if (typeof View !== 'function') throw new Error('Invalid built-in viewer adapter');
    this.builtInRelease?.();
    const titles: Record<string, string> = { image: '图片', video: '视频', audio: '音频', pdf: 'PDF', text: '文本', other: '原始文件', comic: '漫画', gallery: '图集', asmr: 'ASMR' };
    const release = this.registerBatch('omniflow', BUILT_IN_VIEWER_KINDS.map(kind => ({
      id: builtInViewerId(kind), title: titles[kind] ?? kind.replace('_archive', ' 归档'), fileTypes: [kind], View,
    })));
    const dispose = () => { release(); if (this.builtInRelease === dispose) this.builtInRelease = undefined; };
    this.builtInRelease = dispose;
    return dispose;
  }
  registerBatch(owner: string, values: readonly ViewerContribution[]): () => void {
    return super.registerBatch(owner, values.map(value => ({ ...value, fileTypes: Object.freeze([...value.fileTypes]), ...(value.extensions ? { extensions: Object.freeze([...value.extensions]) } : {}) })));
  }
}
export const viewerRegistry = new ViewerRegistry((viewer, owner) => {
  const builtIn = isBuiltInViewerId(viewer.id);
  if (!isViewerContributionId(viewer.id) || !viewer.id.startsWith(`${owner}.`) || (builtIn && owner !== 'omniflow')
    || !viewer.title.trim() || viewer.title.length > 128 || typeof viewer.View !== 'function'
    || viewer.fileTypes.length === 0 || viewer.fileTypes.length > 14
    || (builtIn && (viewer.fileTypes.length !== 1 || viewer.id !== builtInViewerId(viewer.fileTypes[0])))
    || viewer.fileTypes.some(kind => !BUILT_IN_VIEWER_KINDS.includes(kind) || (!builtIn && !['text', 'image', 'pdf', 'other', 'comic'].includes(kind)))
    || (viewer.extensions && (viewer.extensions.length > 64 || viewer.extensions.some(ext => !/^[a-z0-9]{1,32}$/.test(ext))))) throw new Error('Invalid viewer contribution');
});

export function viewerMatches(viewer: ViewerContribution, facts: ViewerFacts): boolean {
  if (!facts.fileType || !viewer.fileTypes.includes(facts.fileType)) return false;
  if (isBuiltInViewerId(viewer.id)) return viewer.id === builtInViewerId(facts.fileType);
  if (!facts.libraryId || !facts.nodeId) return false; // Local previews and external URLs retain their built-in path.
  const extension = /\.([a-z0-9]{1,32})$/i.exec(facts.fileName ?? '')?.[1].toLowerCase();
  return !viewer.extensions || Boolean(extension && viewer.extensions.includes(extension));
}
export function resolveViewerContribution(facts: ViewerFacts, requestedId?: string) {
  const candidates = viewerRegistry.getSnapshot().filter(viewer => viewerMatches(viewer, facts))
    .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const fallbackId = builtInViewerId(facts.fileType ?? 'other');
  const selected = candidates.find(viewer => viewer.id === requestedId) ?? candidates.find(viewer => viewer.id === fallbackId);
  return { candidates, selected, fallbackId, missingRequested: Boolean(requestedId && selected?.id !== requestedId) };
}
