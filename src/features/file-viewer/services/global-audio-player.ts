import { mediaRegistry } from '@/contexts/media-registry.singleton';
import { type MediaRegistryRegistration } from '@/contexts/media-registry.context';

export interface GlobalAudioPlayerState {
  src: string | null;
  trackName: string | null;
  ownerType: 'default' | 'asmr';
  ownerKey: string | null;
  tabId: string | null;
  libraryId: number | null;
  thumbnailUrl: string | null;
  hasStarted: boolean;
  isPlaying: boolean;
  endedSerial: number;
  currentTime: number;
  duration: number;
  volume: number;
  isMuted: boolean;
}

type StateListener = (state: GlobalAudioPlayerState) => void;

const MEDIA_SESSION_POSITION_SYNC_MIN_DELTA_SECONDS = 1;

// 单例 entryId：同一时刻最多一条 audio 记录在 MediaHub 中。详见 docs/media-hub-contract.md。
const AUDIO_REGISTRY_ENTRY_ID = 'audio:active';

class GlobalAudioPlayer {
  private readonly audio: HTMLAudioElement;
  private listeners = new Set<StateListener>();
  private sourceUrl: string | null = null;
  private trackName: string | null = null;
  private ownerType: 'default' | 'asmr' = 'default';
  private ownerKey: string | null = null;
  private tabId: string | null = null;
  private libraryId: number | null = null;
  private thumbnailUrl: string | null = null;
  private hasStarted = false;
  private endedSerial = 0;
  private lastMediaSessionPositionSignature = '';
  private registration: MediaRegistryRegistration | null = null;
  private registeredTabId: string | null = null;

  constructor() {
    this.audio = new Audio();
    this.audio.preload = 'metadata';
    this.audio.volume = 0.7;

    const emit = () => this.emitState();
    this.audio.addEventListener('loadedmetadata', emit);
    this.audio.addEventListener('timeupdate', emit);
    this.audio.addEventListener('play', emit);
    this.audio.addEventListener('pause', emit);
    this.audio.addEventListener('ended', () => {
      this.endedSerial += 1;
      emit();
    });
    this.audio.addEventListener('volumechange', emit);

    this.setupMediaSession();
  }

  subscribe(listener: StateListener) {
    this.listeners.add(listener);
    listener(this.getState());
    return () => {
      this.listeners.delete(listener);
    };
  }

  ensureSource(
    url: string,
    trackName?: string | null,
    options?: {
      ownerType?: 'default' | 'asmr';
      ownerKey?: string | null;
      tabId?: string | null;
      libraryId?: number | null;
      thumbnailUrl?: string | null;
    },
  ) {
    const nextOwnerType = options?.ownerType ?? 'default';
    const nextOwnerKey = options?.ownerKey ?? null;
    const nextTabId = options?.tabId ?? null;
    const nextLibraryId = options?.libraryId ?? null;
    const nextThumbnailUrl = options?.thumbnailUrl ?? null;
    if (this.sourceUrl === url) {
      if (
        trackName !== undefined && trackName !== this.trackName
        || nextOwnerType !== this.ownerType
        || nextOwnerKey !== this.ownerKey
        || nextTabId !== this.tabId
        || nextLibraryId !== this.libraryId
        || nextThumbnailUrl !== this.thumbnailUrl
      ) {
        if (trackName !== undefined) {
          this.trackName = trackName;
        }
        this.ownerType = nextOwnerType;
        this.ownerKey = nextOwnerKey;
        this.tabId = nextTabId;
        this.libraryId = nextLibraryId;
        this.thumbnailUrl = nextThumbnailUrl;
        this.lastMediaSessionPositionSignature = '';
        this.syncMediaSessionMetadata();
        this.emitState();
      }
      return;
    }
    this.sourceUrl = url;
    this.trackName = trackName ?? null;
    this.ownerType = nextOwnerType;
    this.ownerKey = nextOwnerKey;
    this.tabId = nextTabId;
    this.libraryId = nextLibraryId;
    this.thumbnailUrl = nextThumbnailUrl;
    this.hasStarted = false;
    this.endedSerial = 0;
    this.lastMediaSessionPositionSignature = '';
    this.audio.src = url;
    this.audio.load();
    this.syncMediaSessionMetadata();
    this.emitState();
  }

  // 关闭某个 tab 时由 FileViewerContext 调用：若当前播放归属于该 tab，整体释放。
  releaseForTab(tabId: string) {
    if (this.tabId !== tabId) return;
    this.clear();
  }

  releaseForLibrary(libraryId: number) {
    if (this.libraryId !== libraryId) return;
    this.clear();
  }

  async play() {
    await this.audio.play();
    this.hasStarted = true;
    this.emitState();
  }

  pause() {
    this.audio.pause();
    this.emitState();
  }

  async togglePlay() {
    if (this.audio.paused) {
      await this.play();
    } else {
      this.pause();
    }
  }

  seekTo(nextTime: number) {
    if (!Number.isFinite(nextTime)) return;
    this.audio.currentTime = Math.max(0, nextTime);
    this.emitState();
  }

  setVolume(volume: number) {
    const next = Math.max(0, Math.min(1, volume));
    this.audio.volume = next;
    if (next > 0 && this.audio.muted) {
      this.audio.muted = false;
    }
    this.emitState();
  }

  setMuted(muted: boolean) {
    this.audio.muted = muted;
    this.emitState();
  }

  clear() {
    this.pause();
    this.audio.currentTime = 0;
    this.audio.removeAttribute('src');
    this.audio.load();
    this.sourceUrl = null;
    this.trackName = null;
    this.ownerType = 'default';
    this.ownerKey = null;
    this.tabId = null;
    this.libraryId = null;
    this.thumbnailUrl = null;
    this.hasStarted = false;
    this.clearMediaSession();
    this.emitState();
  }

  getState(): GlobalAudioPlayerState {
    return {
      src: this.sourceUrl,
      trackName: this.trackName,
      ownerType: this.ownerType,
      ownerKey: this.ownerKey,
      tabId: this.tabId,
      libraryId: this.libraryId,
      thumbnailUrl: this.thumbnailUrl,
      hasStarted: this.hasStarted,
      isPlaying: !this.audio.paused,
      endedSerial: this.endedSerial,
      currentTime: Number.isFinite(this.audio.currentTime) ? this.audio.currentTime : 0,
      duration: Number.isFinite(this.audio.duration) ? this.audio.duration : 0,
      volume: this.audio.volume,
      isMuted: this.audio.muted,
    };
  }

  private emitState() {
    const snapshot = this.getState();
    this.syncMediaSessionPlaybackState(snapshot);
    this.syncMediaSessionPositionState(snapshot);
    this.syncMediaRegistry(snapshot);
    this.listeners.forEach(listener => listener(snapshot));
  }

  // 服务层自注册：必须 src + tabId + 已 play 过（hasStarted）才进 MediaHub；clear() 时取消注册。
  // hasStarted 守门保持和旧 useRegisterMediaEntry({ enabled: hasStartedPlaying }) 一致，并和 video 服务对齐。
  // 不依赖 React 组件生命周期，避免"关闭归档 tag 后音频仍播但 hub 消失"的旧 bug。
  private syncMediaRegistry(snapshot: GlobalAudioPlayerState) {
    if (!snapshot.src || !snapshot.tabId || !snapshot.hasStarted) {
      if (this.registration) {
        this.registration.unregister();
        this.registration = null;
        this.registeredTabId = null;
      }
      return;
    }
    // tabId 切换（换源 / 换库）时必须重建注册：MediaRegistry update 不接受 tabId 变更。
    if (this.registration && this.registeredTabId !== snapshot.tabId) {
      this.registration.unregister();
      this.registration = null;
      this.registeredTabId = null;
    }
    const title = snapshot.trackName ?? '音频';
    const currentTime = Number.isFinite(snapshot.currentTime) && snapshot.currentTime >= 0
      ? Math.floor(snapshot.currentTime)
      : 0;
    const duration = Number.isFinite(snapshot.duration) && snapshot.duration > 0
      ? Math.floor(snapshot.duration)
      : undefined;
    const thumbnailUrl = snapshot.thumbnailUrl ?? undefined;
    if (!this.registration) {
      this.registration = mediaRegistry.register({
        entryId: AUDIO_REGISTRY_ENTRY_ID,
        kind: 'audio',
        tabId: snapshot.tabId,
        libraryId: snapshot.libraryId,
        title,
        isPlaying: snapshot.isPlaying,
        currentTime,
        duration,
        thumbnailUrl,
        play: () => { void this.play().catch(() => {}); },
        pause: () => this.pause(),
        seek: (time: number) => this.seekTo(time),
        dismiss: () => this.clear(),
      });
      this.registeredTabId = snapshot.tabId;
      return;
    }
    this.registration.update({
      title,
      isPlaying: snapshot.isPlaying,
      currentTime,
      duration,
      thumbnailUrl,
      libraryId: snapshot.libraryId,
    });
  }

  private get mediaSession() {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) {
      return null;
    }
    return navigator.mediaSession;
  }

  private setupMediaSession() {
    const mediaSession = this.mediaSession;
    if (!mediaSession) return;

    try {
      mediaSession.setActionHandler('play', () => {
        void this.play().catch(() => {});
      });
      mediaSession.setActionHandler('pause', () => {
        this.pause();
      });
      mediaSession.setActionHandler('seekbackward', (details) => {
        const offset = details.seekOffset ?? 10;
        this.seekTo((this.audio.currentTime || 0) - offset);
      });
      mediaSession.setActionHandler('seekforward', (details) => {
        const offset = details.seekOffset ?? 10;
        this.seekTo((this.audio.currentTime || 0) + offset);
      });
      mediaSession.setActionHandler('seekto', (details) => {
        if (details.seekTime === undefined) return;
        this.seekTo(details.seekTime);
      });
    } catch {
      // MediaSession support varies by runtime; playback itself should keep working.
    }
  }

  private syncMediaSessionMetadata() {
    const mediaSession = this.mediaSession;
    if (!mediaSession || typeof MediaMetadata === 'undefined') return;
    if (!this.sourceUrl) {
      mediaSession.metadata = null;
      return;
    }

    mediaSession.metadata = new MediaMetadata({
      title: this.trackName || '音频',
      artist: this.ownerType === 'asmr' ? 'ASMR' : 'OmniFlow',
      album: 'OmniFlow',
    });
  }

  private syncMediaSessionPlaybackState(snapshot: GlobalAudioPlayerState) {
    const mediaSession = this.mediaSession;
    if (!mediaSession) return;
    if (!snapshot.src || !snapshot.hasStarted) {
      mediaSession.playbackState = 'none';
      return;
    }
    mediaSession.playbackState = snapshot.isPlaying ? 'playing' : 'paused';
  }

  private syncMediaSessionPositionState(snapshot: GlobalAudioPlayerState) {
    const mediaSession = this.mediaSession;
    if (
      !mediaSession
      || typeof mediaSession.setPositionState !== 'function'
      || !snapshot.src
      || !snapshot.hasStarted
      || snapshot.duration <= 0
      || snapshot.currentTime < 0
    ) {
      return;
    }

    const normalizedPosition = Math.min(Math.max(snapshot.currentTime, 0), snapshot.duration);
    const roundedPosition = Math.floor(normalizedPosition / MEDIA_SESSION_POSITION_SYNC_MIN_DELTA_SECONDS)
      * MEDIA_SESSION_POSITION_SYNC_MIN_DELTA_SECONDS;
    const signature = [
      roundedPosition.toFixed(0),
      snapshot.duration.toFixed(0),
      snapshot.isPlaying ? 'playing' : 'paused',
    ].join('|');
    if (signature === this.lastMediaSessionPositionSignature) return;
    this.lastMediaSessionPositionSignature = signature;

    try {
      mediaSession.setPositionState({
        duration: snapshot.duration,
        playbackRate: 1,
        position: normalizedPosition,
      });
    } catch {
      // Invalid metadata must not break the in-app audio player.
    }
  }

  private clearMediaSession() {
    const mediaSession = this.mediaSession;
    if (!mediaSession) return;
    mediaSession.metadata = null;
    mediaSession.playbackState = 'none';
    this.lastMediaSessionPositionSignature = '';

    if (typeof mediaSession.setPositionState === 'function') {
      try {
        mediaSession.setPositionState();
      } catch {
        // Some runtimes reject clearing position state; metadata/playbackState are enough.
      }
    }
  }
}

export const globalAudioPlayer = new GlobalAudioPlayer();
