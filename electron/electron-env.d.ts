/// <reference types="vite-plugin-electron/electron-env" />

declare namespace NodeJS {
  interface ProcessEnv {
    /**
     * The built directory structure
     *
     * ```tree
     * ├─┬─┬ dist
     * │ │ └── index.html
     * │ │
     * │ ├─┬ dist-electron
     * │ │ ├── main.js
     * │ │ └── preload.js
     * │
     * ```
     */
    APP_ROOT: string
    /** /dist/ or /public/ */
    VITE_PUBLIC: string
  }
}

// Used in Renderer process, expose in `preload.ts`
interface Window {
  ipcRenderer: import('electron').IpcRenderer

  electronAPI: {
    pickUploadFiles: () => Promise<{
      canceled: boolean;
      files: Array<{
        name: string;
        size: number;
        localPath: string;
        relativePath: string;
      }>;
    }>;
    pickUploadFolders: () => Promise<{
      canceled: boolean;
      files: Array<{
        name: string;
        size: number;
        localPath: string;
        relativePath: string;
      }>;
    }>;
    pickDownloadDirectory: () => Promise<{
      canceled: boolean;
      directoryPath: string;
    }>;
    pickAutoImportDirectory: () => Promise<{
      canceled: boolean;
      directoryPath: string;
    }>;
    ensureDirectory: (baseDirectory: string, relativePath: string) => Promise<string>;
    downloadUrlToPath: (
      url: string,
      baseDirectory: string,
      relativePath: string,
      headers?: Record<string, string>,
    ) => Promise<string>;
    claimAutoImportFiles: (watchDirectory: string, maxFiles?: number) => Promise<{
      canceled: boolean;
      files: Array<{
        name: string;
        size: number;
        localPath: string;
        relativePath: string;
      }>;
    }>;
    cleanupAutoImportStagedFile: (stagedPath: string) => Promise<boolean>;
    onUploadProgress: (listener: (payload: {
      uploadId: string;
      uploadedBytes: number;
      totalBytes: number;
      percentage: number;
      speedBps: number;
    }) => void) => () => void;
    getStaticData: () => Promise<{
      totalStorage: number;
      cpuModel: string;
      totalMemoryGB: number;
    }>;
    zoomAdjust: (delta: number) => void; // 添加 zoomAdjust 方法
    fetch: (
      url: string,
      options?: any
    ) => Promise<{
      status: number;
      headers: Record<string, string | string[]>;
      body: any;
    }>;
    upload: (
      url: string,
      filePath: string,
      formDataParams?: Record<string, string>,
      headers?: Record<string, string>,
      uploadId?: string
    ) => Promise<{
      status: number;
      body: any;
    }>;
    uploadAbort: (uploadId: string) => Promise<boolean>;
  };

  electronWindow: {
    minimize: () => void;
    maximize: () => void;
    close: () => void;
    activate: (temporaryOnTop?: boolean) => Promise<boolean>;
  };
}

type EmbeddedBrowserBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

interface Window {
  electronEmbeddedBrowser: {
    close: () => Promise<void>;
    navigate: (url: string) => Promise<void>;
    onStateChange: (listener: (payload: {
      details?: string;
      message?: string;
      meta?: string[];
      state?: 'idle' | 'loading' | 'ready' | 'error';
      url?: string;
    }) => void) => () => void;
    open: (url: string) => Promise<void>;
    reload: () => Promise<void>;
    setBounds: (bounds: EmbeddedBrowserBounds) => Promise<void>;
  };
}
