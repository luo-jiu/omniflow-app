export const LIBRARY_FILE_BROWSER_DRAG_DATA_TYPE = 'application/x-omniflow-library-file'

export interface FileTransferDownloadUrlEnvironment {
  origin: string
  runtimeToken: string
  claimTtlMs: number
}

export interface LibraryFileBrowserDragPayload {
  claimId: string
  fileName: string
  mimeType?: string
}

export interface LibraryFileBrowserDropPayload extends LibraryFileBrowserDragPayload {
  clientX: number
  clientY: number
  frameCoordinateSupported: boolean
  pageUrl: string
}

export interface LibraryFileBrowserDropResult {
  error?: string
  fileName: string
  status: 'preparing' | 'delivered' | 'failed'
  tabId: string
}
