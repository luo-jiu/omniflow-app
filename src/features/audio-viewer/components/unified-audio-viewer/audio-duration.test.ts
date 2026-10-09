import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadAudioMetadataDuration, normalizeAudioDuration } from './audio-duration';

describe('normalizeAudioDuration', () => {
  it('accepts finite positive durations', () => {
    expect(normalizeAudioDuration(95.25)).toBe(95.25);
    expect(normalizeAudioDuration('12')).toBe(12);
  });

  it('rejects missing, zero, negative, and non-finite durations', () => {
    expect(normalizeAudioDuration(null)).toBeNull();
    expect(normalizeAudioDuration(0)).toBeNull();
    expect(normalizeAudioDuration(-1)).toBeNull();
    expect(normalizeAudioDuration(Infinity)).toBeNull();
    expect(normalizeAudioDuration('unknown')).toBeNull();
  });
});

function makeAudio() {
  const events = new EventTarget();
  const audio = {
    duration: 95.25,
    preload: '',
    src: '',
    addEventListener: vi.fn(events.addEventListener.bind(events)),
    removeEventListener: vi.fn(events.removeEventListener.bind(events)),
    removeAttribute: vi.fn((name: string) => { if (name === 'src') audio.src = ''; }),
    load: vi.fn(),
  };
  return {
    audio,
    createAudio: vi.fn(() => audio as unknown as HTMLAudioElement),
    emit: (name: string) => events.dispatchEvent(new Event(name)),
  };
}

afterEach(() => vi.useRealTimers());

describe('loadAudioMetadataDuration', () => {
  it('returns metadata and releases the source, listeners and timeout exactly once', async () => {
    vi.useFakeTimers();
    const fixture = makeAudio();
    const controller = new AbortController();
    const removeAbort = vi.spyOn(controller.signal, 'removeEventListener');
    const pending = loadAudioMetadataDuration('https://storage.test/audio', {
      createAudio: fixture.createAudio, signal: controller.signal,
    });
    expect(fixture.audio.preload).toBe('metadata');
    fixture.emit('loadedmetadata');
    await expect(pending).resolves.toBe(95.25);
    expect(fixture.audio.src).toBe('');
    expect(fixture.audio.removeAttribute).toHaveBeenCalledOnce();
    expect(fixture.audio.removeEventListener).toHaveBeenCalledTimes(2);
    expect(removeAbort).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
    controller.abort();
    fixture.emit('error');
    expect(fixture.audio.removeAttribute).toHaveBeenCalledOnce();
  });

  it.each(['error', 'abort', 'timeout'])('releases a pending metadata request on %s', async reason => {
    vi.useFakeTimers();
    const fixture = makeAudio();
    const controller = new AbortController();
    const pending = loadAudioMetadataDuration('https://storage.test/audio', {
      createAudio: fixture.createAudio, signal: controller.signal, timeoutMs: 100,
    });
    if (reason === 'error') fixture.emit('error');
    if (reason === 'abort') controller.abort();
    if (reason === 'timeout') vi.advanceTimersByTime(100);
    await expect(pending).resolves.toBeNull();
    expect(fixture.audio.src).toBe('');
    expect(fixture.audio.removeAttribute).toHaveBeenCalledWith('src');
    expect(fixture.audio.load).toHaveBeenCalledTimes(2);
    expect(fixture.audio.removeEventListener).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
    fixture.emit('loadedmetadata');
    expect(fixture.audio.removeAttribute).toHaveBeenCalledOnce();
  });

  it('does not allocate or request media when the owner already aborted', async () => {
    const fixture = makeAudio();
    const controller = new AbortController();
    controller.abort();
    await expect(loadAudioMetadataDuration('https://storage.test/audio', {
      createAudio: fixture.createAudio, signal: controller.signal,
    })).resolves.toBeNull();
    expect(fixture.createAudio).not.toHaveBeenCalled();
  });

  it('bounds a stalled request even when no timeout is supplied', async () => {
    vi.useFakeTimers();
    const fixture = makeAudio();
    const pending = loadAudioMetadataDuration('https://storage.test/audio', { createAudio: fixture.createAudio });
    vi.advanceTimersByTime(15_000);
    await expect(pending).resolves.toBeNull();
    expect(fixture.audio.src).toBe('');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('settles even when the media implementation throws while loading or cleaning up', async () => {
    vi.useFakeTimers();
    const fixture = makeAudio();
    fixture.audio.load.mockImplementation(() => { throw new Error('media unavailable'); });
    await expect(loadAudioMetadataDuration('https://storage.test/audio', {
      createAudio: fixture.createAudio,
    })).resolves.toBeNull();
    expect(fixture.audio.src).toBe('');
    expect(vi.getTimerCount()).toBe(0);
  });
});
