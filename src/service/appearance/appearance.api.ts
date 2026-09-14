import type { ThemeView } from '@/features/appearance/theme-view';

let ownerClaim: { epoch: string; promise: Promise<boolean> } | null = null;
export async function publishAppearance(view: ThemeView): Promise<boolean> {
  const bridge = window.electronAppearance;
  if (!bridge) return false;
  if (!ownerClaim || ownerClaim.epoch !== view.ownerEpoch) ownerClaim = { epoch: view.ownerEpoch, promise: bridge.claim(view.ownerEpoch) };
  const claim = ownerClaim;
  if (!await claim.promise || claim !== ownerClaim) return false;
  return bridge.publish(view);
}
export function subscribeAppearance(listener: (view: ThemeView) => void): () => void {
  let disposed = false;
  let receivedEvent = false;
  const unsubscribe = window.electronAppearance?.subscribe(view => { receivedEvent = true; if (!disposed) listener(view); });
  void window.electronAppearance?.get().then(view => { if (!disposed && !receivedEvent && view) listener(view); }).catch(() => undefined);
  return () => { disposed = true; unsubscribe?.(); };
}
