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
