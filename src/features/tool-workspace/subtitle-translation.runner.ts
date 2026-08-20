import type { SubtitleTranslationConfig, SubtitleTranslationRow } from './types';
import {
  beginSubtitleTranslationRun,
  endSubtitleTranslationRun,
  translateSubtitleRow,
} from './subtitle-translation.service';

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
type TranslationRunScope = 'all' | 'untranslated';

let running = false;
let libraryId = 0;
let totalCount = 0;
let doneCount = 0;
let activeRowId: string | null = null;
let rows: SubtitleTranslationRow[] = [];
let currentRunId = 0;
let activeRunSessionId: string | null = null;
const resultsByLibrary = new Map<number, Map<string, RowResult>>();
const listeners = new Set<Listener>();

function notify() {
  listeners.forEach((fn) => fn());
}

function start(
  config: SubtitleTranslationConfig,
  inputRows: SubtitleTranslationRow[],
  targetLibraryId: number,
  serviceProfileId: string,
  scope: TranslationRunScope = 'untranslated',
) {
  stop();

  rows = inputRows.map((row) => ({ ...row }));
  const pendingRows = scope === 'all'
    ? rows
    : rows.filter((row) => !String(row.translatedText || '').trim());

  if (pendingRows.length === 0) {
    return;
  }

  const runId = currentRunId + 1;
  currentRunId = runId;
  running = true;
  libraryId = targetLibraryId;
  totalCount = pendingRows.length;
  doneCount = 0;
  activeRowId = null;
  const runResults = new Map<string, RowResult>();
  resultsByLibrary.set(targetLibraryId, runResults);
  notify();

  void runLoop(runId, config, pendingRows, serviceProfileId, runResults);
}

async function runLoop(
  runId: number,
  config: SubtitleTranslationConfig,
  pendingRows: SubtitleTranslationRow[],
  serviceProfileId: string,
  runResults: Map<string, RowResult>,
) {
  let runSessionId: string | null = null;
  try {
    runSessionId = await beginSubtitleTranslationRun(serviceProfileId);
    if (runId !== currentRunId) {
      return;
    }
    activeRunSessionId = runSessionId;

    for (const row of pendingRows) {
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
        const translatedText = await translateSubtitleRow(
          config,
          rows,
          rowIndex,
          serviceProfileId,
          runSessionId,
        );
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

        runResults.set(row.id, {
          error: '',
          status: 'success',
          translatedText,
        });
      } catch (error: any) {
        if (runId !== currentRunId) {
          break;
        }
        runResults.set(row.id, {
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
  } catch (error: any) {
    if (runId === currentRunId) {
      const message = error?.message || '翻译任务启动失败';
      pendingRows.forEach((row) => {
        if (!runResults.has(row.id)) {
          runResults.set(row.id, {
            error: message,
            status: 'error',
            translatedText: '',
          });
        }
      });
      doneCount = totalCount;
      notify();
    }
  } finally {
    if (activeRunSessionId === runSessionId) {
      activeRunSessionId = null;
    }
    if (runSessionId) {
      await endSubtitleTranslationRun(runSessionId).catch(() => false);
    }
    if (runId === currentRunId) {
      running = false;
      activeRowId = null;
      notify();
    }
  }
}

function stop(targetLibraryId?: number) {
  if (targetLibraryId !== undefined && targetLibraryId !== libraryId) {
    return;
  }
  currentRunId += 1;
  const runSessionId = activeRunSessionId;
  activeRunSessionId = null;
  if (runSessionId) {
    void endSubtitleTranslationRun(runSessionId).catch(() => false);
  }
  if (!running && !activeRowId) {
    return;
  }

  if (activeRowId) {
    const activeResults = resultsByLibrary.get(libraryId);
    activeResults?.set(activeRowId, {
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
}

function getSnapshot(targetLibraryId?: number): RunnerSnapshot {
  if (targetLibraryId !== undefined && targetLibraryId !== libraryId) {
    return {
      activeRowId: null,
      doneCount: 0,
      libraryId: targetLibraryId,
      running: false,
      totalCount: 0,
    };
  }
  return {
    activeRowId,
    doneCount,
    libraryId,
    running,
    totalCount,
  };
}

function drainResults(targetLibraryId: number): Map<string, RowResult> {
  const results = resultsByLibrary.get(targetLibraryId);
  if (!results || results.size === 0) {
    if (results && (targetLibraryId !== libraryId || !running)) {
      resultsByLibrary.delete(targetLibraryId);
    }
    return new Map();
  }
  const drained = new Map(results);
  if (targetLibraryId !== libraryId || !running) {
    resultsByLibrary.delete(targetLibraryId);
  } else {
    results.clear();
  }
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

export type { RowResult, RunnerSnapshot, TranslationRunScope };
