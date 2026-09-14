import { HostCommandRegistry } from '@/features/extensions/host-command-registry';

export type DirectoryCommandLocation = 'root' | 'folder' | 'file';
const definitions = [
  { key: 'new-file', title: '新建文件', legacyAction: '新建文件', locations: ['root', 'folder'] },
  { key: 'new-folder', title: '新建文件夹', legacyAction: '新建文件夹', locations: ['root', 'folder'] },
  { key: 'upload-file', title: '上传文件', legacyAction: '上传文件', locations: ['root', 'folder'] },
  { key: 'upload-folder', title: '上传文件夹', legacyAction: '上传文件夹', locations: ['root', 'folder'] },
  { key: 'rename', title: '重命名', legacyAction: '重命名', locations: ['folder', 'file'] },
  { key: 'props', title: '属性', legacyAction: '属性', locations: ['folder', 'file'] },
  { key: 'download', title: '下载', legacyAction: '下载', locations: ['folder', 'file'] },
  { key: 'open-in-browser', title: '在浏览器打开', legacyAction: '在浏览器打开', locations: ['file'] },
  { key: 'open-media-tool', title: '在媒体工具打开', legacyAction: '在媒体工具打开', locations: ['file'] },
  { key: 'refresh', title: '刷新', legacyAction: '刷新', locations: ['folder'] },
  { key: 'migrate-storage', title: '迁移到其他存储...', legacyAction: '迁移到其他存储', locations: ['folder', 'file'] },
  { key: 'delete', title: '删除', legacyAction: 'delete', locations: ['folder', 'file'] },
] as const;
export type DirectoryMenuCommandKey = typeof definitions[number]['key'];
export const DIRECTORY_MENU_COMMANDS = Object.freeze(Object.fromEntries(definitions.map(item => [item.key, Object.freeze({
  ...item, id: `omniflow.node.${item.key}`, danger: item.key === 'delete', locations: Object.freeze([...item.locations]),
})])) as Record<DirectoryMenuCommandKey, { readonly key: DirectoryMenuCommandKey; readonly id: string; readonly title: string; readonly legacyAction: string; readonly danger: boolean; readonly locations: readonly DirectoryCommandLocation[] }>);

export interface DirectoryCommandContext {
  readonly location: DirectoryCommandLocation;
  readonly isMediaFile: boolean;
  readonly dispatchLegacyAction: (action: string) => Promise<void>;
}
// Stable host-owned insertion slots. Dividers and mode-specific nested menus stay in the host.
export const DIRECTORY_MENU_LAYOUT = Object.freeze({
  'root.create': ['new-file', 'new-folder'],
  'root.upload': ['upload-file', 'upload-folder'],
  'folder.create': ['new-file', 'new-folder'],
  'file.basic': ['rename', 'props', 'download', 'open-in-browser', 'open-media-tool'],
  'folder.info': ['rename', 'props'],
  'folder.upload': ['upload-file', 'upload-folder'],
  'folder.download': ['download'],
  'folder.refresh': ['refresh'],
  'common.migrate': ['migrate-storage'],
  'common.delete': ['delete'],
} as const);
export type DirectoryMenuSlot = keyof typeof DIRECTORY_MENU_LAYOUT;
export function getDirectoryMenuCommands(slot: DirectoryMenuSlot, context: Pick<DirectoryCommandContext, 'location' | 'isMediaFile'>) {
  return DIRECTORY_MENU_LAYOUT[slot].map(key => DIRECTORY_MENU_COMMANDS[key]).filter(item =>
    item.locations.includes(context.location) && (item.key !== 'open-media-tool' || context.isMediaFile));
}
export const directoryCommands = new HostCommandRegistry<DirectoryCommandContext>();
directoryCommands.registerBatch('omniflow', Object.values(DIRECTORY_MENU_COMMANDS).map(item => ({
  id: item.id, title: item.title, argumentSchema: 'none', exposure: 'host-only',
  isEnabled: context => item.locations.includes(context.location) && (item.key !== 'open-media-tool' || context.isMediaFile),
  run: context => context.dispatchLegacyAction(item.legacyAction),
})));

function normalizeExt(ext?: string | null): string {
  return String(ext || '').trim().toLowerCase().replace(/^\./, '');
}

export function isDirectoryMediaFile(node: any): boolean {
  const mimeType = String(node?.mimeType || '').toLowerCase();
  if (mimeType.startsWith('audio/') || mimeType.startsWith('video/')) {
    return true;
  }
  const ext = normalizeExt(node?.ext || node?.data?.rawExt);
  return [
    'aac',
    'aiff',
    'avi',
    'flac',
    'flv',
    'm4a',
    'm4v',
    'mkv',
    'mov',
    'mp3',
    'mp4',
    'ogg',
    'opus',
    'ts',
    'wav',
    'weba',
    'webm',
    'wma',
    'wmv',
  ].includes(ext);
}
