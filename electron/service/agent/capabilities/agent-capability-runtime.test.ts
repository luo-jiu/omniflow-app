import { describe, expect, it, vi } from 'vitest';

import { createBuiltInAgentCapabilityRegistry } from './agent-capability-runtime';

const REQUEST = {
  capabilityIds: ['media.ffmpeg', 'media.ffprobe'],
  libraryId: 3,
  ownerScope: {
    accountScope: 'user:1',
    backendScope: 'https://example.com/api',
  },
  signal: new AbortController().signal,
};

describe('built-in Agent Capability runtime', () => {
  it('reports media executables without exposing their absolute paths', async () => {
    const registry = createBuiltInAgentCapabilityRegistry({
      resolveFfmpegPath: vi.fn(async () => '/private/tools/ffmpeg'),
      resolveFfprobePath: vi.fn(async () => '/private/tools/ffprobe'),
    });
    const snapshot = await registry.createSnapshot(REQUEST);

    expect(snapshot.list().map(entry => [entry.id, entry.state])).toEqual([
      ['media.ffmpeg', 'available'],
      ['media.ffprobe', 'available'],
    ]);
    expect(JSON.stringify(snapshot)).not.toContain('/private/tools');
  });

  it('returns stable safe reason codes when executables are missing', async () => {
    const registry = createBuiltInAgentCapabilityRegistry({
      resolveFfmpegPath: vi.fn(async () => null),
      resolveFfprobePath: vi.fn(async () => null),
    });
    const snapshot = await registry.createSnapshot(REQUEST);

    expect(snapshot.get('media.ffmpeg')).toMatchObject({
      reasonCode: 'media.ffmpeg_not_found',
      state: 'unavailable',
    });
    expect(snapshot.get('media.ffprobe')).toMatchObject({
      reasonCode: 'media.ffprobe_not_found',
      state: 'unavailable',
    });
  });
});
