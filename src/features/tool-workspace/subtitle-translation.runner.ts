import type { SubtitleTranslationConfig, SubtitleTranslationRow } from './types';
import { translateSubtitleRow, unloadOllamaModel } from './subtitle-translation.service';

type RowResult = {
  error: string;
  status: 'success' | 'error' | 'idle';
  translatedText: string;
};

type RunnerSnapshot = {
  activeRowId: string | null;
  doneCount: number;
  libraryId: number;
  running: boolean;
  totalCount: number;
};

type Listener = () => void;

let running = false;
let libraryId = 0;
let totalCount = 0;
let doneCount = 0;
let activeRowId: string | null = null;
let rows: SubtitleTranslationRow[] = [];
let currentRunId = 0;
let activeConfig: SubtitleTranslationConfig | null = null;
const results = new Map<string, RowResult>();
const listeners = new Set<Listener>();

function notify() {
  listeners.forEach((fn) => fn());
}

function start(
  config: SubtitleTranslationConfig,
  inputRows: SubtitleTranslationRow[],
  targetLibraryId: number,
) {
  stop();

  // Clone rows snapshot and filter untranslated
  rows = inputRows.map((row) => ({ ...row }));
  const untranslated = rows.filter(
    (row) => !String(row.translatedText || '').trim(),
  );

  if (untranslated.length === 0) {
    return;
  }

  const runId = currentRunId + 1;
  currentRunId = runId;
  running = true;
  activeConfig = config;
  libraryId = targetLibraryId;
  totalCount = untranslated.length;
  doneCount = 0;
  activeRowId = null;
  results.clear();
  notify();

  void runLoop(runId, config, untranslated);
}

async function runLoop(
  runId: number,
  config: SubtitleTranslationConfig,
  untranslated: SubtitleTranslationRow[],
) {
  try {
    for (const row of untranslated) {
      if (runId !== currentRunId) {
        break;
      }

      const rowIndex = rows.findIndex((r) => r.id === row.id);
      if (rowIndex < 0) {
        continue;
      }

      activeRowId = row.id;
      notify();

      try {
        const translatedText = await translateSubtitleRow(config, rows, rowIndex);
        if (runId !== currentRunId) {
          break;
        }

        // Update the internal rows snapshot so subsequent context is accurate
        rows[rowIndex] = {
          ...rows[rowIndex],
          error: '',
          status: 'success',
          translatedText,
        };

        results.set(row.id, {
          error: '',
          status: 'success',
          translatedText,
        });
      } catch (error: any) {
        results.set(row.id, {
          error: error?.message || '翻译失败',
          status: 'error',
          translatedText: '',
        });
      }

      if (runId !== currentRunId) {
        break;
      }
      doneCount += 1;
      notify();
    }

    if (runId === currentRunId) {
      await unloadOllamaModel(config).catch(() => undefined);
    }
  } finally {
    if (runId === currentRunId) {
      running = false;
      activeRowId = null;
      activeConfig = null;
      notify();
    }
  }
}

function stop() {
  currentRunId += 1;
  const stopRunId = currentRunId;
  if (!running && !activeRowId) {
    activeConfig = null;
    return;
  }

  if (activeRowId) {
    results.set(activeRowId, {
      error: '',
      status: 'idle',
      translatedText: '',
    });
  }

  running = false;
  activeRowId = null;
  totalCount = 0;
  doneCount = 0;
  notify();

  const config = activeConfig;
  activeConfig = null;
  if (config) {
    queueMicrotask(() => {
      if (currentRunId !== stopRunId || running) {
        return;
      }
      void unloadOllamaModel(config).catch(() => undefined);
    });
  }
}

function getSnapshot(): RunnerSnapshot {
  return {
    activeRowId,
    doneCount,
    libraryId,
    running,
    totalCount,
  };
}

function drainResults(): Map<string, RowResult> {
  if (results.size === 0) {
    return new Map();
  }
  const drained = new Map(results);
  results.clear();
  return drained;
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export const subtitleTranslationRunner = {
  drainResults,
  getSnapshot,
  start,
  stop,
  subscribe,
};

export type { RowResult, RunnerSnapshot };
