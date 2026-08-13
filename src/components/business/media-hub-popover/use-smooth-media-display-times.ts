import { useEffect, useRef, useState } from 'react';
import type { MediaEntry } from '@/contexts/media-registry.context';

type TimeAnchor = {
  time: number;
  at: number;
};

export function normalizeMediaTime(value: number | undefined) {
  const normalized = Number(value ?? 0);
  return Number.isFinite(normalized) && normalized >= 0 ? normalized : 0;
}

export function resolveProgressPercentFromTime(currentTime: number, duration: number | undefined) {
  const normalizedDuration = Number(duration ?? 0);
  if (!Number.isFinite(currentTime) || !Number.isFinite(normalizedDuration) || normalizedDuration <= 0) {
    return 0;
  }
  return Math.min(100, Math.max(0, (currentTime / normalizedDuration) * 100));
}

function clampMediaTime(value: number, duration: number | undefined) {
  const normalizedDuration = Number(duration ?? 0);
  if (!Number.isFinite(normalizedDuration) || normalizedDuration <= 0) {
    return Math.max(0, value);
  }
  return Math.min(Math.max(0, value), normalizedDuration);
}

function buildDisplayTimeSnapshot(entries: MediaEntry[]) {
  return entries.reduce<Record<string, number>>((snapshot, entry) => {
    snapshot[entry.entryId] = normalizeMediaTime(entry.currentTime);
    return snapshot;
  }, {});
}

export function useSmoothMediaDisplayTimes(entries: MediaEntry[]) {
  const [displayTimes, setDisplayTimes] = useState<Record<string, number>>(() => buildDisplayTimeSnapshot(entries));
  const entriesRef = useRef(entries);
  const anchorRef = useRef<Record<string, TimeAnchor>>({});

  useEffect(() => {
    entriesRef.current = entries;
    const now = performance.now();
    const nextAnchors: Record<string, TimeAnchor> = {};
    entries.forEach((entry) => {
      nextAnchors[entry.entryId] = {
        time: normalizeMediaTime(entry.currentTime),
        at: now,
      };
    });
    anchorRef.current = nextAnchors;
    setDisplayTimes(buildDisplayTimeSnapshot(entries));
  }, [entries]);

  useEffect(() => {
    if (!entries.some(entry => entry.isPlaying)) return undefined;

    let frameId = 0;
    const tick = (now: number) => {
      const activeEntries = entriesRef.current;
      setDisplayTimes((previous) => {
        let changed = false;
        let next = previous;
        activeEntries.forEach((entry) => {
          const anchor = anchorRef.current[entry.entryId];
          if (!anchor) return;
          const baseTime = entry.isPlaying
            ? anchor.time + ((now - anchor.at) / 1000)
            : anchor.time;
          const displayTime = clampMediaTime(baseTime, entry.duration);
          if (Math.abs((previous[entry.entryId] ?? 0) - displayTime) >= 0.016) {
            if (next === previous) {
              next = { ...previous };
            }
            next[entry.entryId] = displayTime;
            changed = true;
          }
        });
        return changed ? next : previous;
      });
      frameId = window.requestAnimationFrame(tick);
    };

    frameId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frameId);
  }, [entries]);

  return displayTimes;
}
