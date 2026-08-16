import { describe, expect, it } from 'vitest';
import { GlobalAudioPlaybackRequestGate } from './global-audio-playback-request';

describe('GlobalAudioPlaybackRequestGate', () => {
  it('only accepts the newest request across callers sharing the gate', () => {
    const gate = new GlobalAudioPlaybackRequestGate();
    const firstViewerRequest = gate.begin();
    const secondViewerRequest = gate.begin();

    expect(gate.isCurrent(firstViewerRequest)).toBe(false);
    expect(gate.isCurrent(secondViewerRequest)).toBe(true);
  });

  it('does not let an old viewer cleanup cancel a newer request', () => {
    const gate = new GlobalAudioPlaybackRequestGate();
    const oldViewerRequest = gate.begin();
    const currentViewerRequest = gate.begin();

    expect(gate.cancel(oldViewerRequest)).toBe(false);
    expect(gate.isCurrent(currentViewerRequest)).toBe(true);
    expect(gate.cancel(currentViewerRequest)).toBe(true);
    expect(gate.isCurrent(currentViewerRequest)).toBe(false);
  });
});
