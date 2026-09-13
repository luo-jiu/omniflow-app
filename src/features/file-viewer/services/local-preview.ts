export const LOCAL_PREVIEW_PREFIX = 'omniflow-local-preview:';
export function localPreviewUrl(path: string): string {
  return LOCAL_PREVIEW_PREFIX + encodeURIComponent(path);
}
export async function readLocalPreview(url: string) {
  if (!url.startsWith(LOCAL_PREVIEW_PREFIX)) throw new Error('本机预览地址无效');
  return window.electronAPI.readLocalPreview(decodeURIComponent(url.slice(LOCAL_PREVIEW_PREFIX.length)));
}
