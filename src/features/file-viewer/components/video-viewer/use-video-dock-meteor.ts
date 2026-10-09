import { useCallback, useEffect, useRef, useState } from 'react';
import type { FileViewerVideoTransition } from '@/contexts/file-viewer.context';
import type { AudioDockMeteorEvent } from '@/features/audio-viewer/components/unified-audio-viewer/AudioDockMeteor';

// Playlist changes remount the viewer with a new media owner. Only this small,
// one-shot visual hint crosses that boundary; playback state does not.
export function useVideoDockMeteor({ transition, tabId, url, enabled, consumeTransition }: {
  transition?: FileViewerVideoTransition;
  tabId: string;
  url: string;
  enabled: boolean;
  consumeTransition: (tabId: string, transitionId: string) => void;
}) {
  const [meteor, setMeteor] = useState<AudioDockMeteorEvent | null>(null);
  const pendingRef = useRef<{ src: string; ratio: number } | null>(null);
  const consumedIdRef = useRef<string | null>(null);
  const serialRef = useRef(0);

  useEffect(() => {
    if (!transition || consumedIdRef.current === transition.id) return;
    consumedIdRef.current = transition.id;
    pendingRef.current = enabled ? { src: url, ratio: transition.ratio } : null;
    consumeTransition(tabId, transition.id);
  }, [consumeTransition, enabled, tabId, transition, url]);

  const cancel = useCallback(() => {
    pendingRef.current = null;
    setMeteor(null);
  }, []);

  useEffect(() => {
    if (!enabled) cancel();
  }, [cancel, enabled]);

  useEffect(() => {
    if (pendingRef.current?.src !== url) pendingRef.current = null;
    setMeteor(null);
  }, [url]);

  const start = useCallback(() => {
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (!enabled || !pending || pending.src !== url) return;
    setMeteor({ ...pending, id: ++serialRef.current, fromColor: 'var(--app-accent)' });
  }, [enabled, url]);

  const finish = useCallback((id: number) => {
    setMeteor(current => current?.id === id ? null : current);
  }, []);

  return { meteor, start, cancel, finish };
}
