import type { AgentToolResult } from '@/shared/agent/agent.types';
import { resolveDesktopFfprobePath } from '../../platform/mediaExecutable';
import {
  agentLocalProcessRunner,
  type AgentLocalProcessResult,
} from './agent-local-process-runner';
import {
  createAgentMediaSourceProxy,
  type AgentMediaSourceProxy,
} from './agent-media-source-proxy';

const MAX_STREAMS = 32;
const MAX_CHAPTERS = 10_000;
const FFPROBE_TIMEOUT_MS = 45_000;
const FFPROBE_MAX_OUTPUT_BYTES = 1024 * 1024;

interface AgentMediaInspectSource {
  fileName: string;
  mimeType?: string;
  nodeId: number;
  sourceUrl: string;
}

interface AgentMediaInspectorDependencies {
  createProxySource?: (input: {
    fileName: string;
    mimeType?: string;
    sourceUrl: string;
  }) => AgentMediaSourceProxy;
  resolveFfprobePath?: () => Promise<string | null>;
  runProcess?: (input: {
    args: string[];
    executablePath: string;
    maxOutputBytes: number;
    signal: AbortSignal;
    timeoutMs: number;
  }) => Promise<AgentLocalProcessResult>;
}

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function boundedText(value: unknown, maxLength = 160): string | undefined {
  const normalized = String(value ?? '').trim();
  return normalized ? normalized.slice(0, maxLength) : undefined;
}

function finiteNumber(value: unknown, minimum = 0): number | undefined {
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum) return undefined;
  return Math.round(number * 1_000_000) / 1_000_000;
}

function integer(value: unknown, minimum = 0): number | undefined {
  const number = finiteNumber(value, minimum);
  return number === undefined ? undefined : Math.round(number);
}

function frameRate(value: unknown): number | undefined {
  const normalized = boundedText(value, 40);
  if (!normalized) return undefined;
  const [numeratorText, denominatorText] = normalized.split('/');
  const numerator = Number(numeratorText);
  const denominator = denominatorText === undefined ? 1 : Number(denominatorText);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
    return undefined;
  }
  return Math.round((numerator / denominator) * 1_000) / 1_000;
}

function booleanFlag(value: unknown): boolean | undefined {
  if (value === true || value === 1 || value === '1') return true;
  if (value === false || value === 0 || value === '0') return false;
  return undefined;
}

function compact<T extends JsonRecord>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as T;
}

function sanitizeStream(value: unknown) {
  const stream = record(value);
  const disposition = record(stream.disposition);
  const type = boundedText(stream.codec_type, 20);
  const normalizedType = type && ['attachment', 'audio', 'data', 'subtitle', 'video'].includes(type)
    ? type
    : 'unknown';
  return compact({
    bitRate: integer(stream.bit_rate),
    channelLayout: boundedText(stream.channel_layout, 80),
    channels: integer(stream.channels),
    codec: boundedText(stream.codec_name, 80),
    codecDescription: boundedText(stream.codec_long_name, 160),
    codecProfile: boundedText(stream.profile, 120),
    default: booleanFlag(disposition.default),
    durationSeconds: finiteNumber(stream.duration),
    forced: booleanFlag(disposition.forced),
    frameRate: frameRate(stream.avg_frame_rate) ?? frameRate(stream.r_frame_rate),
    height: integer(stream.height),
    index: integer(stream.index),
    pixelFormat: boundedText(stream.pix_fmt, 80),
    sampleRate: integer(stream.sample_rate),
    type: normalizedType,
    width: integer(stream.width),
  });
}

export function parseAgentFfprobeOutput(stdout: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(String(stdout || ''));
  } catch {
    throw new Error('ffprobe 返回了无法解析的媒体信息');
  }
  const root = record(parsed);
  const format = record(root.format);
  const streams = Array.isArray(root.streams)
    ? root.streams.slice(0, MAX_STREAMS).map(sanitizeStream)
    : [];
  const chapterCount = Array.isArray(root.chapters)
    ? Math.min(root.chapters.length, MAX_CHAPTERS)
    : 0;
  return {
    chapterCount,
    format: compact({
      bitRate: integer(format.bit_rate),
      durationSeconds: finiteNumber(format.duration),
      longName: boundedText(format.format_long_name, 160),
      name: boundedText(format.format_name, 160),
      sizeBytes: integer(format.size),
      startTimeSeconds: finiteNumber(format.start_time, Number.NEGATIVE_INFINITY),
    }),
    streamCount: streams.length,
    streams,
  };
}

export function buildAgentFfprobeArgs(sourceUrl: string): string[] {
  return [
    '-v',
    'error',
    '-rw_timeout',
    '15000000',
    '-probesize',
    '5000000',
    '-analyzeduration',
    '15000000',
    '-show_entries',
    'format=format_name,format_long_name,start_time,duration,size,bit_rate:stream=index,codec_type,codec_name,codec_long_name,profile,width,height,pix_fmt,r_frame_rate,avg_frame_rate,sample_rate,channels,channel_layout,bit_rate,duration:stream_disposition=default,forced:chapter=id,start_time,end_time',
    '-of',
    'json',
    sourceUrl,
  ];
}

export async function resolveAgentFfprobePath(): Promise<string | null> {
  return resolveDesktopFfprobePath();
}

export async function inspectAgentMediaSource(
  input: AgentMediaInspectSource,
  signal: AbortSignal,
  dependencies: AgentMediaInspectorDependencies = {},
): Promise<AgentToolResult> {
  const ffprobePath = await (dependencies.resolveFfprobePath || resolveAgentFfprobePath)();
  if (!ffprobePath) {
    return {
      message: '未找到可用的 ffprobe，请安装 FFmpeg 或配置 OMNIFLOW_FFPROBE_PATH',
      ok: false,
    };
  }
  const proxy = (dependencies.createProxySource || createAgentMediaSourceProxy)({
    fileName: input.fileName,
    ...(input.mimeType ? { mimeType: input.mimeType } : {}),
    sourceUrl: input.sourceUrl,
  });
  try {
    const runProcess = dependencies.runProcess || (request => agentLocalProcessRunner.run(request));
    const processResult = await runProcess({
      args: buildAgentFfprobeArgs(proxy.url),
      executablePath: ffprobePath,
      maxOutputBytes: FFPROBE_MAX_OUTPUT_BYTES,
      signal,
      timeoutMs: FFPROBE_TIMEOUT_MS,
    });
    if (processResult.exitCode !== 0) {
      return {
        message: `无法读取“${input.fileName}”的媒体信息（ffprobe 退出码 ${processResult.exitCode ?? 'unknown'}）`,
        ok: false,
      };
    }
    const inspected = parseAgentFfprobeOutput(processResult.stdout);
    return {
      data: {
        file: {
          name: input.fileName,
          nodeId: input.nodeId,
        },
        ...inspected,
      },
      message: `已读取“${input.fileName}”的媒体信息：${inspected.streamCount} 个媒体流`,
      ok: true,
    };
  } finally {
    proxy.release();
  }
}
