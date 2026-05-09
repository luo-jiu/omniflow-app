import { mediaRegistry } from '@/contexts/media-registry.singleton';
import { type MediaRegistryRegistration } from '@/contexts/media-registry.context';
import {
  getGlobalVideoElement,
  releaseGlobalVideoElement,
} from './global-video-elements';

// 单例 entryId：同一时刻最多一条 video 记录在 MediaHub 中。详见 docs/media-hub-contract.md。
const VIDEO_REGISTRY_ENTRY_ID = 'video:active';

const DEBUG_TAG = '[floating-video]';
function dbg(...args: unknown[]) {
  // 临时定位用：浮窗保活异常时的事件追踪。稳定后移除。
  console.log(DEBUG_TAG, ...args);
}

export interface FloatingVideoState {
  visible: boolean;
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
}

type StateListener = (state: FloatingVideoState) => void;

const INITIAL_STATE: FloatingVideoState = {
  visible: false,
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

  private onPlay = () => {
    dbg('video.event play', { key: this.state.key, paused: this.boundElement?.paused, ct: this.boundElement?.currentTime });
    this.hasStarted = true;
    this.setState({ isPlaying: true });
  };
  private onPause = () => {
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
    const el = this.boundElement;
    if (!el) return;
    this.setState({
      currentTime: Number.isFinite(el.currentTime) ? el.currentTime : 0,
    });
  };
  private onLoadedMetadata = () => {
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
    // 切到新视频时，若浮窗里还有旧视频，释放旧元素，避免双实例。
    if (this.state.key && isNewKey && this.state.visible) {
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
    this.setState({
      visible: false,
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
    // 仅当离开 inline 时元素是播放中，才上膛一次自动续播 —— 用户原本暂停的视频不会被强行播放。
    const wasPlaying = !!(el && !el.paused && !el.ended) || this.state.isPlaying;
    this.autoResumeArmed = wasPlaying;
    this.setState({ visible: true });

    if (this.floatingHostEl) {
      this.moveElementToFloatingHost();
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
      this.moveElementToFloatingHost();
    }
  };

  play = () => {
    this.autoResumeArmed = false;
    this.clearAutoResumeTimer();
    const el = this.boundElement;
    if (!el) return;
    void el.play().catch(() => {
      /* swallow autoplay rejection */
    });
  };

  pause = () => {
    this.autoResumeArmed = false;
    this.clearAutoResumeTimer();
    const el = this.boundElement;
    if (!el) return;
    if (!el.paused) el.pause();
  };

  seek = (time: number) => {
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
    this.setState({ visible: false });
  };

  // 收起：仅收起浮窗 UI，不暂停。tab/元素/hub entry 全保留。
  hide = () => {
    this.autoResumeArmed = false;
    this.clearAutoResumeTimer();
    this.setState({ visible: false });
  };

  dismiss = () => {
    const key = this.state.key;
    this.autoResumeArmed = false;
    this.clearAutoResumeTimer();
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

export const floatingVideoService = new FloatingVideoService();
