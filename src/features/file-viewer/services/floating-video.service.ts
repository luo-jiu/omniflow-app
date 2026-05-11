import { mediaRegistry } from '@/contexts/media-registry.singleton';
import { type MediaRegistryRegistration } from '@/contexts/media-registry.context';
import {
  getGlobalVideoElement,
  releaseGlobalVideoElement,
} from './global-video-elements';
import { createDocumentPipShell, type DocumentPipShell } from './document-pip-shell';

// 单例 entryId：同一时刻最多一条 video 记录在 MediaHub 中。详见 docs/media-hub-contract.md。
const VIDEO_REGISTRY_ENTRY_ID = 'video:active';

const DEBUG_TAG = '[floating-video]';
function dbg(...args: unknown[]) {
  // 临时定位用：浮窗保活异常时的事件追踪。稳定后移除。
  console.log(DEBUG_TAG, ...args);
}

type FloatingVideoHostMode = 'inline' | 'app-floating' | 'document-pip' | 'system-window';

type DocumentPictureInPictureController = {
  requestWindow(options?: { width?: number; height?: number }): Promise<Window>;
};

type WindowWithDocumentPictureInPicture = Window & {
  documentPictureInPicture?: DocumentPictureInPictureController;
};

type DocumentPipRequestSnapshot = {
  key: string;
  tabId: string | null;
  element: HTMLVideoElement | null;
};

type SystemVideoWindowStatePayload = {
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  volume: number;
  muted: boolean;
  ended: boolean;
};

export interface FloatingVideoState {
  visible: boolean;
  hostMode: FloatingVideoHostMode;
  key: string | null;
  libraryId: number | null;
  tabId: string | null;
  nodeId: number | null;
  fileName: string;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  thumbnailUrl?: string;
}

export interface BindInlineMeta {
  key: string;
  libraryId: number | null;
  tabId: string;
  nodeId: number | null;
  fileName: string;
  thumbnailUrl?: string;
  forceInline?: boolean;
}

type StateListener = (state: FloatingVideoState) => void;

const INITIAL_STATE: FloatingVideoState = {
  visible: false,
  hostMode: 'inline',
  key: null,
  libraryId: null,
  tabId: null,
  nodeId: null,
  fileName: '',
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  thumbnailUrl: undefined,
};

class FloatingVideoService {
  private state: FloatingVideoState = INITIAL_STATE;
  private listeners = new Set<StateListener>();
  private floatingHostEl: HTMLDivElement | null = null;
  private boundElement: HTMLVideoElement | null = null;
  private pendingHandoff: { key: string; mountToken: number } | null = null;
  // 自动续播"单发"开关：handoff 进入浮窗时上膛一次；用户手动操作或一次续播尝试后立即卸膛。
  // 这样路由切换造成 Chromium 自发暂停时能补一次 play()，但不会跟用户后续的手动 pause 抢节奏。
  private autoResumeArmed = false;
  private autoResumeTimer: number | null = null;
  private registration: MediaRegistryRegistration | null = null;
  private registeredTabId: string | null = null;
  // 一旦视频被用户触发过 play()，就持续在 MediaHub 中显示，直到 dismiss。匹配旧 useRegisterMediaEntry 的 hasStartedPlaying 语义。
  private hasStarted = false;
  private documentPipWindow: Window | null = null;
  private documentPipHostEl: HTMLDivElement | null = null;
  private documentPipShell: DocumentPipShell | null = null;
  private closingDocumentPipForInline = false;
  private systemWindowUnsubscribers: Array<() => void> = [];

  private onPlay = () => {
    if (this.state.hostMode === 'system-window') return;
    dbg('video.event play', { key: this.state.key, paused: this.boundElement?.paused, ct: this.boundElement?.currentTime });
    this.hasStarted = true;
    this.setState({ isPlaying: true });
  };
  private onPause = () => {
    if (this.state.hostMode === 'system-window') return;
    const el = this.boundElement;
    dbg('video.event pause', { key: this.state.key, paused: el?.paused, ended: el?.ended, ct: el?.currentTime, armed: this.autoResumeArmed });
    this.setState({ isPlaying: false });
    if (this.autoResumeArmed && el && !el.ended) {
      this.autoResumeArmed = false;
      this.scheduleAutoResume();
    }
  };
  private onSuspend = () => dbg('video.event suspend', { connected: this.boundElement?.isConnected, paused: this.boundElement?.paused });
  private onAbort = () => dbg('video.event abort', { connected: this.boundElement?.isConnected, paused: this.boundElement?.paused });
  private onEmptied = () => dbg('video.event emptied', { connected: this.boundElement?.isConnected, paused: this.boundElement?.paused });
  private onStalled = () => dbg('video.event stalled', { connected: this.boundElement?.isConnected, paused: this.boundElement?.paused });
  private onWaiting = () => dbg('video.event waiting', { connected: this.boundElement?.isConnected, paused: this.boundElement?.paused });
  private onTimeUpdate = () => {
    if (this.state.hostMode === 'system-window') return;
    const el = this.boundElement;
    if (!el) return;
    this.setState({
      currentTime: Number.isFinite(el.currentTime) ? el.currentTime : 0,
    });
  };
  private onLoadedMetadata = () => {
    if (this.state.hostMode === 'system-window') return;
    const el = this.boundElement;
    if (!el) return;
    this.setState({
      duration: Number.isFinite(el.duration) ? el.duration : 0,
      currentTime: Number.isFinite(el.currentTime) ? el.currentTime : 0,
    });
  };

  subscribe = (listener: StateListener) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getState = (): FloatingVideoState => this.state;

  bindInline = (meta: BindInlineMeta) => {
    dbg('bindInline', { meta, prevKey: this.state.key, prevVisible: this.state.visible });
    const isNewKey = this.state.key !== meta.key;
    const shouldForceInline = meta.forceInline || isNewKey || this.state.hostMode === 'inline';
    const shouldRestoreFromSystemWindow = !isNewKey && this.state.hostMode === 'system-window';
    const systemWindowTime = this.state.currentTime;
    const systemWindowWasPlaying = this.state.isPlaying;

    if (!shouldForceInline && this.state.key === meta.key) {
      this.setState({
        libraryId: meta.libraryId,
        tabId: meta.tabId,
        nodeId: meta.nodeId,
        fileName: meta.fileName,
        thumbnailUrl: meta.thumbnailUrl,
      });
      return;
    }

    this.closeDocumentPipForInlineRestore();
    if (this.state.hostMode === 'system-window') {
      this.closeSystemVideoWindow();
    }
    // 切到新视频时，若浮窗里还有旧视频，释放旧元素，避免双实例。
    if (this.state.key && isNewKey && this.state.hostMode !== 'inline') {
      releaseGlobalVideoElement(this.state.key);
    }
    if (isNewKey) {
      this.hasStarted = false;
    }
    this.attachVideoListeners(meta.key);
    const el = this.boundElement;
    // 回到 inline：卸膛 + 清掉残留 timer，浮窗逻辑完全交还给 inline 模式。
    this.autoResumeArmed = false;
    this.clearAutoResumeTimer();
    if (shouldRestoreFromSystemWindow && el && Number.isFinite(systemWindowTime)) {
      el.currentTime = systemWindowTime;
    }
    this.setState({
      visible: false,
      hostMode: 'inline',
      key: meta.key,
      libraryId: meta.libraryId,
      tabId: meta.tabId,
      nodeId: meta.nodeId,
      fileName: meta.fileName,
      thumbnailUrl: meta.thumbnailUrl,
      isPlaying: el ? !el.paused && !el.ended : false,
      currentTime: el && Number.isFinite(el.currentTime) ? el.currentTime : 0,
      duration: el && Number.isFinite(el.duration) ? el.duration : 0,
    });
    if (shouldRestoreFromSystemWindow && systemWindowWasPlaying && el && !el.ended) {
      void el.play().catch(() => {
        /* swallow restore autoplay rejection */
      });
    }
  };

  requestSystemFloating = async () => {
    const key = this.state.key;
    if (!key) {
      dbg('requestSystemFloating.skip no key');
      return false;
    }
    const el = this.boundElement;
    const requestSnapshot: DocumentPipRequestSnapshot = {
      key,
      tabId: this.state.tabId,
      element: el,
    };
    const wasPlaying = !!(el && !el.paused && !el.ended) || this.state.isPlaying;
    this.autoResumeArmed = wasPlaying;
    const canDocumentPip = this.canUseDocumentPictureInPicture();
    dbg('requestSystemFloating.start', {
      key,
      tabId: this.state.tabId,
      hostMode: this.state.hostMode,
      canDocumentPip,
      hasElement: !!el,
      paused: el?.paused,
      currentTime: el?.currentTime,
      wasPlaying,
    });

    if (canDocumentPip) {
      try {
        const opened = await this.openDocumentPictureInPicture(requestSnapshot);
        dbg('requestSystemFloating.document-pip.result', { opened, hostMode: this.state.hostMode });
        if (opened) return true;
      } catch (error) {
        dbg('document-pip.open failed, fallback app-floating', { error: String(error) });
      }
    }

    if (!this.isSameVideoRequest(requestSnapshot)) {
      dbg('requestSystemFloating.skip stale before app-floating', {
        requestKey: requestSnapshot.key,
        stateKey: this.state.key,
      });
      return false;
    }
    const openedSystemWindow = await this.openSystemVideoWindow(requestSnapshot, wasPlaying);
    if (openedSystemWindow) return true;
    if (!this.isSameVideoRequest(requestSnapshot)) {
      dbg('requestSystemFloating.skip stale before app-floating after system-window', {
        requestKey: requestSnapshot.key,
        stateKey: this.state.key,
      });
      return false;
    }
    this.showAppFloating();
    return false;
  };

  // 关闭某个 tab 时由 FileViewerContext 调用：若当前视频归属于该 tab，整体释放。
  releaseForTab = (tabId: string) => {
    if (this.state.tabId !== tabId) return;
    this.dismiss();
  };

  handoffToFloating = (key: string, mountToken: number) => {
    const el = this.boundElement;
    dbg('handoffToFloating.start', {
      key,
      mountToken,
      stateKey: this.state.key,
      hostReady: !!this.floatingHostEl,
      paused: el?.paused,
      ct: el?.currentTime,
      connected: el?.isConnected,
      parentTag: el?.parentElement?.tagName,
      parentClass: el?.parentElement?.className,
      pathname: typeof window !== 'undefined' ? window.location.pathname : '',
    });
    if (this.state.key !== key) {
      dbg('handoffToFloating.skip stale key', { wantKey: key, curKey: this.state.key });
      return;
    }
    if (this.state.hostMode === 'document-pip') {
      dbg('handoffToFloating.keep document-pip', { key });
      this.setState({ visible: false });
      return;
    }
    // 仅当离开 inline 时元素是播放中，才上膛一次自动续播 —— 用户原本暂停的视频不会被强行播放。
    const wasPlaying = !!(el && !el.paused && !el.ended) || this.state.isPlaying;
    this.autoResumeArmed = wasPlaying;

    if (this.floatingHostEl) {
      this.showAppFloating();
    } else {
      dbg('handoffToFloating.host not ready, pending', { key, mountToken });
      this.pendingHandoff = { key, mountToken };
    }
    const elAfter = this.boundElement;
    dbg('handoffToFloating.end', {
      paused: elAfter?.paused,
      connected: elAfter?.isConnected,
      parentClass: elAfter?.parentElement?.className,
      armed: this.autoResumeArmed,
    });
    // 若移动到浮窗时元素已被 Chromium 提前暂停，把 armed 烧掉立刻补一次 play()。
    if (this.autoResumeArmed && elAfter && elAfter.paused && !elAfter.ended) {
      this.autoResumeArmed = false;
      this.scheduleAutoResume();
    }
  };

  attachFloatingHost = (el: HTMLDivElement | null) => {
    dbg('attachFloatingHost', { hadEl: !!this.floatingHostEl, nextEl: !!el, hadPending: !!this.pendingHandoff });
    this.floatingHostEl = el;
    if (el && this.pendingHandoff) {
      this.pendingHandoff = null;
      this.showAppFloating();
    }
  };

  play = () => {
    this.autoResumeArmed = false;
    this.clearAutoResumeTimer();
    if (this.state.hostMode === 'system-window') {
      void window.electronSystemVideo?.play();
      this.setState({ isPlaying: true });
      return;
    }
    const el = this.boundElement;
    if (!el) return;
    void el.play().catch(() => {
      /* swallow autoplay rejection */
    });
  };

  pause = () => {
    this.autoResumeArmed = false;
    this.clearAutoResumeTimer();
    if (this.state.hostMode === 'system-window') {
      void window.electronSystemVideo?.pause();
      this.setState({ isPlaying: false });
      return;
    }
    const el = this.boundElement;
    if (!el) return;
    if (!el.paused) el.pause();
  };

  seek = (time: number) => {
    if (this.state.hostMode === 'system-window') {
      const duration = Number.isFinite(this.state.duration) ? this.state.duration : 0;
      const next = duration > 0 ? Math.min(Math.max(time, 0), duration) : Math.max(time, 0);
      void window.electronSystemVideo?.seek(next);
      this.setState({ currentTime: next });
      return;
    }
    const el = this.boundElement;
    if (!el || !Number.isFinite(time)) return;
    const duration = Number.isFinite(el.duration) ? el.duration : 0;
    const next = duration > 0 ? Math.min(Math.max(time, 0), duration) : Math.max(time, 0);
    el.currentTime = next;
    this.setState({ currentTime: next });
  };

  // 软关闭：暂停 + 收起浮窗 UI；不释放元素，不动 hasStarted，不取消 hub 注册。
  // 元素留在 floating host（transform 移到屏外），保持 connected document。
  // 用户回到 library tab 时 mountGlobalVideoElement 把元素搬回 inline。
  // 详见 docs/media-hub-contract.md。
  softClose = () => {
    this.autoResumeArmed = false;
    this.clearAutoResumeTimer();
    const el = this.boundElement;
    if (el && !el.paused) el.pause();
    if (this.state.hostMode === 'system-window') {
      void window.electronSystemVideo?.pause();
      this.closeSystemVideoWindow();
      this.setState({ visible: false, hostMode: 'inline', isPlaying: false });
      return;
    }
    if (this.state.hostMode === 'document-pip') {
      this.closeDocumentPipToAppFloating({ pause: true, visible: false });
      return;
    }
    this.setState({ visible: false, hostMode: 'app-floating' });
  };

  // 收起：仅收起浮窗 UI，不暂停。tab/元素/hub entry 全保留。
  hide = () => {
    this.autoResumeArmed = false;
    this.clearAutoResumeTimer();
    if (this.state.hostMode === 'system-window') {
      return;
    }
    if (this.state.hostMode === 'document-pip') {
      this.closeDocumentPipToAppFloating({ pause: false, visible: false });
      return;
    }
    this.setState({ visible: false, hostMode: 'app-floating' });
  };

  dismiss = () => {
    const key = this.state.key;
    this.autoResumeArmed = false;
    this.clearAutoResumeTimer();
    this.cleanupDocumentPipWindow({ close: true });
    this.closeSystemVideoWindow();
    this.detachVideoListeners();
    if (key) {
      releaseGlobalVideoElement(key);
    }
    this.boundElement = null;
    this.pendingHandoff = null;
    this.hasStarted = false;
    this.state = { ...INITIAL_STATE };
    this.emit();
  };

  private canUseDocumentPictureInPicture() {
    const controller = (window as WindowWithDocumentPictureInPicture).documentPictureInPicture;
    return typeof controller?.requestWindow === 'function';
  }

  private async openSystemVideoWindow(requestSnapshot: DocumentPipRequestSnapshot, wasPlaying: boolean) {
    const el = requestSnapshot.element;
    const api = window.electronSystemVideo;
    const src = el?.currentSrc || el?.src || '';
    if (!api || !requestSnapshot.key || !el || !src) {
      dbg('system-window.skip unavailable', { hasApi: !!api, hasElement: !!el, hasSrc: !!src });
      return false;
    }
    this.ensureSystemWindowListeners();
    const currentTime = Number.isFinite(el.currentTime) ? el.currentTime : 0;
    const duration = Number.isFinite(el.duration) ? el.duration : 0;
    const volume = Number.isFinite(el.volume) ? el.volume : 1;
    try {
      const opened = await api.open({
        src,
        title: this.state.fileName || '视频',
        currentTime,
        duration,
        isPlaying: wasPlaying,
        volume,
        muted: el.muted,
      });
      dbg('system-window.open.result', { opened });
      if (!opened || !this.isSameVideoRequest(requestSnapshot)) {
        if (opened) void api.close();
        return false;
      }
      this.autoResumeArmed = false;
      if (!el.paused) el.pause();
      this.setState({
        visible: false,
        hostMode: 'system-window',
        isPlaying: wasPlaying,
        currentTime,
        duration,
      });
      return true;
    } catch (error) {
      dbg('system-window.open failed, fallback app-floating', { error: String(error) });
      return false;
    }
  }

  private ensureSystemWindowListeners() {
    if (this.systemWindowUnsubscribers.length > 0) return;
    const api = window.electronSystemVideo;
    if (!api) return;
    this.systemWindowUnsubscribers = [
      api.onState((payload) => this.handleSystemWindowState(payload)),
      api.onClosed((payload) => this.handleSystemWindowClosed(payload)),
    ];
  }

  private handleSystemWindowState(payload: SystemVideoWindowStatePayload) {
    if (this.state.hostMode !== 'system-window') return;
    this.setState({
      currentTime: Number.isFinite(payload.currentTime) ? payload.currentTime : 0,
      duration: Number.isFinite(payload.duration) ? payload.duration : 0,
      isPlaying: payload.isPlaying,
    });
  }

  private handleSystemWindowClosed(payload: SystemVideoWindowStatePayload | null) {
    if (this.state.hostMode !== 'system-window') return;
    const el = this.boundElement;
    const nextTime = payload && Number.isFinite(payload.currentTime) ? payload.currentTime : this.state.currentTime;
    if (el && Number.isFinite(nextTime)) {
      el.currentTime = nextTime;
    }
    this.setState({
      visible: false,
      hostMode: 'inline',
      isPlaying: false,
      currentTime: Number.isFinite(nextTime) ? nextTime : 0,
      duration: payload && Number.isFinite(payload.duration) ? payload.duration : this.state.duration,
    });
  }

  private closeSystemVideoWindow() {
    void window.electronSystemVideo?.close();
  }

  private async openDocumentPictureInPicture(requestSnapshot: DocumentPipRequestSnapshot) {
    if (!requestSnapshot.key || !requestSnapshot.element) throw new Error('No active video');
    const controller = (window as WindowWithDocumentPictureInPicture).documentPictureInPicture;
    if (!controller) throw new Error('Document Picture-in-Picture is not available');

    this.cleanupDocumentPipWindow({ close: true });
    const pipWindow = await controller.requestWindow({ width: 480, height: 320 });
    if (!this.isSameVideoRequest(requestSnapshot)) {
      closePipWindow(pipWindow);
      return false;
    }
    const isReady = await this.waitForDocumentPipWindowReady(pipWindow);
    if (!isReady) {
      dbg('document-pip.unusable, fallback app-floating', this.getDocumentPipWindowSnapshot(pipWindow));
      closePipWindow(pipWindow);
      return false;
    }

    this.documentPipWindow = pipWindow;
    this.closingDocumentPipForInline = false;
    this.renderDocumentPipShell(pipWindow);
    this.moveElementToDocumentPipHost();
    try {
      pipWindow.focus();
    } catch (error) {
      dbg('document-pip.focus failed', { error: String(error) });
    }
    dbg('document-pip.opened', {
      closed: pipWindow.closed,
      innerWidth: pipWindow.innerWidth,
      innerHeight: pipWindow.innerHeight,
      outerWidth: pipWindow.outerWidth,
      outerHeight: pipWindow.outerHeight,
      screenX: pipWindow.screenX,
      screenY: pipWindow.screenY,
      visibilityState: pipWindow.document.visibilityState,
      activeElement: pipWindow.document.activeElement?.tagName,
    });
    pipWindow.addEventListener('pagehide', this.handleDocumentPipPageHide);
    this.setState({ visible: false, hostMode: 'document-pip' });

    const elAfter = this.boundElement;
    if (this.autoResumeArmed && elAfter && elAfter.paused && !elAfter.ended) {
      this.autoResumeArmed = false;
      this.scheduleAutoResume();
    }
    return true;
  }

  private renderDocumentPipShell(pipWindow: Window) {
    const shell = createDocumentPipShell(
      pipWindow,
      {
        hide: () => this.hide(),
        softClose: () => this.softClose(),
        togglePlay: () => {
          if (this.state.isPlaying) {
            this.pause();
          } else {
            this.play();
          }
        },
      },
      this.getDocumentPipShellState(),
    );
    this.documentPipHostEl = shell.host;
    this.documentPipShell = shell;
    this.updateDocumentPipShell();
  }

  private handleDocumentPipPageHide = () => {
    const returningInline = this.closingDocumentPipForInline;
    dbg('document-pip.pagehide', { returningInline, key: this.state.key });
    if (returningInline) {
      this.cleanupDocumentPipWindow({ close: false });
      this.closingDocumentPipForInline = false;
      return;
    }
    this.closeDocumentPipToAppFloating({ pause: true, visible: false, closeWindow: false });
  };

  private closeDocumentPipForInlineRestore() {
    const pipWindow = this.documentPipWindow;
    if (!pipWindow) return;
    this.closingDocumentPipForInline = true;
    this.cleanupDocumentPipWindow({ close: false });
    try {
      if (!pipWindow.closed) pipWindow.close();
    } catch (error) {
      dbg('document-pip.close for inline failed', { error: String(error) });
    } finally {
      this.closingDocumentPipForInline = false;
    }
  }

  private closeDocumentPipToAppFloating(options: { pause: boolean; visible: boolean; closeWindow?: boolean }) {
    const el = this.boundElement;
    if (options.pause && el && !el.paused) el.pause();
    this.moveElementToFloatingHost();
    this.cleanupDocumentPipWindow({ close: options.closeWindow ?? true });
    this.setState({
      hostMode: 'app-floating',
      visible: options.visible,
      isPlaying: el ? !el.paused && !el.ended : false,
    });
  }

  private cleanupDocumentPipWindow(options: { close: boolean }) {
    const pipWindow = this.documentPipWindow;
    if (pipWindow) {
      pipWindow.removeEventListener('pagehide', this.handleDocumentPipPageHide);
      if (options.close) {
        try {
          if (!pipWindow.closed) pipWindow.close();
        } catch (error) {
          dbg('document-pip.close failed', { error: String(error) });
        }
      }
    }
    this.documentPipWindow = null;
    this.documentPipHostEl = null;
    this.documentPipShell = null;
  }

  private updateDocumentPipShell() {
    this.documentPipShell?.update(this.getDocumentPipShellState());
  }

  private getDocumentPipShellState() {
    return {
      title: this.state.fileName || '视频',
      isPlaying: this.state.isPlaying,
      currentTime: this.state.currentTime,
      duration: this.state.duration,
    };
  }

  private isSameVideoRequest(requestSnapshot: DocumentPipRequestSnapshot) {
    return this.state.key === requestSnapshot.key
      && this.state.tabId === requestSnapshot.tabId
      && this.boundElement === requestSnapshot.element;
  }

  private async waitForDocumentPipWindowReady(pipWindow: Window) {
    const start = window.performance.now();
    while (window.performance.now() - start < 320) {
      if (this.isDocumentPipWindowUsable(pipWindow)) return true;
      if (pipWindow.closed) return false;
      await new Promise<void>((resolve) => {
        window.requestAnimationFrame(() => resolve());
      });
    }
    return this.isDocumentPipWindowUsable(pipWindow);
  }

  private isDocumentPipWindowUsable(pipWindow: Window) {
    if (pipWindow.closed) return false;
    const { innerWidth, innerHeight, outerWidth, outerHeight } = pipWindow;
    const width = Math.max(innerWidth || 0, outerWidth || 0);
    const height = Math.max(innerHeight || 0, outerHeight || 0);
    return width > 0 && height > 0;
  }

  private getDocumentPipWindowSnapshot(pipWindow: Window) {
    return {
      closed: pipWindow.closed,
      innerWidth: pipWindow.innerWidth,
      innerHeight: pipWindow.innerHeight,
      outerWidth: pipWindow.outerWidth,
      outerHeight: pipWindow.outerHeight,
      screenX: pipWindow.screenX,
      screenY: pipWindow.screenY,
      visibilityState: pipWindow.document.visibilityState,
    };
  }

  private moveElementToDocumentPipHost() {
    const key = this.state.key;
    const host = this.documentPipHostEl;
    if (!key || !host) return;
    const el = getGlobalVideoElement(key);
    if (el.parentElement !== host) {
      host.appendChild(el);
    }
  }

  private showAppFloating() {
    dbg('showAppFloating.start', {
      key: this.state.key,
      hasFloatingHost: !!this.floatingHostEl,
      currentHostMode: this.state.hostMode,
    });
    this.cleanupDocumentPipWindow({ close: true });
    this.setState({ visible: true, hostMode: 'app-floating' });
    this.moveElementToFloatingHost();
    dbg('showAppFloating.end', {
      visible: this.state.visible,
      hostMode: this.state.hostMode,
      hostConnected: this.floatingHostEl?.isConnected,
      parentClass: this.boundElement?.parentElement?.className,
    });
  }

  private scheduleAutoResume() {
    if (this.autoResumeTimer != null) return;
    // 导航期间主线程繁忙，让出一帧再 play()，避免与 Chromium 的暂停决定撞车。
    this.autoResumeTimer = window.setTimeout(() => {
      this.autoResumeTimer = null;
      const el = this.boundElement;
      if (!el || el.ended || !el.paused) return;
      dbg('auto-resume.try', { ct: el.currentTime, connected: el.isConnected });
      void el.play().catch((err) => {
        dbg('auto-resume.rejected', { err: String(err) });
      });
    }, 80);
  }

  private clearAutoResumeTimer() {
    if (this.autoResumeTimer != null) {
      window.clearTimeout(this.autoResumeTimer);
      this.autoResumeTimer = null;
    }
  }

  private moveElementToFloatingHost() {
    const key = this.state.key;
    const host = this.floatingHostEl;
    if (!key || !host) return;
    const el = getGlobalVideoElement(key);
    dbg('moveElementToFloatingHost.before', {
      key,
      pausedBefore: el.paused,
      ctBefore: el.currentTime,
      connectedBefore: el.isConnected,
      hostConnected: host.isConnected,
      sameParent: el.parentElement === host,
      currentParentClass: el.parentElement?.className,
    });
    if (el.parentElement !== host) {
      host.appendChild(el);
    }
    dbg('moveElementToFloatingHost.after', {
      pausedAfter: el.paused,
      ctAfter: el.currentTime,
      connectedAfter: el.isConnected,
      newParentClass: el.parentElement?.className,
    });
  }

  private attachVideoListeners(key: string) {
    const nextEl = getGlobalVideoElement(key);
    if (this.boundElement === nextEl) return;
    this.detachVideoListeners();
    this.boundElement = nextEl;
    nextEl.addEventListener('play', this.onPlay);
    nextEl.addEventListener('pause', this.onPause);
    nextEl.addEventListener('timeupdate', this.onTimeUpdate);
    nextEl.addEventListener('loadedmetadata', this.onLoadedMetadata);
    nextEl.addEventListener('suspend', this.onSuspend);
    nextEl.addEventListener('abort', this.onAbort);
    nextEl.addEventListener('emptied', this.onEmptied);
    nextEl.addEventListener('stalled', this.onStalled);
    nextEl.addEventListener('waiting', this.onWaiting);
  }

  private detachVideoListeners() {
    const el = this.boundElement;
    if (!el) return;
    el.removeEventListener('play', this.onPlay);
    el.removeEventListener('pause', this.onPause);
    el.removeEventListener('timeupdate', this.onTimeUpdate);
    el.removeEventListener('loadedmetadata', this.onLoadedMetadata);
    el.removeEventListener('suspend', this.onSuspend);
    el.removeEventListener('abort', this.onAbort);
    el.removeEventListener('emptied', this.onEmptied);
    el.removeEventListener('stalled', this.onStalled);
    el.removeEventListener('waiting', this.onWaiting);
  }

  private setState(patch: Partial<FloatingVideoState>) {
    this.state = { ...this.state, ...patch };
    this.emit();
  }

  private emit() {
    this.syncMediaRegistry();
    this.updateDocumentPipShell();
    this.listeners.forEach((listener) => listener(this.state));
  }

  // 服务层自注册：只要视频被 play 过且当前有 tab 归属，就在 MediaHub 出现；dismiss 时取消注册。
  // 不依赖 React 组件生命周期，避免"切走资料库后视频消失/被卸载"。
  private syncMediaRegistry() {
    const { key, tabId, libraryId, fileName, thumbnailUrl, isPlaying, currentTime, duration } = this.state;
    if (!key || !tabId || !this.hasStarted) {
      if (this.registration) {
        this.registration.unregister();
        this.registration = null;
        this.registeredTabId = null;
      }
      return;
    }
    if (this.registration && this.registeredTabId !== tabId) {
      this.registration.unregister();
      this.registration = null;
      this.registeredTabId = null;
    }
    const title = fileName || '视频';
    const ct = Number.isFinite(currentTime) && currentTime >= 0 ? Math.floor(currentTime) : 0;
    const dur = Number.isFinite(duration) && duration > 0 ? Math.floor(duration) : undefined;
    if (!this.registration) {
      this.registration = mediaRegistry.register({
        entryId: VIDEO_REGISTRY_ENTRY_ID,
        kind: 'video',
        tabId,
        libraryId,
        title,
        isPlaying,
        currentTime: ct,
        duration: dur,
        thumbnailUrl,
        play: () => this.play(),
        pause: () => this.pause(),
        seek: (time: number) => this.seek(time),
        dismiss: () => this.dismiss(),
      });
      this.registeredTabId = tabId;
      return;
    }
    this.registration.update({
      title,
      isPlaying,
      currentTime: ct,
      duration: dur,
      thumbnailUrl,
      libraryId,
    });
  }
}

function closePipWindow(pipWindow: Window) {
  try {
    if (!pipWindow.closed) pipWindow.close();
  } catch (error) {
    dbg('document-pip.close stale window failed', { error: String(error) });
  }
}

export const floatingVideoService = new FloatingVideoService();
