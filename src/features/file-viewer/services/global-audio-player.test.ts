import { afterEach, describe, expect, it, vi } from 'vitest';

class SharedPendingPlayAudio {
  currentTime = 0;
  duration = 120;
  ended = false;
  muted = false;
  paused = true;
  preload = '';
  src = '';
  volume = 0.7;
  pauseCalls = 0;

  private pendingPlay: Promise<void> | null = null;
  private resolvePendingPlay: (() => void) | null = null;

  addEventListener() {}

  load() {}

  pause() {
    this.pauseCalls += 1;
    this.paused = true;
  }

  play(): Promise<void> {
    if (!this.pendingPlay) {
      this.pendingPlay = new Promise((resolve) => {
        this.resolvePendingPlay = resolve;
      });
    }
    return this.pendingPlay;
  }

  removeAttribute(name: string) {
    if (name === 'src') this.src = '';
  }

  resolvePlay() {
    this.paused = false;
    this.resolvePendingPlay?.();
  }
}

describe('GlobalAudioPlayer playback attempts', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('does not let an older same-source play completion pause the newer attempt', async () => {
    vi.stubGlobal('Audio', SharedPendingPlayAudio);
    const { GlobalAudioPlayer } = await import('./global-audio-player');
    const audio = new SharedPendingPlayAudio();
    const player = new GlobalAudioPlayer(audio as unknown as HTMLAudioElement);

    player.ensureSource('https://example.test/audio.mp3');
    const firstPlay = player.play();
    const secondPlay = player.play();

    audio.resolvePlay();

    await expect(firstPlay).resolves.toBe(false);
    await expect(secondPlay).resolves.toBe(true);
    expect(audio.pauseCalls).toBe(0);
    expect(player.getState().isPlaying).toBe(true);
  });
});
