import {
  cleanupEmbeddedBrowserDownloadedFile,
  acknowledgeEmbeddedBrowserDownloadHandoff,
  listEmbeddedBrowserDownloadHandoff,
  subscribeEmbeddedBrowserDownloads,
} from '../downloads/services/embedded-browser-download.api';
import type { EmbeddedBrowserDownloadEvent } from '../downloads/types';
import { listenAuthSessionCleared } from '@/service/auth-session-release';
import {
  resolveUploadBatchTerminal,
  type UploadBatchLike,
} from '@/modules/upload-center/services/upload-delivery-adapter';

type DownloadListener = (payload: EmbeddedBrowserDownloadEvent) => void;
type SnapshotListener = () => void;

export type CapturedOutputWorkflowStorage = {
  getItem: (key: string) => string | null;
  removeItem: (key: string) => void;
  setItem: (key: string, value: string) => void;
};

const CAPTURED_OUTPUT_WORKFLOW_STORAGE_KEY = 'omniflow:embedded-browser:captured-output-workflow:v1';
const CAPTURED_OUTPUT_WORKFLOW_STORAGE_VERSION = 1;
const DEFAULT_PERSISTED_OUTPUT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_PERSISTED_OUTPUTS = 64;

export type CapturedOutputWorkflowStatus = 'importing' | 'pending' | 'saving';

export type CapturedOutputWorkflowItem = {
  download: EmbeddedBrowserDownloadEvent;
  status: CapturedOutputWorkflowStatus;
};

export type UploadTaskBatchLike = UploadBatchLike;

type PersistedCapturedOutputWorkflowItem = {
  download: EmbeddedBrowserDownloadEvent;
  queuedAt: number;
  status: CapturedOutputWorkflowStatus;
};

type PersistedCapturedOutputWorkflow = {
  items: PersistedCapturedOutputWorkflowItem[];
  version: number;
};

function getDefaultStorage(): CapturedOutputWorkflowStorage | undefined {
  if (typeof window === 'undefined') {
    return undefined;
  }
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function normalizePersistedDownload(input: unknown): EmbeddedBrowserDownloadEvent | null {
  if (!input || typeof input !== 'object') return null;
  const value = input as Partial<EmbeddedBrowserDownloadEvent>;
  const downloadId = String(value.downloadId || '').trim();
  const fileName = String(value.fileName || '').trim();
  const tempPath = String(value.tempPath || '').trim();
  const url = String(value.url || '').trim();
  if (!downloadId || !fileName || !tempPath || value.state !== 'completed') {
    return null;
  }
  const receivedBytes = Number(value.receivedBytes);
  const totalBytes = Number(value.totalBytes);
  if (!Number.isFinite(receivedBytes) || receivedBytes < 0 || !Number.isFinite(totalBytes) || totalBytes < 0) {
    return null;
  }
  return {
    downloadId,
    fileName,
    mimeType: String(value.mimeType || '').trim() || undefined,
    pageUrl: String(value.pageUrl || '').trim() || undefined,
    receivedBytes,
    state: 'completed',
    tabId: String(value.tabId || '').trim() || undefined,
    tempPath,
    totalBytes,
    url,
  };
}

function parsePersistedWorkflow(
  raw: string | null,
  now: number,
  maxAgeMs: number,
): { items: CapturedOutputWorkflowItem[]; queuedAtByDownloadId: Map<string, number> } {
  const queuedAtByDownloadId = new Map<string, number>();
  if (!raw) return { items: [], queuedAtByDownloadId };
  try {
    const parsed = JSON.parse(raw) as Partial<PersistedCapturedOutputWorkflow>;
    if (parsed.version !== CAPTURED_OUTPUT_WORKFLOW_STORAGE_VERSION || !Array.isArray(parsed.items)) {
      return { items: [], queuedAtByDownloadId };
    }
    const unique = new Map<string, CapturedOutputWorkflowItem>();
    parsed.items.forEach((item) => {
      if (!item || typeof item !== 'object') return;
      const queuedAt = Number((item as PersistedCapturedOutputWorkflowItem).queuedAt);
      if (!Number.isFinite(queuedAt) || queuedAt <= 0 || now - queuedAt > maxAgeMs) return;
      const download = normalizePersistedDownload((item as PersistedCapturedOutputWorkflowItem).download);
      if (!download || unique.has(download.downloadId)) return;
      // An in-flight import/save cannot be resumed after a renderer restart.
      unique.set(download.downloadId, { download, status: 'pending' });
      queuedAtByDownloadId.set(download.downloadId, queuedAt);
    });
    const items = [...unique.values()].slice(-MAX_PERSISTED_OUTPUTS);
    const retainedIds = new Set(items.map(item => item.download.downloadId));
    queuedAtByDownloadId.forEach((_queuedAt, downloadId) => {
      if (!retainedIds.has(downloadId)) queuedAtByDownloadId.delete(downloadId);
    });
    return { items, queuedAtByDownloadId };
  } catch {
    return { items: [], queuedAtByDownloadId };
  }
}

function readPersistedWorkflow(storage?: CapturedOutputWorkflowStorage) {
  try {
    return storage?.getItem(CAPTURED_OUTPUT_WORKFLOW_STORAGE_KEY) || null;
  } catch {
    return null;
  }
}

export interface CapturedOutputWorkflowCoordinatorOptions {
  acknowledgeDownload?: (downloadId: string) => Promise<boolean>;
  cleanupDownload?: (tempPath?: string) => Promise<boolean>;
  listPendingDownloads?: () => Promise<EmbeddedBrowserDownloadEvent[]>;
  now?: () => number;
  persistedOutputMaxAgeMs?: number;
  storage?: CapturedOutputWorkflowStorage;
  subscribeDownloads?: (listener: DownloadListener) => () => void;
}

/**
 * Keeps completed browser outputs alive independently of any workspace view.
 * The renderer still owns the user decision, while this coordinator owns the
 * application-scoped queue and the one native download subscription.
 */
export class CapturedOutputWorkflowCoordinator {
  private readonly acknowledgeDownload: (downloadId: string) => Promise<boolean>;

  private readonly cleanupDownload: (tempPath?: string) => Promise<boolean>;

  private readonly listPendingDownloads: () => Promise<EmbeddedBrowserDownloadEvent[]>;

  private readonly now: () => number;

  private readonly persistedOutputMaxAgeMs: number;

  private readonly storage?: CapturedOutputWorkflowStorage;

  private readonly eventListeners = new Set<DownloadListener>();

  private readonly listeners = new Set<SnapshotListener>();

  private readonly subscribeDownloads: (listener: DownloadListener) => () => void;

  private downloads: CapturedOutputWorkflowItem[] = [];

  private readonly activeDeliveries = new Set<string>();

  private readonly queuedAtByDownloadId = new Map<string, number>();

  private authSessionCleared = false;

  private sourceUnsubscribe: (() => void) | null = null;

  private handoffHydrationPromise: Promise<void> | null = null;

  constructor(options: CapturedOutputWorkflowCoordinatorOptions = {}) {
    this.acknowledgeDownload = options.acknowledgeDownload || acknowledgeEmbeddedBrowserDownloadHandoff;
    this.cleanupDownload = options.cleanupDownload || cleanupEmbeddedBrowserDownloadedFile;
    this.listPendingDownloads = options.listPendingDownloads || listEmbeddedBrowserDownloadHandoff;
    this.now = options.now || Date.now;
    this.persistedOutputMaxAgeMs = Number.isFinite(options.persistedOutputMaxAgeMs)
      && Number(options.persistedOutputMaxAgeMs) > 0
      ? Number(options.persistedOutputMaxAgeMs)
      : DEFAULT_PERSISTED_OUTPUT_MAX_AGE_MS;
    this.storage = options.storage || getDefaultStorage();
    this.subscribeDownloads = options.subscribeDownloads || subscribeEmbeddedBrowserDownloads;
    const persisted = parsePersistedWorkflow(
      readPersistedWorkflow(this.storage),
      this.now(),
      this.persistedOutputMaxAgeMs,
    );
    this.downloads = persisted.items;
    persisted.queuedAtByDownloadId.forEach((queuedAt, downloadId) => {
      this.queuedAtByDownloadId.set(downloadId, queuedAt);
    });
    this.persistSnapshot();
    listenAuthSessionCleared(() => {
      void this.clearForAuthSession();
    });
  }

  getSnapshot = () => this.downloads;

  subscribe = (listener: SnapshotListener) => {
    this.authSessionCleared = false;
    this.listeners.add(listener);
    this.ensureSourceSubscription();
    listener();
    return () => {
      this.listeners.delete(listener);
    };
  };

  subscribeEvents = (listener: DownloadListener) => {
    this.eventListeners.add(listener);
    this.ensureSourceSubscription();
    return () => {
      this.eventListeners.delete(listener);
    };
  };

  dismiss(downloadId: string) {
    const normalizedId = String(downloadId || '').trim();
    if (!normalizedId) {
      return false;
    }
    const current = this.downloads.find((item) => item.download.downloadId === normalizedId);
    if (!current || current.status !== 'pending') {
      return false;
    }
    const nextDownloads = this.downloads.filter((item) => item.download.downloadId !== normalizedId);
    if (nextDownloads.length === this.downloads.length) {
      return false;
    }
    this.downloads = nextDownloads;
    this.queuedAtByDownloadId.delete(normalizedId);
    this.persistSnapshot();
    this.notifySnapshotListeners();
    void this.acknowledgeDownload(normalizedId).catch(() => undefined);
    return true;
  }

  async runDelivery(
    downloadId: string,
    status: Exclude<CapturedOutputWorkflowStatus, 'pending'>,
    deliver: () => Promise<boolean>,
  ) {
    const normalizedId = String(downloadId || '').trim();
    const current = this.downloads.find((item) => item.download.downloadId === normalizedId);
    if (!current || current.status !== 'pending') {
      return false;
    }
    if (this.activeDeliveries.has(normalizedId)) {
      return false;
    }
    this.activeDeliveries.add(normalizedId);
    this.updateStatus(normalizedId, status);
    try {
      const completed = await deliver();
      if (!completed) {
        if (this.authSessionCleared) {
          await this.discardAuthClearedDelivery(normalizedId, current.download.tempPath);
          return false;
        }
        this.updateStatus(normalizedId, 'pending');
        return false;
      }
      await this.cleanupDownload(current.download.tempPath).catch(() => false);
      await this.acknowledgeDownload(normalizedId).catch(() => false);
      this.removeCompletedDelivery(normalizedId);
      return true;
    } catch (error) {
      if (this.authSessionCleared) {
        await this.discardAuthClearedDelivery(normalizedId, current.download.tempPath);
        return false;
      }
      this.updateStatus(normalizedId, 'pending');
      throw error;
    } finally {
      this.activeDeliveries.delete(normalizedId);
    }
  }

  /** Keeps the upload terminal associated with the queued output after a view unmounts. */
  linkUploadTask(downloadId: string, batch: UploadTaskBatchLike) {
    return this.runDelivery(downloadId, 'importing', async () => {
      return (await resolveUploadBatchTerminal(batch)) === 'completed';
    });
  }

  resetForTests() {
    this.sourceUnsubscribe?.();
    this.sourceUnsubscribe = null;
    this.downloads = [];
    this.activeDeliveries.clear();
    this.queuedAtByDownloadId.clear();
    this.authSessionCleared = false;
    try {
      this.storage?.removeItem(CAPTURED_OUTPUT_WORKFLOW_STORAGE_KEY);
    } catch {
      // Storage may be unavailable in a restricted renderer/test environment.
    }
    this.listeners.clear();
    this.eventListeners.clear();
  }

  async clearForAuthSession() {
    this.authSessionCleared = true;
    const queuedDownloadIds = this.downloads.map(item => item.download.downloadId);
    const pendingPaths = this.downloads
      .filter(item => !this.activeDeliveries.has(item.download.downloadId))
      .map(item => item.download.tempPath)
      .filter((tempPath): tempPath is string => Boolean(tempPath));
    this.downloads = [];
    this.activeDeliveries.clear();
    this.queuedAtByDownloadId.clear();
    try {
      this.storage?.removeItem(CAPTURED_OUTPUT_WORKFLOW_STORAGE_KEY);
    } catch {
      // Storage may be unavailable in a restricted renderer environment.
    }
    await Promise.allSettled(pendingPaths.map(tempPath => this.cleanupDownload(tempPath)));
    await Promise.allSettled(queuedDownloadIds.map(downloadId => this.acknowledgeDownload(downloadId)));
    this.notifySnapshotListeners();
  }

  private ensureSourceSubscription() {
    if (this.sourceUnsubscribe) {
      return;
    }
    const persistedDownloadIds = new Set(
      this.downloads.map(item => item.download.downloadId),
    );
    this.sourceUnsubscribe = this.subscribeDownloads((payload) => {
      this.handleDownload(payload);
    });
    this.handoffHydrationPromise ||= this.listPendingDownloads()
      .then((payloads) => {
        const handoffIds = new Set(
          payloads
            .map(payload => payload.downloadId)
            .filter((downloadId): downloadId is string => Boolean(downloadId)),
        );
        payloads.forEach((payload) => this.handleDownload(payload));

        // Main is authoritative after restart. Only reconcile entries that
        // existed before hydration, so a completion arriving during this
        // async window cannot be removed by an older handoff snapshot.
        const staleDownloads = this.downloads.filter((item) => (
          persistedDownloadIds.has(item.download.downloadId)
          && !handoffIds.has(item.download.downloadId)
        ));
        if (!staleDownloads.length) {
          return;
        }
        const staleIds = new Set(staleDownloads.map(item => item.download.downloadId));
        this.downloads = this.downloads.filter(item => !staleIds.has(item.download.downloadId));
        staleDownloads.forEach((item) => {
          this.queuedAtByDownloadId.delete(item.download.downloadId);
        });
        this.persistSnapshot();
        this.notifySnapshotListeners();
        void Promise.allSettled(
          staleDownloads.map(item => this.cleanupDownload(item.download.tempPath)),
        );
      })
      .catch(() => undefined);
  }

  private handleDownload(payload: EmbeddedBrowserDownloadEvent) {
    this.eventListeners.forEach((listener) => {
      listener(payload);
    });

    if (payload.state === 'completed') {
      if (this.authSessionCleared) {
        void this.cleanupDownload(payload.tempPath).catch(() => undefined);
        void this.acknowledgeDownload(payload.downloadId).catch(() => undefined);
        return;
      }
      if (!payload.downloadId || this.downloads.some((item) => item.download.downloadId === payload.downloadId)) {
        return;
      }
      this.downloads = [...this.downloads, { download: payload, status: 'pending' }];
      this.queuedAtByDownloadId.set(payload.downloadId, this.now());
      this.persistSnapshot();
      this.notifySnapshotListeners();
      return;
    }

    if (payload.downloadId && (payload.state === 'cancelled' || payload.state === 'failed')) {
      const nextDownloads = this.downloads.filter((item) => item.download.downloadId !== payload.downloadId);
      if (nextDownloads.length !== this.downloads.length) {
        this.downloads = nextDownloads;
        this.queuedAtByDownloadId.delete(payload.downloadId);
        this.persistSnapshot();
        this.notifySnapshotListeners();
      }
    }

    if ((payload.state === 'cancelled' || payload.state === 'failed') && payload.tempPath) {
      void this.cleanupDownload(payload.tempPath).catch(() => undefined);
    }
  }

  private notifySnapshotListeners() {
    this.listeners.forEach((listener) => {
      listener();
    });
  }

  private removeCompletedDelivery(downloadId: string) {
    this.downloads = this.downloads.filter((item) => item.download.downloadId !== downloadId);
    this.queuedAtByDownloadId.delete(downloadId);
    this.persistSnapshot();
    this.notifySnapshotListeners();
  }

  private async discardAuthClearedDelivery(downloadId: string, tempPath?: string) {
    await this.cleanupDownload(tempPath).catch(() => false);
    await this.acknowledgeDownload(downloadId).catch(() => false);
    this.removeCompletedDelivery(downloadId);
  }

  private updateStatus(downloadId: string, status: CapturedOutputWorkflowStatus) {
    this.downloads = this.downloads.map((item) => (
      item.download.downloadId === downloadId
        ? { ...item, status }
        : item
    ));
    this.persistSnapshot();
    this.notifySnapshotListeners();
  }

  private persistSnapshot() {
    if (!this.storage) return;
    try {
      const payload: PersistedCapturedOutputWorkflow = {
        items: this.downloads.slice(-MAX_PERSISTED_OUTPUTS).map((item) => ({
          // Persist only completed payloads; progress events and in-flight states are not recoverable.
          download: { ...item.download, state: 'completed' },
          queuedAt: this.queuedAtByDownloadId.get(item.download.downloadId) || this.now(),
          status: item.status,
        })),
        version: CAPTURED_OUTPUT_WORKFLOW_STORAGE_VERSION,
      };
      if (!payload.items.length) {
        this.storage.removeItem(CAPTURED_OUTPUT_WORKFLOW_STORAGE_KEY);
        return;
      }
      this.storage.setItem(CAPTURED_OUTPUT_WORKFLOW_STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // Storage can be unavailable or quota-limited; the in-memory queue remains authoritative.
    }
  }
}

export const capturedOutputWorkflowCoordinator = new CapturedOutputWorkflowCoordinator();
