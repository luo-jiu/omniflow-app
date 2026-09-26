import { useContext, useEffect, useMemo, useState } from 'react';
import { AppearanceViewContext } from '@/features/appearance/appearance.context';
import { DEFAULT_COLOR_TOKENS } from '@/features/appearance/color-theme';
import {
  loadCoverSpectrumColors,
  resolveDefaultSpectrumColors,
  type SpectrumColors,
} from './audio-spectrum-cover-color';

export function useAudioSpectrumColors(coverUrl?: string | null): SpectrumColors {
  const appearance = useContext(AppearanceViewContext);
  const resolvedTheme = appearance?.mode ?? 'light';
  const accent = (appearance?.colors ?? DEFAULT_COLOR_TOKENS[resolvedTheme])['accent.default'];
  // Canvas receives resolved colors, never a transient computed CSS animation frame.
  const fallback = useMemo(() => resolveDefaultSpectrumColors(accent), [accent]);
  const [cover, setCover] = useState<{ url: string; mode: string; colors: SpectrumColors } | null>(null);

  useEffect(() => {
    let disposed = false;
    if (!coverUrl) return undefined;

    const abortController = new AbortController();
    void loadCoverSpectrumColors(coverUrl, resolvedTheme, abortController.signal).then((nextColors) => {
      if (!disposed) setCover(nextColors ? { url: coverUrl, mode: resolvedTheme, colors: nextColors } : null);
    });
    return () => {
      disposed = true;
      abortController.abort();
    };
  }, [coverUrl, resolvedTheme]);

  return cover && cover.url === coverUrl && cover.mode === resolvedTheme ? cover.colors : fallback;
}
