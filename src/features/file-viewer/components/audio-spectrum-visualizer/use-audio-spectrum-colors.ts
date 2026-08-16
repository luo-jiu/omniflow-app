import { useEffect, useState } from 'react';
import { useTheme } from '@/hooks/useTheme';
import {
  loadCoverSpectrumColors,
  resolveDefaultSpectrumColors,
  type SpectrumColors,
} from './audio-spectrum-cover-color';

export function useAudioSpectrumColors(coverUrl?: string | null): SpectrumColors {
  const { resolvedTheme } = useTheme();
  const [colors, setColors] = useState<SpectrumColors>(
    () => resolveDefaultSpectrumColors(resolvedTheme),
  );

  useEffect(() => {
    let disposed = false;
    setColors(resolveDefaultSpectrumColors(resolvedTheme));
    if (!coverUrl) return undefined;

    const abortController = new AbortController();
    void loadCoverSpectrumColors(coverUrl, resolvedTheme, abortController.signal).then((nextColors) => {
      if (!disposed && nextColors) setColors(nextColors);
    });
    return () => {
      disposed = true;
      abortController.abort();
    };
  }, [coverUrl, resolvedTheme]);

  return colors;
}
