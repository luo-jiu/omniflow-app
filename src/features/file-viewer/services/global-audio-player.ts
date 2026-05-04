export interface GlobalAudioPlayerState {
  src: string | null;
  trackName: string | null;
  ownerType: 'default' | 'asmr';
  ownerKey: string | null;
  hasStarted: boolean;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  isMuted: boolean;
}

type StateListener = (state: GlobalAudioPlayerState) => void;

const MEDIA_SESSION_POSITION_SYNC_MIN_DELTA_SECONDS = 1;

class GlobalAudioPlayer {
  private readonly audio: HTMLAudioElement;
  private listeners = new Set<StateListener>();
  private sourceUrl: string | null = null;
  private trackName: string | null = null;
  private ownerType: 'default' | 'asmr' = 'default';
  private ownerKey: string | null = null;
  private hasStarted = false;
  private lastMediaSessionPositionSignature = '';

  constructor() {
    this.audio = new Audio();
    this.audio.preload = 'metadata';
    this.audio.volume = 0.7;

    const emit = () => this.emitState();
    this.audio.addEventListener('loadedmetadata', emit);
    this.audio.addEventListener('timeupdate', emit);
    this.audio.addEventListener('play', emit);
    this.audio.addEventListener('pause', emit);
    this.audio.addEventListener('ended', emit);
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
    },
  ) {
    const nextOwnerType = options?.ownerType ?? 'default';
    const nextOwnerKey = options?.ownerKey ?? null;
    if (this.sourceUrl === url) {
      if (
        trackName !== undefined && trackName !== this.trackName
        || nextOwnerType !== this.ownerType
        || nextOwnerKey !== this.ownerKey
      ) {
        if (trackName !== undefined) {
          this.trackName = trackName;
        }
        this.ownerType = nextOwnerType;
        this.ownerKey = nextOwnerKey;
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
    this.hasStarted = false;
    this.lastMediaSessionPositionSignature = '';
    this.audio.src = url;
    this.audio.load();
    this.syncMediaSessionMetadata();
    this.emitState();
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
      hasStarted: this.hasStarted,
      isPlaying: !this.audio.paused,
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
    this.listeners.forEach(listener => listener(snapshot));
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
