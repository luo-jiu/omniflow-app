import type {
  SubtitleFileFormat,
  SubtitleSourceType,
  SubtitleTranslationDraft,
  SubtitleTranslationRow,
  SubtitleTranslationRowStatus,
  ToolWorkspaceState,
  ToolWorkspaceToolId,
} from './types';

const TOOL_WORKSPACE_STATE_STORAGE_PREFIX = 'tool-workspace-state:v1:';
const ROW_STATUS_VALUES: SubtitleTranslationRowStatus[] = ['error', 'idle', 'success', 'translating'];

const toolWorkspaceStateCache = new Map<number, ToolWorkspaceState>();

export function createEmptySubtitleTranslationDraft(): SubtitleTranslationDraft {
  return {
    fileFormat: null,
    fileName: '',
    filePath: '',
    rows: [],
    sourceNode: null,
    sourceType: null,
  };
}

export function createDefaultToolWorkspaceState(): ToolWorkspaceState {
  return {
    activeToolId: 'subtitle-translation',
    subtitleTranslationDraft: createEmptySubtitleTranslationDraft(),
  };
}

function storageKey(libraryId: number): string {
  return `${TOOL_WORKSPACE_STATE_STORAGE_PREFIX}${libraryId}`;
}

function normalizeRow(raw: any): SubtitleTranslationRow | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const id = String(raw.id ?? '').trim();
  if (!id) {
    return null;
  }
  const status: SubtitleTranslationRowStatus = ROW_STATUS_VALUES.includes(raw.status)
    ? raw.status
    : 'idle';
  // 翻译中的状态不应从持久化恢复，会误导用户以为正在翻译
  const restoredStatus: SubtitleTranslationRowStatus = status === 'translating' ? 'idle' : status;

  const row: SubtitleTranslationRow = {
    endMs: Number(raw.endMs) || 0,
    endTimestamp: String(raw.endTimestamp ?? ''),
    id,
    index: Number(raw.index) || 0,
    sourceText: String(raw.sourceText ?? ''),
    startMs: Number(raw.startMs) || 0,
    startTimestamp: String(raw.startTimestamp ?? ''),
    status: restoredStatus,
    translatedText: String(raw.translatedText ?? ''),
  };
  if (raw.cueId) {
    row.cueId = String(raw.cueId);
  }
  if (raw.settings) {
    row.settings = String(raw.settings);
  }
  if (raw.error) {
    row.error = String(raw.error);
  }
  return row;
}

function normalizeDraft(raw: any): SubtitleTranslationDraft {
  const fallback = createEmptySubtitleTranslationDraft();
  if (!raw || typeof raw !== 'object') {
    return fallback;
  }

  const rawRows = Array.isArray(raw.rows) ? raw.rows : [];
  const rows: SubtitleTranslationRow[] = [];
  rawRows.forEach((item: unknown) => {
    const normalized = normalizeRow(item);
    if (normalized) {
      rows.push(normalized);
    }
  });

  const fileFormat: SubtitleFileFormat | null = (
    raw.fileFormat === 'srt' || raw.fileFormat === 'vtt' ? raw.fileFormat : null
  );
  const sourceType: SubtitleSourceType | null = (
    raw.sourceType === 'library' || raw.sourceType === 'local' ? raw.sourceType : null
  );
  const sourceNode = raw.sourceNode && typeof raw.sourceNode === 'object' ? raw.sourceNode : null;

  return {
    fileFormat,
    fileName: String(raw.fileName ?? ''),
    filePath: raw.filePath ? String(raw.filePath) : '',
    rows,
    sourceNode,
    sourceType,
  };
}

function normalizeState(raw: any): ToolWorkspaceState {
  const fallback = createDefaultToolWorkspaceState();
  if (!raw || typeof raw !== 'object') {
    return fallback;
  }
  const activeToolId: ToolWorkspaceToolId = raw.activeToolId === 'subtitle-translation'
    ? raw.activeToolId
    : fallback.activeToolId;
  return {
    activeToolId,
    subtitleTranslationDraft: normalizeDraft(raw.subtitleTranslationDraft),
  };
}

function readFromStorage(libraryId: number): ToolWorkspaceState | null {
  if (typeof window === 'undefined' || !window.localStorage) {
    return null;
  }
  const raw = window.localStorage.getItem(storageKey(libraryId));
  if (!raw) {
    return null;
  }
  try {
    return normalizeState(JSON.parse(raw));
  } catch {
    return null;
  }
}

function writeToStorage(libraryId: number, state: ToolWorkspaceState): void {
  if (typeof window === 'undefined' || !window.localStorage) {
    return;
  }
  try {
    window.localStorage.setItem(storageKey(libraryId), JSON.stringify(state));
  } catch {
    // localStorage 配额超限或被禁用：静默忽略，仍保留内存 cache
  }
}

export function loadToolWorkspaceState(libraryId: number): ToolWorkspaceState {
  const cached = toolWorkspaceStateCache.get(libraryId);
  if (cached) {
    return cached;
  }
  const fromStorage = readFromStorage(libraryId);
  if (fromStorage) {
    toolWorkspaceStateCache.set(libraryId, fromStorage);
    return fromStorage;
  }
  return createDefaultToolWorkspaceState();
}

export function saveToolWorkspaceState(libraryId: number, state: ToolWorkspaceState) {
  const normalized: ToolWorkspaceState = {
    activeToolId: state.activeToolId,
    subtitleTranslationDraft: {
      ...state.subtitleTranslationDraft,
      rows: state.subtitleTranslationDraft.rows.map((row) => ({
        ...row,
        status: row.status === 'translating' ? 'idle' : row.status,
      })),
    },
  };
  toolWorkspaceStateCache.set(libraryId, normalized);
  writeToStorage(libraryId, normalized);
}
