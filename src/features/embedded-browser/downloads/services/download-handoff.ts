import {
  capturedOutputWorkflowCoordinator,
  type CapturedOutputWorkflowCoordinator,
  type CapturedOutputWorkflowItem,
  type CapturedOutputWorkflowStatus,
  type UploadTaskBatchLike,
} from '../../workflows/captured-output-workflow-coordinator';
import type { EmbeddedBrowserDownloadEvent } from '../types';

type DownloadListener = (payload: EmbeddedBrowserDownloadEvent) => void;

/** Renderer-facing adapter for the application-owned native download handoff. */
export class DownloadHandoff {
  private readonly coordinator: CapturedOutputWorkflowCoordinator;

  constructor(coordinator: CapturedOutputWorkflowCoordinator = capturedOutputWorkflowCoordinator) {
    this.coordinator = coordinator;
  }

  getSnapshot = (): CapturedOutputWorkflowItem[] => this.coordinator.getSnapshot();

  subscribe = (listener: () => void) => this.coordinator.subscribe(listener);

  subscribeEvents = (listener: DownloadListener) => this.coordinator.subscribeEvents(listener);

  dismiss(downloadId: string) {
    return this.coordinator.dismiss(downloadId);
  }

  runDelivery(
    downloadId: string,
    status: Exclude<CapturedOutputWorkflowStatus, 'pending'>,
    deliver: () => Promise<boolean>,
  ) {
    return this.coordinator.runDelivery(downloadId, status, deliver);
  }

  linkUploadTask(downloadId: string, batch: UploadTaskBatchLike) {
    return this.coordinator.linkUploadTask(downloadId, batch);
  }
}

export const downloadHandoff = new DownloadHandoff();
