export type AppUpdateStatus =
  | 'disabled'
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'available'
  | 'downloading'
  | 'verifying'
  | 'downloaded'
  | 'installing'
  | 'error';

export interface AppUpdateProgress {
  bytesPerSecond: number;
  percent: number;
  total: number;
  transferred: number;
}

export interface AppUpdateSnapshot {
  availableVersion: string | null;
  checkedAt: number | null;
  currentVersion: string;
  message: string | null;
  progress: AppUpdateProgress | null;
  releaseNotes: string | null;
  status: AppUpdateStatus;
  supported: boolean;
}
