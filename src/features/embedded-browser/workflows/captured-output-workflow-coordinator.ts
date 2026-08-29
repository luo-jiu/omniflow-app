import {
  cleanupEmbeddedBrowserDownloadedFile,
  subscribeEmbeddedBrowserDownloads,
} from '../downloads/services/embedded-browser-download.api';
import type { EmbeddedBrowserDownloadEvent } from '../downloads/types';

type DownloadListener = (payload: EmbeddedBrowserDownloadEvent) => void;
type SnapshotListener = () => void;

export interface CapturedOutputWorkflowCoordinatorOptions {
  cleanupDownload?: (tempPath?: string) => Promise<boolean>;
  subscribeDownloads?: (listener: DownloadListener) => () => void;
}

/**
 * Keeps completed browser outputs alive independently of any workspace view.
 * The renderer still owns the user decision, while this coordinator owns the
 * application-scoped queue and the one native download subscription.
 */
export class CapturedOutputWorkflowCoordinator {
  private readonly cleanupDownload: (tempPath?: string) => Promise<boolean>;

  private readonly eventListeners = new Set<DownloadListener>();

  private readonly listeners = new Set<SnapshotListener>();

  private readonly subscribeDownloads: (listener: DownloadListener) => () => void;

  private downloads: EmbeddedBrowserDownloadEvent[] = [];

  private sourceUnsubscribe: (() => void) | null = null;

  constructor(options: CapturedOutputWorkflowCoordinatorOptions = {}) {
    this.cleanupDownload = options.cleanupDownload || cleanupEmbeddedBrowserDownloadedFile;
    this.subscribeDownloads = options.subscribeDownloads || subscribeEmbeddedBrowserDownloads;
  }

  getSnapshot = () => this.downloads;

  subscribe = (listener: SnapshotListener) => {
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
    const nextDownloads = this.downloads.filter((download) => download.downloadId !== normalizedId);
    if (nextDownloads.length === this.downloads.length) {
      return false;
    }
    this.downloads = nextDownloads;
    this.notifySnapshotListeners();
    return true;
  }

  resetForTests() {
    this.sourceUnsubscribe?.();
    this.sourceUnsubscribe = null;
    this.downloads = [];
    this.listeners.clear();
    this.eventListeners.clear();
  }

  private ensureSourceSubscription() {
    if (this.sourceUnsubscribe) {
      return;
    }
    this.sourceUnsubscribe = this.subscribeDownloads((payload) => {
      this.handleDownload(payload);
    });
  }

  private handleDownload(payload: EmbeddedBrowserDownloadEvent) {
    this.eventListeners.forEach((listener) => {
      listener(payload);
    });

    if (payload.state === 'completed') {
      if (!payload.downloadId || this.downloads.some((download) => download.downloadId === payload.downloadId)) {
        return;
      }
      this.downloads = [...this.downloads, payload];
      this.notifySnapshotListeners();
      return;
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
}

export const capturedOutputWorkflowCoordinator = new CapturedOutputWorkflowCoordinator();
