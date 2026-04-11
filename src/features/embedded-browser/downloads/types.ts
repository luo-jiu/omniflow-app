export type EmbeddedBrowserDownloadEvent = {
  downloadId: string;
  error?: string;
  fileName: string;
  mimeType?: string;
  pageUrl?: string;
  receivedBytes: number;
  state: 'started' | 'progress' | 'completed' | 'cancelled' | 'failed';
  tabId?: string;
  tempPath?: string;
  totalBytes: number;
  url: string;
};

export type LibraryFolderEntry = {
  id: number;
  name: string;
};
