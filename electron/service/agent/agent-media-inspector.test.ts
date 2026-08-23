import { describe, expect, it, vi } from 'vitest';

import {
  buildAgentFfprobeArgs,
  inspectAgentMediaSource,
  parseAgentFfprobeOutput,
} from './agent-media-inspector';

const FFPROBE_OUTPUT = JSON.stringify({
  chapters: [{ id: 0 }],
  format: {
    bit_rate: '256000',
    duration: '12.3456789',
    filename: 'must-not-leak.mp4',
    format_long_name: 'QuickTime / MOV',
    format_name: 'mov,mp4,m4a',
    size: '123456',
    tags: { comment: 'private metadata' },
  },
  streams: [
    {
      avg_frame_rate: '30000/1001',
      codec_long_name: 'H.264 / AVC',
      codec_name: 'h264',
      profile: 'High',
      codec_type: 'video',
      disposition: { default: 1, forced: 0 },
      height: 1080,
      index: 0,
      tags: { title: 'private stream title' },
      width: 1920,
    },
    {
      channel_layout: 'stereo',
      channels: 2,
      codec_name: 'aac',
      codec_type: 'audio',
      index: 1,
      profile: 'LC',
      sample_rate: '48000',
    },
  ],
});

describe('Agent media inspector', () => {
  it('builds bounded ffprobe arguments around a transient local URL', () => {
    const args = buildAgentFfprobeArgs('http://127.0.0.1:1234/internal-source');
    expect(args).toContain('-show_entries');
    expect(args.at(-1)).toBe('http://127.0.0.1:1234/internal-source');
    expect(args.join(' ')).not.toContain('shell');
  });

  it('returns only whitelisted, normalized metadata fields', () => {
    const result = parseAgentFfprobeOutput(FFPROBE_OUTPUT);

    expect(result).toEqual({
      chapterCount: 1,
      format: {
        bitRate: 256000,
        durationSeconds: 12.345679,
        longName: 'QuickTime / MOV',
        name: 'mov,mp4,m4a',
        sizeBytes: 123456,
      },
      streamCount: 2,
      streams: [
        {
          codec: 'h264',
          codecDescription: 'H.264 / AVC',
          codecProfile: 'High',
          default: true,
          forced: false,
          frameRate: 29.97,
          height: 1080,
          index: 0,
          type: 'video',
          width: 1920,
        },
        {
          channelLayout: 'stereo',
          channels: 2,
          codec: 'aac',
          codecProfile: 'LC',
          index: 1,
          sampleRate: 48000,
          type: 'audio',
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain('private');
    expect(JSON.stringify(result)).not.toContain('must-not-leak');
  });

  it('runs through a loopback proxy and always releases it', async () => {
    const release = vi.fn();
    const createProxySource = vi.fn(() => ({
      release,
      url: 'http://127.0.0.1:3210/proxy-token',
    }));
    const runProcess = vi.fn(async (request: { args: string[] }) => {
      void request;
      return {
        durationMs: 5,
        exitCode: 0,
        stderr: '',
        stdout: FFPROBE_OUTPUT,
        terminationSignal: null,
      };
    });

    const result = await inspectAgentMediaSource({
      fileName: 'movie.mp4',
      mimeType: 'video/mp4',
      nodeId: 8,
      sourceUrl: 'https://storage.example/signed?secret=value',
    }, new AbortController().signal, {
      createProxySource,
      resolveFfprobePath: async () => '/usr/local/bin/ffprobe',
      runProcess,
    });

    expect(createProxySource).toHaveBeenCalledWith(expect.objectContaining({
      sourceUrl: 'https://storage.example/signed?secret=value',
    }));
    expect(runProcess).toHaveBeenCalledWith(expect.objectContaining({
      args: expect.arrayContaining(['http://127.0.0.1:3210/proxy-token']),
      executablePath: '/usr/local/bin/ffprobe',
      signal: expect.any(AbortSignal),
    }));
    expect(JSON.stringify(runProcess.mock.calls[0]?.[0].args)).not.toContain('secret=value');
    expect(release).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ ok: true, data: { file: { nodeId: 8 } } });
  });

  it('does not expose process stderr or signed URLs when probing fails', async () => {
    const release = vi.fn();
    const result = await inspectAgentMediaSource({
      fileName: 'broken.mp4',
      nodeId: 8,
      sourceUrl: 'https://storage.example/signed?secret=value',
    }, new AbortController().signal, {
      createProxySource: () => ({ release, url: 'http://127.0.0.1/proxy' }),
      resolveFfprobePath: async () => '/usr/bin/ffprobe',
      runProcess: async () => ({
        durationMs: 1,
        exitCode: 1,
        stderr: 'https://storage.example/signed?secret=value failed',
        stdout: '',
        terminationSignal: null,
      }),
    });

    expect(JSON.stringify(result)).not.toContain('secret=value');
    expect(result).toMatchObject({ ok: false });
    expect(release).toHaveBeenCalledOnce();
  });
});
