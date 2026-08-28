import type { AgentToolProgress } from '@/shared/agent/agent.types';
import { resolveDesktopFfmpegPath } from '../../platform/mediaExecutable';
import {
  AGENT_MEDIA_MAX_ARTIFACT_BYTES,
  agentMediaArtifactStore,
  type AgentMediaArtifactOwner,
  type AgentMediaArtifactStore,
} from './agent-media-artifact-store';
import {
  agentLocalProcessRunner,
  type AgentLocalProcessOutput,
  type AgentLocalProcessResult,
} from './agent-local-process-runner';
import {
  createAgentMediaSourceProxy,
  type AgentMediaSourceProxy,
} from './agent-media-source-proxy';
import type { AgentAudioOutputFormat } from './tools/media-extract-audio-tool';

const FFMPEG_TIMEOUT_MS = 6 * 60 * 60 * 1_000;
const FFMPEG_MAX_OUTPUT_BYTES = 2 * 1024 * 1024;

export interface AgentMediaAudioExtractionInput extends AgentMediaArtifactOwner {
  fileName: string;
  mimeType?: string;
  outputFileName: string;
  outputFormat: AgentAudioOutputFormat;
  sourceUrl: string;
}

export interface AgentMediaAudioExtractionResult {
  artifactId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

interface AgentMediaAudioExtractorDependencies {
  artifactStore?: Pick<AgentMediaArtifactStore, 'create' | 'finalize' | 'release'>;
  createProxySource?: (input: {
    fileName: string;
    mimeType?: string;
    sourceUrl: string;
  }) => AgentMediaSourceProxy;
  resolveFfmpegPath?: () => Promise<string | null>;
  runProcess?: (input: {
    args: string[];
    executablePath: string;
    maxOutputBytes: number;
    onOutput: (output: AgentLocalProcessOutput) => void;
    signal: AbortSignal;
    timeoutMs: number;
  }) => Promise<AgentLocalProcessResult>;
}

const OUTPUT_ARGS: Record<AgentAudioOutputFormat, string[]> = {
  m4a: ['-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart'],
  mp3: ['-c:a', 'libmp3lame', '-b:a', '192k'],
  wav: ['-c:a', 'pcm_s16le'],
};

const OUTPUT_MIME_TYPES: Record<AgentAudioOutputFormat, string> = {
  m4a: 'audio/mp4',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
};

export function buildAgentExtractAudioArgs(input: {
  outputFormat: AgentAudioOutputFormat;
  outputPath: string;
  sourceUrl: string;
}): string[] {
  return [
    '-nostdin',
    '-v',
    'error',
    '-rw_timeout',
    '15000000',
    '-stats_period',
    '5',
    '-i',
    input.sourceUrl,
    '-map',
    '0:a:0',
    '-vn',
    ...OUTPUT_ARGS[input.outputFormat],
    '-fs',
    String(AGENT_MEDIA_MAX_ARTIFACT_BYTES),
    '-progress',
    'pipe:1',
    '-nostats',
    '-y',
    input.outputPath,
  ];
}

function createProgressObserver(onProgress: (progress: AgentToolProgress) => void) {
  let buffer = '';
  let lastReportedSecond = -1;
  return (output: AgentLocalProcessOutput) => {
    if (output.stream !== 'stdout') return;
    buffer += output.text;
    const lines = buffer.split(/\r?\n/u);
    buffer = lines.pop() || '';
    lines.forEach((line) => {
      const match = /^(?:out_time_us|out_time_ms)=(\d+)$/u.exec(line.trim());
      if (!match) return;
      const seconds = Math.floor(Number(match[1]) / 1_000_000);
      if (!Number.isFinite(seconds) || seconds <= lastReportedSecond) return;
      lastReportedSecond = seconds;
      onProgress({ message: `正在提取音频（已处理 ${seconds} 秒）` });
    });
  };
}

export async function extractAgentMediaAudio(
  input: AgentMediaAudioExtractionInput,
  signal: AbortSignal,
  onProgress: (progress: AgentToolProgress) => void,
  dependencies: AgentMediaAudioExtractorDependencies = {},
): Promise<AgentMediaAudioExtractionResult> {
  const ffmpegPath = await (dependencies.resolveFfmpegPath || resolveDesktopFfmpegPath)();
  if (!ffmpegPath) {
    throw new Error('未找到可用的 ffmpeg，请安装 FFmpeg 或配置 OMNIFLOW_FFMPEG_PATH');
  }
  const artifactStore = dependencies.artifactStore || agentMediaArtifactStore;
  const artifact = await artifactStore.create(input.outputFileName, input);
  let retained = false;
  let proxy: AgentMediaSourceProxy | null = null;
  try {
    proxy = (dependencies.createProxySource || createAgentMediaSourceProxy)({
      fileName: input.fileName,
      ...(input.mimeType ? { mimeType: input.mimeType } : {}),
      sourceUrl: input.sourceUrl,
    });
    onProgress({ message: '正在通过 ffmpeg 提取音频', percent: 5 });
    const runProcess = dependencies.runProcess || (request => agentLocalProcessRunner.run(request));
    const processResult = await runProcess({
      args: buildAgentExtractAudioArgs({
        outputFormat: input.outputFormat,
        outputPath: artifact.filePath,
        sourceUrl: proxy.url,
      }),
      executablePath: ffmpegPath,
      maxOutputBytes: FFMPEG_MAX_OUTPUT_BYTES,
      onOutput: createProgressObserver(onProgress),
      signal,
      timeoutMs: FFMPEG_TIMEOUT_MS,
    });
    if (processResult.exitCode !== 0) {
      throw new Error(`无法提取音频（ffmpeg 退出码 ${processResult.exitCode ?? 'unknown'}）`);
    }
    const finalized = await artifactStore.finalize(artifact.artifactId);
    retained = true;
    onProgress({ message: '音频提取完成，准备上传', percent: 60 });
    return {
      artifactId: finalized.artifactId,
      fileName: finalized.fileName,
      mimeType: OUTPUT_MIME_TYPES[input.outputFormat],
      sizeBytes: finalized.sizeBytes,
    };
  } finally {
    proxy?.release();
    if (!retained) {
      await artifactStore.release(artifact.artifactId).catch(() => undefined);
    }
  }
}
