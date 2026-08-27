export {
  CapturedResourceContract,
} from '../../../../electron/service/embedded-browser/contracts/captured-resource';
export type {
  ActiveResourceStateSnapshot as EmbeddedBrowserResourceCaptureSnapshot,
  CapturedResourceKind as EmbeddedBrowserCapturedResourceKind,
  CapturedResourceProjection as EmbeddedBrowserCapturedResource,
  CapturedResourceSource as EmbeddedBrowserCapturedResourceSource,
  ResourceStateChange as EmbeddedBrowserResourceStateChange,
  ResourceStateSnapshot as EmbeddedBrowserResourceStateSnapshot,
} from '../../../../electron/service/embedded-browser/contracts/captured-resource';

export type EmbeddedBrowserCatchToolkitState = {
  audioResourceKey: string;
  audioSizeBytes: number;
  autoSeekToBufferedEnd: boolean;
  autoDownloadOnComplete: boolean;
  capturedMediaSizeBytes: number;
  clearCacheOnComplete: boolean;
  currentFileName: string;
  diagnostics: {
    appendBufferCount: number;
    frameCount?: number;
    frameUrl: string;
    hookErrors: number;
    installedAt: number;
    lastAppendAt: number;
    lastError: string;
    mediaSourceAvailable: boolean;
    mediaSourceHooked: boolean;
    sourceBufferCount: number;
  };
  isCaptureComplete: boolean;
  manualFileName: string;
  primaryResourceKey: string;
  regexWarning: string;
  regexRule: string;
  restartAlwaysFromBeginning: boolean;
  selectorWarning: string;
  selectorRule: string;
  streamCount: number;
  trimExtraMediaHeaders: boolean;
  videoResourceKey: string;
  videoSizeBytes: number;
};
