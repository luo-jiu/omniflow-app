import {
  cleanupEmbeddedBrowserDownloadedFile,
  subscribeEmbeddedBrowserDownloads,
} from '../downloads/services/embedded-browser-download.api';
import type { EmbeddedBrowserDownloadEvent } from '../downloads/types';

type DownloadListener = (payload: EmbeddedBrowserDownloadEvent) => void;
type SnapshotListener = () => void;

export type CapturedOutputWorkflowStatus = 'importing' | 'pending' | 'saving';

export type CapturedOutputWorkflowItem = {
  download: EmbeddedBrowserDownloadEvent;
  status: CapturedOutputWorkflowStatus;
};

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

  private downloads: CapturedOutputWorkflowItem[] = [];

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
    const current = this.downloads.find((item) => item.download.downloadId === normalizedId);
    if (!current || current.status !== 'pending') {
      return false;
    }
    const nextDownloads = this.downloads.filter((item) => item.download.downloadId !== normalizedId);
    if (nextDownloads.length === this.downloads.length) {
      return false;
    }
    this.downloads = nextDownloads;
    this.notifySnapshotListeners();
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
    this.updateStatus(normalizedId, status);
    try {
      const completed = await deliver();
      if (!completed) {
        this.updateStatus(normalizedId, 'pending');
        return false;
      }
      await this.cleanupDownload(current.download.tempPath).catch(() => false);
      this.removeCompletedDelivery(normalizedId);
      return true;
    } catch (error) {
      this.updateStatus(normalizedId, 'pending');
      throw error;
    }
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
      if (!payload.downloadId || this.downloads.some((item) => item.download.downloadId === payload.downloadId)) {
        return;
      }
      this.downloads = [...this.downloads, { download: payload, status: 'pending' }];
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

  private removeCompletedDelivery(downloadId: string) {
    this.downloads = this.downloads.filter((item) => item.download.downloadId !== downloadId);
    this.notifySnapshotListeners();
  }

  private updateStatus(downloadId: string, status: CapturedOutputWorkflowStatus) {
    this.downloads = this.downloads.map((item) => (
      item.download.downloadId === downloadId
        ? { ...item, status }
        : item
    ));
    this.notifySnapshotListeners();
  }
}

export const capturedOutputWorkflowCoordinator = new CapturedOutputWorkflowCoordinator();
