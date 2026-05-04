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

class GlobalAudioPlayer {
  private readonly audio: HTMLAudioElement;
  private listeners = new Set<StateListener>();
  private sourceUrl: string | null = null;
  private trackName: string | null = null;
  private ownerType: 'default' | 'asmr' = 'default';
  private ownerKey: string | null = null;
  private hasStarted = false;

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
        this.emitState();
      }
      return;
    }
    this.sourceUrl = url;
    this.trackName = trackName ?? null;
    this.ownerType = nextOwnerType;
    this.ownerKey = nextOwnerKey;
    this.hasStarted = false;
    this.audio.src = url;
    this.audio.load();
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
    this.listeners.forEach(listener => listener(snapshot));
  }
}

export const globalAudioPlayer = new GlobalAudioPlayer();
