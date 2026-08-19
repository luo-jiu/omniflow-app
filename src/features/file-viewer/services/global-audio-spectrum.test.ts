import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type EventListener = () => void;

class FakeMediaStream {
  private audioTracks: MediaStreamTrack[] = [];
  private listeners = new Set<EventListener>();

  constructor(hasAudioTrack = false) {
    if (hasAudioTrack) {
      this.audioTracks.push({} as MediaStreamTrack);
    }
  }

  addEventListener(type: string, listener: EventListener) {
    if (type === 'addtrack') this.listeners.add(listener);
  }

  removeEventListener(type: string, listener: EventListener) {
    if (type === 'addtrack') this.listeners.delete(listener);
  }

  getAudioTracks() {
    return this.audioTracks;
  }

  addAudioTrack() {
    this.audioTracks.push({} as MediaStreamTrack);
    this.listeners.forEach(listener => listener());
  }
}

class SpectrumAudio {
  currentTime = 0;
  duration = 120;
  ended = false;
  muted = false;
  paused = true;
  preload = '';
  src = '';
  volume = 0.7;
  private listeners = new Map<string, Set<EventListener>>();
  private streamIndex = 0;

  constructor(private readonly streams: FakeMediaStream[]) {}

  addEventListener(type: string, listener: EventListener) {
    const listeners = this.listeners.get(type) ?? new Set<EventListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  captureStream() {
    const stream = this.streams[Math.min(this.streamIndex, this.streams.length - 1)];
    this.streamIndex += 1;
    return stream as unknown as MediaStream;
  }

  load() {}

  pause() {
    this.paused = true;
  }

  async play() {
    this.paused = false;
    this.dispatch('play');
  }

  removeAttribute(name: string) {
    if (name === 'src') this.src = '';
  }

  private dispatch(type: string) {
    this.listeners.get(type)?.forEach(listener => listener());
  }
}

class DefaultSpectrumAudio extends SpectrumAudio {
  constructor() {
    super([new FakeMediaStream()]);
  }
}

class FakeAnalyserNode {
  frequencyBinCount = 16;
  fftSize = 0;
  smoothingTimeConstant = 0;
  disconnect = vi.fn();

  getByteFrequencyData(target: Uint8Array) {
    target.fill(128);
  }
}

class FakeMediaStreamAudioSourceNode {
  connect = vi.fn();
  disconnect = vi.fn();
}

const audioContexts: FakeAudioContext[] = [];

class FakeAudioContext {
  readonly analyser = new FakeAnalyserNode();
  readonly source = new FakeMediaStreamAudioSourceNode();
  readonly sampleRate = 48_000;
  readonly state = 'running';
  close = vi.fn(async () => undefined);
  resume = vi.fn(async () => undefined);

  constructor() {
    audioContexts.push(this);
  }

  createAnalyser() {
    return this.analyser;
  }

  createMediaStreamSource() {
    return this.source;
  }
}

describe('GlobalAudioPlayer spectrum analysis', () => {
  beforeEach(() => {
    audioContexts.length = 0;
    vi.useFakeTimers();
    vi.stubGlobal('Audio', DefaultSpectrumAudio);
    vi.stubGlobal('AudioContext', FakeAudioContext);
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('waits for a delayed decoded audio track before exposing FFT levels', async () => {
    const stream = new FakeMediaStream();
    const audio = new SpectrumAudio([stream]);
    const { GlobalAudioPlayer } = await import('./global-audio-player');
    const player = new GlobalAudioPlayer(audio as unknown as HTMLAudioElement);
    const levels = new Float32Array(8);

    player.ensureSource('https://storage.test/song.m4a');
    await player.play();

    expect(player.readSpectrumLevels(levels)).toBe(false);
    stream.addAudioTrack();
    await Promise.resolve();

    expect(player.readSpectrumLevels(levels)).toBe(true);
    expect(Math.max(...levels)).toBeGreaterThan(0);
    player.clear();
  });

  it('rebuilds the captured stream graph when playback changes source', async () => {
    const firstStream = new FakeMediaStream(true);
    const secondStream = new FakeMediaStream(true);
    const audio = new SpectrumAudio([firstStream, secondStream]);
    const { GlobalAudioPlayer } = await import('./global-audio-player');
    const player = new GlobalAudioPlayer(audio as unknown as HTMLAudioElement);

    player.ensureSource('https://storage.test/first.mp3');
    await player.play();
    await Promise.resolve();
    expect(audioContexts).toHaveLength(1);

    player.ensureSource('https://storage.test/second.flac');
    expect(audioContexts[0].source.disconnect).toHaveBeenCalledOnce();
    expect(audioContexts[0].close).toHaveBeenCalledOnce();

    await player.play();
    await Promise.resolve();
    expect(audioContexts).toHaveLength(2);
    player.clear();
  });

  it('keeps the existing analysis graph when the same source only updates metadata', async () => {
    const stream = new FakeMediaStream(true);
    const audio = new SpectrumAudio([stream]);
    const { GlobalAudioPlayer } = await import('./global-audio-player');
    const player = new GlobalAudioPlayer(audio as unknown as HTMLAudioElement);

    player.ensureSource('https://storage.test/song.ogg', 'Original title');
    await player.play();
    await Promise.resolve();
    expect(audioContexts).toHaveLength(1);

    player.ensureSource('https://storage.test/song.ogg', 'Updated title');
    await player.play();
    await Promise.resolve();
    expect(audioContexts).toHaveLength(1);
    expect(audioContexts[0].source.disconnect).not.toHaveBeenCalled();
    player.clear();
  });
});
