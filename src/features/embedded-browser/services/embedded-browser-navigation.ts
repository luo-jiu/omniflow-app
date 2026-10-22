import { normalizeWebUrl } from '@/shared/web-url';

/** Forward shell navigation requests to the active workspace's tab owner. */
export function subscribeWebUrlRequests(listener: (url: string) => void): () => void {
  return window.electronEmbeddedBrowser?.onOpenWebUrl?.((payload) => {
    const url = normalizeWebUrl(payload?.url);
    if (url) listener(url);
  }) ?? (() => undefined);
}
