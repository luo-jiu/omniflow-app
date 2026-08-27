import { describe, expect, it, vi } from 'vitest';

import {
  buildAgentExtractAudioArgs,
  extractAgentMediaAudio,
} from './agent-media-audio-extractor';

const OWNER = {
  executionId: 'execution-1',
  ownerScope: {
    accountScope: 'user:7',
    backendScope: 'https://api.example.test/v1',
  },
  ownerWebContentsId: 77,
  runId: 'run-1',
  sessionId: 'session-1',
};

function input() {
  return {
    ...OWNER,
    fileName: 'movie.mp4',
    mimeType: 'video/mp4',
    outputFileName: 'movie-audio.m4a',
    outputFormat: 'm4a' as const,
    sourceUrl: 'https://storage.example/signed?secret=value',
  };
}

describe('Agent media audio extractor', () => {
  it('builds fixed ffmpeg arguments without invoking a shell', () => {
    const args = buildAgentExtractAudioArgs({
      outputFormat: 'mp3',
      outputPath: '/tmp/output.mp3',
      sourceUrl: 'http://127.0.0.1:3210/source-token',
    });

    expect(args).toEqual(expect.arrayContaining([
      '-nostdin',
      '-map',
      '0:a:0',
      '-vn',
      '-stats_period',
      '5',
      '-c:a',
      'libmp3lame',
      '-progress',
      'pipe:1',
    ]));
    expect(args.at(-1)).toBe('/tmp/output.mp3');
  });

  it('uses a loopback source, finalizes the artifact and reports bounded progress', async () => {
    const releaseProxy = vi.fn();
    const releaseArtifact = vi.fn(async () => true);
    const onProgress = vi.fn();
    const runProcess = vi.fn(async (request: {
      args: string[];
      onOutput: (output: { stream: 'stderr' | 'stdout'; text: string }) => void;
    }) => {
      request.onOutput({ stream: 'stdout', text: 'out_time_us=2000000\nprogress=continue\n' });
      return {
        durationMs: 10,
        exitCode: 0,
        stderr: '',
        stdout: '',
        terminationSignal: null,
      };
    });
    const result = await extractAgentMediaAudio(
      input(),
      new AbortController().signal,
      onProgress,
      {
        artifactStore: {
          create: vi.fn(async () => ({
            artifactId: 'artifact-1',
            directoryPath: '/tmp/agent-media-test',
            fileName: 'movie-audio.m4a',
            filePath: '/tmp/agent-media-test/movie-audio.m4a',
            sizeBytes: 0,
          })),
          finalize: vi.fn(async () => ({
            artifactId: 'artifact-1',
            directoryPath: '/tmp/agent-media-test',
            fileName: 'movie-audio.m4a',
            filePath: '/tmp/agent-media-test/movie-audio.m4a',
            sizeBytes: 512,
          })),
          release: releaseArtifact,
        },
        createProxySource: vi.fn(() => ({
          release: releaseProxy,
          url: 'http://127.0.0.1:3210/source-token',
        })),
        resolveFfmpegPath: async () => '/usr/local/bin/ffmpeg',
        runProcess,
      },
    );

    expect(runProcess).toHaveBeenCalledWith(expect.objectContaining({
      args: expect.arrayContaining(['http://127.0.0.1:3210/source-token']),
      executablePath: '/usr/local/bin/ffmpeg',
      signal: expect.any(AbortSignal),
    }));
    expect(JSON.stringify(runProcess.mock.calls[0]?.[0].args)).not.toContain('secret=value');
    expect(onProgress).toHaveBeenCalledWith({ message: '正在提取音频（已处理 2 秒）' });
    expect(releaseProxy).toHaveBeenCalledOnce();
    expect(releaseArtifact).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      artifactId: 'artifact-1',
      mimeType: 'audio/mp4',
      sizeBytes: 512,
    });
  });

  it('releases the proxy and artifact on process failure without exposing stderr', async () => {
    const releaseProxy = vi.fn();
    const releaseArtifact = vi.fn(async () => true);
    const running = extractAgentMediaAudio(
      input(),
      new AbortController().signal,
      vi.fn(),
      {
        artifactStore: {
          create: vi.fn(async () => ({
            artifactId: 'artifact-failed',
            directoryPath: '/tmp/agent-media-test',
            fileName: 'movie-audio.m4a',
            filePath: '/tmp/agent-media-test/movie-audio.m4a',
            sizeBytes: 0,
          })),
          finalize: vi.fn(),
          release: releaseArtifact,
        },
        createProxySource: () => ({ release: releaseProxy, url: 'http://127.0.0.1/source' }),
        resolveFfmpegPath: async () => '/usr/bin/ffmpeg',
        runProcess: async () => ({
          durationMs: 1,
          exitCode: 1,
          stderr: 'https://storage.example/signed?secret=value failed',
          stdout: '',
          terminationSignal: null,
        }),
      },
    );

    await expect(running).rejects.not.toThrow('secret=value');
    expect(releaseProxy).toHaveBeenCalledOnce();
    expect(releaseArtifact).toHaveBeenCalledWith('artifact-failed');
  });
});
