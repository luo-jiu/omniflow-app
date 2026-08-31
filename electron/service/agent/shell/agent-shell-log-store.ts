import crypto from 'node:crypto';

import type {
  AgentShellProcessOutputEvent,
} from './agent-shell-process-supervisor';
import type {
  AgentShellLogPageV1,
  AgentShellOutputFrameV1,
} from '../../../../src/shared/agent/shell/agent-shell.types';
export type {
  AgentShellLogPageV1,
  AgentShellOutputFrameV1,
} from '../../../../src/shared/agent/shell/agent-shell.types';
import {
  sanitizeAgentSensitiveText,
} from '../agent-sensitive-data';
import {
  normalizeAgentOwnerScope,
} from '../../../../src/shared/agent/agent-owner-scope';
import type {
  AgentShellWorkspaceOwner,
} from './agent-shell-workspace-store';
import type {
  AgentShellLogFileHandle,
  AgentShellLogFileStore,
} from './agent-shell-log-file-store';

const DEFAULT_TTL_MS = 30 * 60 * 1_000;
const MAX_TTL_MS = 24 * 60 * 60 * 1_000;
const DEFAULT_MAX_DETAILED_BYTES = 8 * 1024 * 1024;
const MAX_DETAILED_BYTES = 64 * 1024 * 1024;
const DEFAULT_MAX_DETAILED_FRAMES = 8_192;
const MAX_DETAILED_FRAMES = 32_768;
const DEFAULT_MAX_TAIL_BYTES = 256 * 1024;
const MAX_TAIL_BYTES = 4 * 1024 * 1024;
const DEFAULT_MAX_TAIL_FRAMES = 128;
const MAX_TAIL_FRAMES = 512;
const DEFAULT_MAX_PAGE_FRAMES = 128;
const MAX_PAGE_FRAMES = 128;
const DEFAULT_MAX_PAGE_BYTES = 256 * 1024;
const MAX_PAGE_BYTES = 256 * 1024;
const MAX_CURSOR_COUNT = 4_096;
const MAX_ID_LENGTH = 200;
const MAX_LOG_REF_LENGTH = 128;
const MAX_OBSERVED_AT_LENGTH = 64;
const MAX_FRAME_BYTES = 16 * 1024;
const REDACTION_CARRY_CHARACTERS = 512;
const SENSITIVE_SUFFIX_PATTERN = /(?:\b(?:api[\s_-]*key|access[\s_-]*token|refresh[\s_-]*token|id[\s_-]*token|client[\s_-]*secret|secret[\s_-]*access[\s_-]*key|private[\s_-]*key|authorization|password|passwd|credential|token)\s*(?::|：|=|\bis\b|是|为)?\s*|\b(?:bearer|basic|apikey)\s+|\b(?:sk-|gh[pousr]_)[a-z0-9_-]*|\b(?:AIza|GOCSPX-)[a-z0-9_-]*)[^\s]{0,512}$/iu;
const LOG_REF_PATTERN = /^log:v1:[a-f0-9]{64}$/u;
const CURSOR_PATTERN = /^cursor:v1:[a-f0-9]{64}$/u;

export interface AgentShellLogIdentity {
  readonly owner: AgentShellWorkspaceOwner;
  readonly sessionId: string;
  readonly runId: string;
  readonly toolRunId: string;
  readonly executionId: string;
}

export interface AgentShellLogCreateInput extends AgentShellLogIdentity {
  readonly expiresAt?: number;
}

export interface AgentShellOutputTailV1 {
  readonly executionId: string;
  readonly firstSequence: number | null;
  readonly lastSequence: number | null;
  readonly truncatedBefore: number | null;
  readonly frames: readonly AgentShellOutputFrameV1[];
}

export interface AgentShellLogFrameRefV1 {
  readonly byteLength: number;
  readonly offset: number;
  readonly recordBytes: number;
  readonly sequence: number;
  readonly stream: 'stdout' | 'stderr';
  readonly observedAt: string;
}

export interface AgentShellLogReadRequest extends AgentShellLogIdentity {
  readonly logRef: string;
  readonly afterSequence?: number;
  readonly cursor?: string;
  readonly maxFrames?: number;
  readonly maxBytes?: number;
}

export interface AgentShellLogPersistedRecord extends AgentShellLogIdentity {
  readonly createdAt: number;
  readonly detailedBytes: number;
  /** Legacy inline frames. New records persist only frame refs. */
  readonly detailedFrames?: readonly AgentShellOutputFrameV1[];
  readonly detailedFrameRefs?: readonly AgentShellLogFrameRefV1[];
  readonly droppedDetailedBytes: number;
  readonly expiresAt: number;
  readonly expired: boolean;
  readonly finished: boolean;
  readonly generation: number;
  readonly lastSequence: number;
  readonly logRef: string;
  readonly tailBytes: number;
  readonly tailFrames: readonly AgentShellOutputFrameV1[];
  readonly truncatedBefore: number | null;
}

export interface AgentShellLogPersistence {
  load: () => Promise<readonly AgentShellLogPersistedRecord[]>;
  replace: (records: readonly AgentShellLogPersistedRecord[]) => Promise<void>;
  close?: () => Promise<void>;
}

/**
 * Main-only quota boundary for detailed Shell logs.
 *
 * The Store owns log identity and retention policy; an adapter owns the
 * concrete quota ledger and physical resource. Calls are intentionally
 * asynchronous so Supervisor output can keep draining while quota writes
 * settle in the background.
 */
export interface AgentShellLogResourceQuota {
  /** Must be all-or-nothing: a rejected call must not leave a bound resource. */
  reserve: (input: {
    readonly owner: AgentShellWorkspaceOwner;
    readonly resourceRef: string;
    readonly runId: string;
    readonly expectedBytes: number;
    readonly ttlMs: number;
  }) => Promise<AgentShellLogQuotaReservation>;
  adjust: (input: {
    readonly owner: AgentShellWorkspaceOwner;
    readonly resourceRef: string;
    readonly bytes: number;
  }) => Promise<void>;
  commit: (input: {
    readonly owner: AgentShellWorkspaceOwner;
    readonly reservationId: string;
    readonly resourceRef: string;
    readonly actualBytes: number;
  }) => Promise<void>;
  markDeleting: (input: {
    readonly owner: AgentShellWorkspaceOwner;
    readonly reservationId: string;
    readonly resourceRef: string;
    readonly observedBytes: number;
  }) => Promise<void>;
  release: (input: {
    readonly owner: AgentShellWorkspaceOwner;
    readonly reservationId: string;
    readonly resourceRef: string;
  }) => Promise<void>;
  reattach?: (input: {
    readonly owner: AgentShellWorkspaceOwner;
    readonly resourceRef: string;
    readonly runId: string;
  }) => Promise<{
    readonly accountedBytes: number;
    readonly reservationId: string;
    readonly state: 'bound' | 'committed';
  } | null>;
}

export interface AgentShellLogQuotaReservation {
  readonly reservationId: string;
  readonly resourceRef: string;
}

export interface AgentShellLogStoreOptions {
  readonly createId?: () => string;
  readonly maxDetailedBytes?: number;
  readonly maxDetailedFrames?: number;
  readonly maxPageBytes?: number;
  readonly maxPageFrames?: number;
  readonly maxTailBytes?: number;
  readonly maxTailFrames?: number;
  readonly now?: () => number;
  readonly onFrame?: (frame: AgentShellOutputFrameV1) => void;
  readonly physicalStore?: Pick<AgentShellLogFileStore, 'create' | 'open'>;
  readonly persistence?: AgentShellLogPersistence;
  readonly quota?: AgentShellLogResourceQuota;
  readonly ttlMs?: number;
}

export interface AgentShellLogAppendResult {
  readonly frames: readonly AgentShellOutputFrameV1[];
  readonly droppedDetailedBytes: number;
}

export interface AgentShellLogHandle {
  readonly logRef: string;
  appendSupervisorOutput: (event: AgentShellProcessOutputEvent) => AgentShellLogAppendResult;
  finish: () => AgentShellLogAppendResult;
  /** Waits for this log's physical writes, quota operations, and metadata checkpoint. */
  flush: () => Promise<void>;
  getTail: () => AgentShellOutputTailV1;
  dispose: () => Promise<boolean>;
}

interface CursorRecord {
  readonly afterSequence: number;
  readonly generation: number;
  readonly logRef: string;
}

interface AnsiParserState {
  mode: 'normal' | 'escape' | 'csi' | 'osc' | 'osc-escape';
}

interface LogRecord extends AgentShellLogIdentity {
  ansi: {
    readonly stderr: AnsiParserState;
    readonly stdout: AnsiParserState;
  };
  createdAt: number;
  detailedBytes: number;
  detailedFrameRefs: AgentShellLogFrameRefV1[];
  detailedFrames: AgentShellOutputFrameV1[];
  detailedFrameCount: number;
  pendingDetailedBytes: number;
  pendingDetailedFrames: number;
  droppedDetailedBytes: number;
  expiresAt: number;
  finished: boolean;
  generation: number;
  lastSequence: number;
  logRef: string;
  redactionCarry: {
    stderr: string;
    stdout: string;
  };
  redactionCarryOrder: ('stdout' | 'stderr')[];
  tailBytes: number;
  tailFrames: AgentShellOutputFrameV1[];
  truncatedBefore: number | null;
  status: 'active' | 'expired';
  physicalHandlePromise: Promise<AgentShellLogFileHandle> | null;
  physicalSizeBytes: number;
  physicalWriteQueue: Promise<void>;
  detailedStorageError?: unknown;
  quota?: LogQuotaBinding;
}

interface LogQuotaBinding {
  accountedBytes: number;
  adjustmentQueued: boolean;
  desiredBytes: number;
  error?: unknown;
  lifecycle: 'active' | 'finished' | 'deleting' | 'disposed';
  operation: Promise<void>;
  observedBytes: number;
  reservationId?: string;
  state: 'pending' | 'ready' | 'committed' | 'released' | 'failed';
}

function invalidLog(message: string): never {
  throw new Error(message);
}

function normalizeString(value: unknown, label: string, maximum = MAX_ID_LENGTH): string {
  const normalized = String(value ?? '').trim();
  if (!normalized || normalized.length > maximum || normalized.includes('\u0000')) {
    invalidLog(`${label}无效`);
  }
  return normalized;
}

function normalizeOwner(owner: AgentShellWorkspaceOwner): AgentShellWorkspaceOwner {
  const scope = normalizeAgentOwnerScope(owner);
  return Object.freeze({
    ...scope,
    sessionId: normalizeString(owner?.sessionId, 'Agent Shell Session ID'),
  });
}

function normalizeIdentity(input: AgentShellLogIdentity): AgentShellLogIdentity {
  if (!input || typeof input !== 'object') invalidLog('Agent Shell 日志身份缺失');
  const owner = normalizeOwner(input.owner);
  const sessionId = normalizeString(input.sessionId, 'Agent Shell Session ID');
  if (owner.sessionId !== sessionId) invalidLog('Agent Shell 日志 Session 身份不匹配');
  return Object.freeze({
    executionId: normalizeString(input.executionId, 'Agent Shell execution ID'),
    owner,
    runId: normalizeString(input.runId, 'Agent Shell Run ID'),
    sessionId,
    toolRunId: normalizeString(input.toolRunId, 'Agent Shell ToolRun ID'),
  });
}

function sameIdentity(left: AgentShellLogIdentity, right: AgentShellLogIdentity): boolean {
  return left.executionId === right.executionId
    && left.runId === right.runId
    && left.sessionId === right.sessionId
    && left.toolRunId === right.toolRunId
    && left.owner.accountScope === right.owner.accountScope
    && left.owner.backendScope === right.owner.backendScope;
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  maximum: number,
  label: string,
): number {
  const normalized = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(normalized) || normalized <= 0 || normalized > maximum) {
    invalidLog(`${label}无效`);
  }
  return normalized;
}

function boundedPageInteger(
  value: number | undefined,
  fallback: number,
  maximum: number,
  minimum = 1,
): number {
  if (value === undefined) return fallback;
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized <= 0) invalidLog('Agent Shell 日志页大小无效');
  return Math.max(minimum, Math.min(normalized, maximum));
}

function normalizeSequence(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) invalidLog(`${label}无效`);
  return value as number;
}

function normalizePositiveSequence(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) invalidLog(`${label}无效`);
  return value as number;
}

function normalizeObservedAt(value: unknown): string {
  const normalized = normalizeString(value, 'Agent Shell 日志时间', MAX_OBSERVED_AT_LENGTH);
  if (!Number.isFinite(Date.parse(normalized))) invalidLog('Agent Shell 日志时间无效');
  return normalized;
}

function normalizeFrame(frame: AgentShellOutputFrameV1): AgentShellOutputFrameV1 {
  if (!frame || typeof frame !== 'object') invalidLog('Agent Shell 日志 frame 无效');
  const text = typeof frame.text === 'string' ? frame.text : invalidLog('Agent Shell 日志正文无效');
  if (!text || text.includes('\u0000') || Buffer.byteLength(text, 'utf8') > MAX_FRAME_BYTES) {
    invalidLog('Agent Shell 日志正文无效');
  }
  if (frame.stream !== 'stdout' && frame.stream !== 'stderr') invalidLog('Agent Shell 日志流无效');
  return Object.freeze({
    executionId: normalizeString(frame.executionId, 'Agent Shell execution ID'),
    observedAt: normalizeObservedAt(frame.observedAt),
    sequence: normalizePositiveSequence(frame.sequence, 'Agent Shell 日志 sequence'),
    stream: frame.stream,
    text,
  });
}

function hashOpaque(prefix: string, value: string): string {
  return `${prefix}${crypto.createHash('sha256').update(value, 'utf8').digest('hex')}`;
}

function createOpaqueRef(createId: () => string, prefix: string, used: Set<string>): string {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = hashOpaque(prefix, `${createId()}\u0000${attempt}`);
    if (!used.has(candidate)) return candidate;
  }
  invalidLog('Agent Shell 日志 opaque reference 冲突');
}

function stripAnsiChunk(state: AnsiParserState, input: string): string {
  let output = '';
  for (const character of input) {
    const code = character.codePointAt(0) || 0;
    if (state.mode === 'normal') {
      if (character === '\u001b') state.mode = 'escape';
      else if (character === '\u009b') state.mode = 'csi';
      else if (character === '\u009d') state.mode = 'osc';
      else if (code === 0x07 || (code < 0x20 && character !== '\n' && character !== '\r' && character !== '\t')) {
        // Drop terminal controls while retaining text layout controls.
      } else output += character;
      continue;
    }
    if (state.mode === 'escape') {
      if (character === '[') state.mode = 'csi';
      else if (character === ']') state.mode = 'osc';
      else state.mode = 'normal';
      continue;
    }
    if (state.mode === 'csi') {
      if (code >= 0x40 && code <= 0x7e) state.mode = 'normal';
      continue;
    }
    if (state.mode === 'osc') {
      if (character === '\u0007') state.mode = 'normal';
      else if (character === '\u001b') state.mode = 'osc-escape';
      continue;
    }
    if (character === '\\') state.mode = 'normal';
    else if (character !== '\u001b') state.mode = 'osc';
  }
  return output;
}

function splitFrameText(text: string): string[] {
  const frames: string[] = [];
  let current = '';
  let currentBytes = 0;
  for (const character of text) {
    const characterBytes = Buffer.byteLength(character, 'utf8');
    if (current && currentBytes + characterBytes > MAX_FRAME_BYTES) {
      frames.push(current);
      current = '';
      currentBytes = 0;
    }
    current += character;
    currentBytes += characterBytes;
  }
  if (current) frames.push(current);
  return frames;
}

function shouldHoldRedactionSuffix(value: string): boolean {
  return SENSITIVE_SUFFIX_PATTERN.test(value);
}

function cloneFrame(frame: AgentShellOutputFrameV1): AgentShellOutputFrameV1 {
  return Object.freeze({ ...frame });
}

function cloneFrameRef(ref: AgentShellLogFrameRefV1): AgentShellLogFrameRefV1 {
  return Object.freeze({ ...ref });
}

function encodeDetailedFrame(frame: AgentShellOutputFrameV1): Buffer {
  return Buffer.from(`${JSON.stringify(frame)}\n`, 'utf8');
}

function normalizeFrameRef(input: AgentShellLogFrameRefV1): AgentShellLogFrameRefV1 {
  if (!input || typeof input !== 'object') invalidLog('Agent Shell 日志 frame 索引无效');
  const sequence = normalizePositiveSequence(input.sequence, 'Agent Shell 日志 frame sequence');
  const offset = normalizeSequence(input.offset, 'Agent Shell 日志 frame offset');
  const byteLength = normalizePositiveSequence(input.byteLength, 'Agent Shell 日志 frame 字节数');
  const recordBytes = normalizePositiveSequence(input.recordBytes, 'Agent Shell 日志 frame 记录字节数');
  if (input.stream !== 'stdout' && input.stream !== 'stderr') invalidLog('Agent Shell 日志 frame 流无效');
  const observedAt = normalizeObservedAt(input.observedAt);
  if (recordBytes < byteLength || recordBytes > maxSafeRecordBytes()) {
    invalidLog('Agent Shell 日志 frame 记录大小无效');
  }
  return Object.freeze({ byteLength, offset, recordBytes, sequence, stream: input.stream, observedAt });
}

function maxSafeRecordBytes(): number {
  return MAX_FRAME_BYTES * 2;
}

function decodeDetailedFrame(data: Uint8Array, ref: AgentShellLogFrameRefV1): AgentShellOutputFrameV1 {
  const serialized = Buffer.from(data).toString('utf8');
  if (Buffer.byteLength(serialized, 'utf8') !== ref.recordBytes || !serialized.endsWith('\n')) {
    invalidLog('Agent Shell 物理日志 frame 边界无效');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized.slice(0, -1));
  } catch {
    invalidLog('Agent Shell 物理日志 frame JSON 无效');
  }
  const frame = normalizeFrame(parsed as AgentShellOutputFrameV1);
  if (
    frame.sequence !== ref.sequence
    || frame.stream !== ref.stream
    || frame.observedAt !== ref.observedAt
    || Buffer.byteLength(frame.text, 'utf8') !== ref.byteLength
  ) {
    invalidLog('Agent Shell 物理日志 frame 索引不匹配');
  }
  return frame;
}

function cloneTail(record: LogRecord): AgentShellOutputTailV1 {
  return Object.freeze({
    executionId: record.executionId,
    firstSequence: record.tailFrames[0]?.sequence ?? null,
    frames: Object.freeze(record.tailFrames.map(cloneFrame)),
    lastSequence: record.tailFrames.at(-1)?.sequence ?? null,
    truncatedBefore: record.truncatedBefore,
  });
}

function toPersistedRecord(record: LogRecord): AgentShellLogPersistedRecord {
  return Object.freeze({
    executionId: record.executionId,
    owner: record.owner,
    runId: record.runId,
    sessionId: record.sessionId,
    toolRunId: record.toolRunId,
    createdAt: record.createdAt,
    detailedBytes: record.detailedBytes,
    ...(record.detailedFrameRefs.length > 0
      ? { detailedFrameRefs: Object.freeze(record.detailedFrameRefs.map(cloneFrameRef)) }
      : record.detailedFrames.length > 0
        ? { detailedFrames: Object.freeze(record.detailedFrames.map(cloneFrame)) }
        : {}),
    droppedDetailedBytes: record.droppedDetailedBytes,
    expiresAt: record.expiresAt,
    expired: record.status === 'expired',
    finished: record.finished,
    generation: record.generation,
    lastSequence: record.lastSequence,
    logRef: record.logRef,
    tailBytes: record.tailBytes,
    tailFrames: Object.freeze(record.tailFrames.map(cloneFrame)),
    truncatedBefore: record.truncatedBefore,
  });
}

function createEmptyParser(): { stderr: AnsiParserState; stdout: AnsiParserState } {
  return {
    stderr: { mode: 'normal' },
    stdout: { mode: 'normal' },
  };
}

function validatePersistedRecord(input: AgentShellLogPersistedRecord): AgentShellLogPersistedRecord {
  if (!input || typeof input !== 'object') invalidLog('Agent Shell 持久化日志记录无效');
  const identity = normalizeIdentity(input);
  const logRef = normalizeString(input.logRef, 'Agent Shell logRef', MAX_LOG_REF_LENGTH);
  if (!LOG_REF_PATTERN.test(logRef)) invalidLog('Agent Shell logRef 无效');
  const createdAt = normalizeSequence(input.createdAt, 'Agent Shell 日志创建时间');
  const expiresAt = normalizeSequence(input.expiresAt, 'Agent Shell 日志过期时间');
  if (expiresAt <= createdAt) invalidLog('Agent Shell 日志过期时间无效');
  const generation = normalizePositiveSequence(input.generation, 'Agent Shell 日志 generation');
  const hasDetailedFrames = input.detailedFrames !== undefined;
  const hasDetailedFrameRefs = input.detailedFrameRefs !== undefined;
  if (hasDetailedFrames && !Array.isArray(input.detailedFrames)) invalidLog('Agent Shell 详细日志 frames 无效');
  if (hasDetailedFrameRefs && !Array.isArray(input.detailedFrameRefs)) invalidLog('Agent Shell 详细日志索引无效');
  if (hasDetailedFrames && hasDetailedFrameRefs) invalidLog('Agent Shell 详细日志重复存储');
  const detailedFrames = hasDetailedFrames
    ? (input.detailedFrames as readonly AgentShellOutputFrameV1[]).map(normalizeFrame)
    : [];
  const detailedFrameRefs = hasDetailedFrameRefs
    ? (input.detailedFrameRefs as readonly AgentShellLogFrameRefV1[]).map(normalizeFrameRef)
    : [];
  for (let index = 1; index < detailedFrameRefs.length; index += 1) {
    const previous = detailedFrameRefs[index - 1];
    const current = detailedFrameRefs[index];
    if (current.sequence <= previous.sequence || current.offset < previous.offset + previous.recordBytes) {
      invalidLog('Agent Shell 日志 frame 索引顺序无效');
    }
  }
  const tailFrames = Array.isArray(input.tailFrames)
    ? input.tailFrames.map(normalizeFrame)
    : invalidLog('Agent Shell tail frames 无效');
  const allSequences = [
    ...detailedFrames.map(frame => frame.sequence),
    ...detailedFrameRefs.map(frame => frame.sequence),
    ...tailFrames.map(frame => frame.sequence),
  ];
  const lastSequence = normalizeSequence(input.lastSequence, 'Agent Shell 日志 lastSequence');
  if (allSequences.some(frame => frame > lastSequence)) invalidLog('Agent Shell 日志 sequence 超出终态水位');
  if ([...detailedFrames, ...tailFrames].some(frame => frame.executionId !== identity.executionId)) {
    invalidLog('Agent Shell 日志 frame 身份不匹配');
  }
  const frameBySequence = new Map<number, string>();
  [...detailedFrames, ...tailFrames].forEach((frame) => {
    const serialized = JSON.stringify(frame);
    const previous = frameBySequence.get(frame.sequence);
    if (previous && previous !== serialized) invalidLog('Agent Shell 日志 sequence 内容不一致');
    frameBySequence.set(frame.sequence, serialized);
  });
  detailedFrameRefs.forEach((ref) => {
    const tailFrame = tailFrames.find(frame => frame.sequence === ref.sequence);
    if (
      tailFrame
      && (tailFrame.stream !== ref.stream
        || tailFrame.observedAt !== ref.observedAt
        || Buffer.byteLength(tailFrame.text, 'utf8') !== ref.byteLength)
    ) {
      invalidLog('Agent Shell 日志 frame 索引内容不一致');
    }
  });
  const detailedBytes = normalizeSequence(input.detailedBytes, 'Agent Shell 详细日志字节数');
  const tailBytes = normalizeSequence(input.tailBytes, 'Agent Shell tail 字节数');
  const detailedFrameBytes = detailedFrames.reduce(
    (total, frame) => total + Buffer.byteLength(frame.text, 'utf8'),
    0,
  ) + detailedFrameRefs.reduce((total, ref) => total + ref.byteLength, 0);
  if (detailedBytes !== detailedFrameBytes) {
    invalidLog('Agent Shell 详细日志字节计数不匹配');
  }
  if (tailBytes !== tailFrames.reduce((total, frame) => total + Buffer.byteLength(frame.text, 'utf8'), 0)) {
    invalidLog('Agent Shell tail 字节计数不匹配');
  }
  return Object.freeze({
    ...identity,
    createdAt,
    detailedBytes,
    ...(hasDetailedFrameRefs
      ? { detailedFrameRefs: Object.freeze(detailedFrameRefs) }
      : { detailedFrames: Object.freeze(detailedFrames) }),
    droppedDetailedBytes: normalizeSequence(input.droppedDetailedBytes, 'Agent Shell 丢弃日志字节数'),
    expiresAt,
    expired: typeof input.expired === 'boolean'
      ? input.expired
      : invalidLog('Agent Shell 日志过期标记无效'),
    finished: typeof input.finished === 'boolean'
      ? input.finished
      : invalidLog('Agent Shell 日志终态标记无效'),
    generation,
    lastSequence,
    logRef,
    tailBytes,
    tailFrames: Object.freeze(tailFrames),
    truncatedBefore: input.truncatedBefore === null
      ? null
      : normalizePositiveSequence(input.truncatedBefore, 'Agent Shell tail 截断水位'),
  });
}

interface FrameEntry {
  readonly frame?: AgentShellOutputFrameV1;
  readonly ref?: AgentShellLogFrameRefV1;
  readonly sequence: number;
  readonly byteLength: number;
}

function collectFrameEntries(record: LogRecord): FrameEntry[] {
  const entries = new Map<number, FrameEntry>();
  record.detailedFrameRefs.forEach((ref) => {
    entries.set(ref.sequence, { byteLength: ref.byteLength, ref, sequence: ref.sequence });
  });
  record.detailedFrames.forEach((frame) => {
    if (!entries.has(frame.sequence)) {
      entries.set(frame.sequence, {
        byteLength: Buffer.byteLength(frame.text, 'utf8'),
        frame,
        sequence: frame.sequence,
      });
    }
  });
  record.tailFrames.forEach((frame) => {
    if (!entries.has(frame.sequence)) {
      entries.set(frame.sequence, {
        byteLength: Buffer.byteLength(frame.text, 'utf8'),
        frame,
        sequence: frame.sequence,
      });
    }
  });
  return [...entries.values()].sort((left, right) => left.sequence - right.sequence);
}

function rangesForSequences(sequences: readonly number[]) {
  const ranges: Array<{ firstSequence: number; lastSequence: number }> = [];
  sequences.forEach((sequence) => {
    const previous = ranges.at(-1);
    if (previous && sequence === previous.lastSequence + 1) previous.lastSequence = sequence;
    else ranges.push({ firstSequence: sequence, lastSequence: sequence });
  });
  return Object.freeze(ranges.map(range => Object.freeze(range)));
}

function assertPageRequest(request: AgentShellLogReadRequest): {
  identity: AgentShellLogIdentity;
  logRef: string;
  afterSequence?: number;
  cursor?: string;
} {
  const identity = normalizeIdentity(request);
  const logRef = normalizeString(request.logRef, 'Agent Shell logRef', MAX_LOG_REF_LENGTH);
  if (!LOG_REF_PATTERN.test(logRef)) invalidLog('Agent Shell logRef 无效');
  const afterSequence = request.afterSequence === undefined
    ? undefined
    : normalizeSequence(request.afterSequence, 'Agent Shell afterSequence');
  const cursor = request.cursor === undefined
    ? undefined
    : normalizeString(request.cursor, 'Agent Shell 日志 cursor', MAX_LOG_REF_LENGTH);
  if (cursor && !CURSOR_PATTERN.test(cursor)) invalidLog('Agent Shell 日志 cursor 无效');
  if (afterSequence !== undefined && cursor !== undefined) {
    invalidLog('Agent Shell 日志 afterSequence 与 cursor 不能同时使用');
  }
  return { afterSequence, cursor, identity, logRef };
}

export function createAgentShellLogStore(options: AgentShellLogStoreOptions = {}) {
  const createId = options.createId || crypto.randomUUID;
  const now = options.now || Date.now;
  const ttlMs = boundedInteger(options.ttlMs, DEFAULT_TTL_MS, MAX_TTL_MS, 'Agent Shell 日志 TTL');
  const maxDetailedBytes = boundedInteger(
    options.maxDetailedBytes,
    DEFAULT_MAX_DETAILED_BYTES,
    MAX_DETAILED_BYTES,
    'Agent Shell 详细日志上限',
  );
  const maxDetailedFrames = boundedInteger(
    options.maxDetailedFrames,
    DEFAULT_MAX_DETAILED_FRAMES,
    MAX_DETAILED_FRAMES,
    'Agent Shell 详细日志 frame 上限',
  );
  const maxTailBytes = Math.max(
    MAX_FRAME_BYTES,
    boundedInteger(options.maxTailBytes, DEFAULT_MAX_TAIL_BYTES, MAX_TAIL_BYTES, 'Agent Shell tail 上限'),
  );
  const maxTailFrames = boundedInteger(options.maxTailFrames, DEFAULT_MAX_TAIL_FRAMES, MAX_TAIL_FRAMES, 'Agent Shell tail frame 上限');
  const maxPageBytes = Math.max(
    MAX_FRAME_BYTES,
    boundedInteger(options.maxPageBytes, DEFAULT_MAX_PAGE_BYTES, MAX_PAGE_BYTES, 'Agent Shell 日志页字节上限'),
  );
  const maxPageFrames = boundedInteger(options.maxPageFrames, DEFAULT_MAX_PAGE_FRAMES, MAX_PAGE_FRAMES, 'Agent Shell 日志页 frame 上限');
  const persistence = options.persistence;
  const physicalStore = options.physicalStore;
  if (physicalStore && (
    typeof physicalStore.create !== 'function'
    || typeof physicalStore.open !== 'function'
  )) {
    invalidLog('Agent Shell 日志 physical store 无效');
  }
  const quota = options.quota;
  if (quota && (
    typeof quota.reserve !== 'function'
    || typeof quota.adjust !== 'function'
    || typeof quota.commit !== 'function'
    || typeof quota.markDeleting !== 'function'
    || typeof quota.release !== 'function'
  )) {
    invalidLog('Agent Shell 日志 quota adapter 无效');
  }
  const records = new Map<string, LogRecord>();
  const cursors = new Map<string, CursorRecord>();
  const usedRefs = new Set<string>();
  const usedCursors = new Set<string>();
  let persistenceError: unknown;
  let persistenceQueue = Promise.resolve();
  let quotaError: unknown;
  const quotaTasks = new Set<Promise<void>>();
  const physicalTasks = new Set<Promise<void>>();

  function persist(): void {
    if (!persistence) return;
    const snapshot = [...records.values()].map(toPersistedRecord);
    persistenceQueue = persistenceQueue
      .then(() => persistence.replace(snapshot))
      .catch((error: unknown) => {
        persistenceError = error;
      });
  }

  function trackPhysicalTask(task: Promise<void>): void {
    physicalTasks.add(task);
    void task.then(
      () => physicalTasks.delete(task),
      () => physicalTasks.delete(task),
    );
  }

  function ensurePhysicalHandle(record: LogRecord): Promise<AgentShellLogFileHandle> {
    if (!physicalStore) return Promise.reject(new Error('Agent Shell 物理日志 Store 未配置'));
    if (!record.physicalHandlePromise) {
      record.physicalHandlePromise = physicalStore.open(record.logRef);
    }
    return record.physicalHandlePromise;
  }

  async function verifyPhysicalSize(record: LogRecord): Promise<void> {
    if (!physicalStore || !record.physicalHandlePromise) return;
    const handle = await record.physicalHandlePromise;
    const actualSize = await handle.getSize();
    if (actualSize !== record.physicalSizeBytes) {
      throw new Error('Agent Shell 物理日志大小与索引不一致');
    }
  }

  function queueDetailedFrame(record: LogRecord, frame: AgentShellOutputFrameV1): void {
    const frameBytes = Buffer.byteLength(frame.text, 'utf8');
    if (!physicalStore) {
      record.detailedFrames.push(frame);
      record.detailedBytes += frameBytes;
      record.detailedFrameCount += 1;
      return;
    }
    record.pendingDetailedBytes += frameBytes;
    record.pendingDetailedFrames += 1;
    const encoded = encodeDetailedFrame(frame);
    const task = record.physicalWriteQueue
      .then(async () => {
        try {
          const handle = await ensurePhysicalHandle(record);
          const offset = record.physicalSizeBytes;
          const result = await handle.append(encoded);
          if (result.acceptedBytes !== encoded.length) {
            throw new Error('Agent Shell 物理日志写入被截断');
          }
          record.physicalSizeBytes = result.sizeBytes;
          record.pendingDetailedBytes -= frameBytes;
          record.pendingDetailedFrames -= 1;
          record.detailedBytes += frameBytes;
          record.detailedFrameCount += 1;
          record.detailedFrameRefs.push(Object.freeze({
            byteLength: frameBytes,
            offset,
            recordBytes: encoded.length,
            sequence: frame.sequence,
            stream: frame.stream,
            observedAt: frame.observedAt,
          }));
        } catch (error) {
          record.pendingDetailedBytes -= frameBytes;
          record.pendingDetailedFrames -= 1;
          record.droppedDetailedBytes += frameBytes;
          record.detailedStorageError = error;
        }
        requestQuotaAdjustment(record);
        persist();
      });
    record.physicalWriteQueue = task;
    trackPhysicalTask(task);
  }

  async function flushPhysical(): Promise<void> {
    const handles = [...records.values()]
      .map(record => record.physicalHandlePromise)
      .filter((promise): promise is Promise<AgentShellLogFileHandle> => Boolean(promise));
    await Promise.all(handles.map(async promise => {
      try {
        await promise;
      } catch (error) {
        const record = [...records.values()].find(candidate => candidate.physicalHandlePromise === promise);
        if (record) record.detailedStorageError = error;
      }
    }));
    for (;;) {
      const pending = [...physicalTasks];
      if (pending.length === 0) break;
      await Promise.all(pending);
    }
    await Promise.all([...records.values()].map(async record => {
      try {
        await verifyPhysicalSize(record);
      } catch (error) {
        record.detailedStorageError = error;
      }
    }));
    const storageError = [...records.values()].find(record => record.detailedStorageError)?.detailedStorageError;
    if (storageError !== undefined) throw storageError;
  }

  function reportQuotaError(record: LogRecord, error: unknown): void {
    if (record.quota && record.quota.error === undefined) record.quota.error = error;
    if (quotaError === undefined) quotaError = error;
  }

  function queueQuotaOperation(
    record: LogRecord,
    operation: () => Promise<void>,
  ): void {
    const binding = record.quota;
    if (!binding) return;
    const next = binding.operation
      .then(operation)
      .catch((error: unknown) => {
        reportQuotaError(record, error);
      });
    binding.operation = next;
    quotaTasks.add(next);
    void next.then(
      () => quotaTasks.delete(next),
      () => quotaTasks.delete(next),
    );
  }

  function validateQuotaReservation(
    input: AgentShellLogQuotaReservation,
    resourceRef: string,
  ): AgentShellLogQuotaReservation {
    if (!input || typeof input !== 'object') invalidLog('Agent Shell 日志 quota reservation 无效');
    const reservationId = normalizeString(
      input.reservationId,
      'Agent Shell 日志 quota reservation ID',
    );
    const returnedResourceRef = normalizeString(
      input.resourceRef,
      'Agent Shell 日志 quota resource ref',
      MAX_LOG_REF_LENGTH,
    );
    if (returnedResourceRef !== resourceRef) {
      invalidLog('Agent Shell 日志 quota resource ref 不匹配');
    }
    return Object.freeze({ reservationId, resourceRef: returnedResourceRef });
  }

  function requestQuotaAdjustment(record: LogRecord): void {
    const binding = record.quota;
    if (!binding) return;
    binding.desiredBytes = record.detailedBytes;
    binding.observedBytes = Math.max(binding.observedBytes, record.detailedBytes);
    if (
      binding.lifecycle !== 'active'
      || binding.state !== 'ready'
      || binding.adjustmentQueued
      || binding.desiredBytes === binding.accountedBytes
    ) return;
    binding.adjustmentQueued = true;
    queueQuotaOperation(record, async () => {
      try {
        if (
          binding.lifecycle !== 'active'
          || binding.state !== 'ready'
          || !binding.reservationId
        ) return;
        const targetBytes = binding.desiredBytes;
        if (targetBytes === binding.accountedBytes) return;
        await quota?.adjust({
          bytes: targetBytes,
          owner: record.owner,
          resourceRef: record.logRef,
        });
        binding.accountedBytes = targetBytes;
      } finally {
        binding.adjustmentQueued = false;
      }
      if (
        binding.lifecycle === 'active'
        && binding.state === 'ready'
        && binding.desiredBytes !== binding.accountedBytes
      ) {
        requestQuotaAdjustment(record);
      }
    });
  }

  function queueQuotaRelease(record: LogRecord): void {
    const binding = record.quota;
    if (!binding) return;
    binding.lifecycle = 'deleting';
    queueQuotaOperation(record, async () => {
      await record.physicalWriteQueue;
      if (!binding.reservationId || binding.state === 'released' || binding.state === 'failed') return;
      const observedBytes = Math.max(
        binding.accountedBytes,
        binding.observedBytes,
        record.detailedBytes,
      );
      await quota?.markDeleting({
        observedBytes,
        owner: record.owner,
        reservationId: binding.reservationId,
        resourceRef: record.logRef,
      });
      await quota?.release({
        owner: record.owner,
        reservationId: binding.reservationId,
        resourceRef: record.logRef,
      });
      binding.state = 'released';
    });
  }

  function queueQuotaCommit(record: LogRecord): void {
    const binding = record.quota;
    if (!binding) return;
    binding.lifecycle = 'finished';
    queueQuotaOperation(record, async () => {
      await record.physicalWriteQueue;
      if (!binding.reservationId || binding.state !== 'ready') return;
      await quota?.commit({
        actualBytes: record.detailedBytes,
        owner: record.owner,
        reservationId: binding.reservationId,
        resourceRef: record.logRef,
      });
      binding.accountedBytes = record.detailedBytes;
      binding.desiredBytes = record.detailedBytes;
      binding.observedBytes = Math.max(binding.observedBytes, record.detailedBytes);
      binding.state = 'committed';
    });
  }

  function startQuotaReservation(record: LogRecord): void {
    const binding = record.quota;
    if (!binding || !quota) return;
    queueQuotaOperation(record, async () => {
      try {
        const reservation = validateQuotaReservation(
          await quota.reserve({
            expectedBytes: maxDetailedBytes,
            owner: record.owner,
            resourceRef: record.logRef,
            runId: record.runId,
            ttlMs: record.expiresAt - record.createdAt,
          }),
          record.logRef,
        );
        binding.reservationId = reservation.reservationId;
        binding.state = 'ready';
        if (binding.lifecycle === 'active') requestQuotaAdjustment(record);
      } catch (error) {
        binding.state = 'failed';
        throw error;
      }
    });
  }

  function startQuotaReattach(record: LogRecord): void {
    const binding = record.quota;
    if (!binding || !quota?.reattach) return;
    queueQuotaOperation(record, async () => {
      const result = await quota.reattach?.({
        owner: record.owner,
        resourceRef: record.logRef,
        runId: record.runId,
      });
      if (!result) {
        binding.state = 'failed';
        throw new Error('Agent Shell 日志 quota reservation 恢复失败');
      }
      binding.reservationId = result.reservationId;
      binding.accountedBytes = result.accountedBytes;
      binding.desiredBytes = record.detailedBytes;
      binding.observedBytes = Math.max(binding.observedBytes, record.detailedBytes);
      binding.state = result.state === 'committed' ? 'committed' : 'ready';
      if (binding.lifecycle === 'active' && binding.state === 'ready') requestQuotaAdjustment(record);
      if (binding.lifecycle === 'finished' && binding.state === 'ready') queueQuotaCommit(record);
      if (binding.lifecycle === 'deleting') queueQuotaRelease(record);
    });
  }

  async function flushQuota(): Promise<void> {
    for (;;) {
      const pending = [...quotaTasks];
      if (pending.length === 0) break;
      await Promise.all(pending);
    }
    if (quotaError !== undefined) throw quotaError;
  }

  function markExpired(record: LogRecord): void {
    if (record.status === 'expired') return;
    if (record.quota) {
      record.quota.desiredBytes = record.detailedBytes;
      record.quota.observedBytes = Math.max(record.quota.observedBytes, record.detailedBytes);
    }
    record.status = 'expired';
    record.detailedFrameRefs = [];
    record.detailedFrames = [];
    record.detailedFrameCount = 0;
    record.pendingDetailedBytes = 0;
    record.pendingDetailedFrames = 0;
    record.tailFrames = [];
    record.detailedBytes = 0;
    record.tailBytes = 0;
    record.redactionCarry.stderr = '';
    record.redactionCarry.stdout = '';
    record.redactionCarryOrder = [];
    for (const [cursor, value] of cursors) {
      if (value.logRef === record.logRef) {
        cursors.delete(cursor);
        usedCursors.delete(cursor);
      }
    }
    queueQuotaRelease(record);
  }

  function sweep(currentTime = now()): number {
    let expired = 0;
    records.forEach((record) => {
      if (record.status === 'active' && record.expiresAt <= currentTime) {
        markExpired(record);
        expired += 1;
      }
    });
    if (expired > 0) persist();
    return expired;
  }

  function requireRecord(logRef: string, identity: AgentShellLogIdentity): LogRecord {
    const record = records.get(logRef);
    if (!record) invalidLog('Agent Shell logRef 不存在');
    if (!sameIdentity(record, identity)) invalidLog('Agent Shell 日志身份不匹配');
    if (record.status === 'active' && record.expiresAt <= now()) {
      markExpired(record);
      persist();
    }
    return record;
  }

  function emitFrame(record: LogRecord, stream: 'stdout' | 'stderr', text: string): AgentShellOutputFrameV1 {
    const frame = Object.freeze({
      executionId: record.executionId,
      observedAt: new Date(now()).toISOString(),
      sequence: record.lastSequence + 1,
      stream,
      text,
    });
    record.lastSequence = frame.sequence;
    const byteLength = Buffer.byteLength(text, 'utf8');
    if (
      record.detailedFrameCount + record.pendingDetailedFrames < maxDetailedFrames
      && record.detailedBytes + record.pendingDetailedBytes + byteLength <= maxDetailedBytes
    ) {
      queueDetailedFrame(record, frame);
    } else record.droppedDetailedBytes += byteLength;
    record.tailFrames.push(frame);
    record.tailBytes += byteLength;
    while (record.tailFrames.length > maxTailFrames || record.tailBytes > maxTailBytes) {
      const removed = record.tailFrames.shift();
      if (!removed) break;
      record.tailBytes -= Buffer.byteLength(removed.text, 'utf8');
      record.truncatedBefore = Math.max(record.truncatedBefore || 0, removed.sequence + 1);
    }
    try {
      options.onFrame?.(frame);
    } catch {
      // A live observer cannot change log ownership or sequence semantics.
    }
    return frame;
  }

  function appendText(record: LogRecord, stream: 'stdout' | 'stderr', text: string): AgentShellLogAppendResult {
    if (!text) return Object.freeze({ droppedDetailedBytes: 0, frames: Object.freeze([]) });
    const emitted: AgentShellOutputFrameV1[] = [];
    const droppedBefore = record.droppedDetailedBytes;
    const safeText = stripAnsiChunk(record.ansi[stream], text);
    if (safeText) {
      const sanitized = sanitizeAgentSensitiveText(`${record.redactionCarry[stream]}${safeText}`);
      const shouldHold = shouldHoldRedactionSuffix(sanitized);
      const splitAt = shouldHold
        ? Math.max(0, sanitized.length - REDACTION_CARRY_CHARACTERS)
        : sanitized.length;
      const nextCarry = sanitized.slice(splitAt);
      if (!record.redactionCarry[stream] && nextCarry) record.redactionCarryOrder.push(stream);
      if (!nextCarry) {
        record.redactionCarryOrder = record.redactionCarryOrder.filter(item => item !== stream);
      }
      record.redactionCarry[stream] = nextCarry;
      splitFrameText(sanitized.slice(0, splitAt)).forEach((chunk) => {
        emitted.push(emitFrame(record, stream, chunk));
      });
    }
    requestQuotaAdjustment(record);
    persist();
    return Object.freeze({
      droppedDetailedBytes: record.droppedDetailedBytes - droppedBefore,
      frames: Object.freeze(emitted),
    });
  }

  function finishRecord(record: LogRecord): AgentShellLogAppendResult {
    if (record.status === 'expired' || record.finished) return Object.freeze({ droppedDetailedBytes: 0, frames: Object.freeze([]) });
    // An incomplete escape sequence is intentionally discarded at the terminal boundary.
    record.ansi.stderr.mode = 'normal';
    record.ansi.stdout.mode = 'normal';
    record.finished = true;
    const droppedBefore = record.droppedDetailedBytes;
    const emitted: AgentShellOutputFrameV1[] = [];
    [...record.redactionCarryOrder].forEach((stream) => {
      const pending = record.redactionCarry[stream];
      record.redactionCarry[stream] = '';
      record.redactionCarryOrder = record.redactionCarryOrder.filter(item => item !== stream);
      splitFrameText(sanitizeAgentSensitiveText(pending)).forEach((chunk) => {
        emitted.push(emitFrame(record, stream, chunk));
      });
    });
    queueQuotaCommit(record);
    persist();
    return Object.freeze({
      droppedDetailedBytes: record.droppedDetailedBytes - droppedBefore,
      frames: Object.freeze(emitted),
    });
  }

  async function flushRecord(record: LogRecord): Promise<void> {
    await ready;
    try {
      await record.physicalHandlePromise;
    } catch (error) {
      record.detailedStorageError = error;
    }
    await record.physicalWriteQueue;
    try {
      await verifyPhysicalSize(record);
    } catch (error) {
      record.detailedStorageError = error;
    }
    if (record.detailedStorageError !== undefined) throw record.detailedStorageError;

    // A quota operation can enqueue a follow-up adjustment, so wait until the
    // binding's operation promise stops changing instead of awaiting one link.
    if (record.quota) {
      for (;;) {
        const operation = record.quota.operation;
        await operation;
        if (record.quota.operation === operation) break;
      }
      if (record.quota.error !== undefined) throw record.quota.error;
    }
    await persistenceQueue;
    if (persistenceError !== undefined) throw persistenceError;
  }

  function create(input: AgentShellLogCreateInput): AgentShellLogHandle {
    const identity = normalizeIdentity(input);
    sweep();
    const createdAt = now();
    const expiresAt = input.expiresAt === undefined ? createdAt + ttlMs : Number(input.expiresAt);
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= createdAt || expiresAt > createdAt + MAX_TTL_MS) {
      invalidLog('Agent Shell 日志过期时间无效');
    }
    const logRef = createOpaqueRef(createId, 'log:v1:', usedRefs);
    usedRefs.add(logRef);
    const record: LogRecord = {
      ...identity,
      ansi: createEmptyParser(),
      createdAt,
      detailedBytes: 0,
      detailedFrameRefs: [],
      detailedFrames: [],
      detailedFrameCount: 0,
      pendingDetailedBytes: 0,
      pendingDetailedFrames: 0,
      droppedDetailedBytes: 0,
      expiresAt,
      generation: 1,
      lastSequence: 0,
      logRef,
      finished: false,
      redactionCarry: {
        stderr: '',
        stdout: '',
      },
      redactionCarryOrder: [],
      status: 'active',
      physicalHandlePromise: physicalStore ? physicalStore.create(logRef) : null,
      physicalSizeBytes: 0,
      physicalWriteQueue: Promise.resolve(),
      tailBytes: 0,
      tailFrames: [],
      truncatedBefore: null,
    };
    if (quota) {
      record.quota = {
        accountedBytes: 0,
        adjustmentQueued: false,
        desiredBytes: 0,
        lifecycle: 'active',
        operation: Promise.resolve(),
        observedBytes: 0,
        state: 'pending',
      };
    }
    records.set(logRef, record);
    startQuotaReservation(record);
    persist();
    return Object.freeze({
      appendSupervisorOutput: (event: AgentShellProcessOutputEvent) => {
        const current = requireRecord(logRef, identity);
        if (current.status === 'expired') return Object.freeze({ droppedDetailedBytes: 0, frames: Object.freeze([]) });
        if (current.finished) invalidLog('Agent Shell 日志已经结束');
        if (!event || event.kind !== 'output' || event.executionId !== current.executionId) {
          invalidLog('Agent Shell Supervisor 输出身份不匹配');
        }
        if (event.stream !== 'stdout' && event.stream !== 'stderr') invalidLog('Agent Shell Supervisor 输出流无效');
        if (typeof event.text !== 'string') invalidLog('Agent Shell Supervisor 输出正文无效');
        return appendText(current, event.stream, event.text);
      },
      dispose: async () => {
        const current = records.get(logRef);
        if (!current) return false;
        if (!sameIdentity(current, identity)) invalidLog('Agent Shell 日志身份不匹配');
        // The physical writer is optional, so the handle itself must close its
        // write queue before removing the record instead of relying on quota
        // cleanup to provide that ordering.
        await current.physicalWriteQueue;
        queueQuotaRelease(current);
        records.delete(logRef);
        usedRefs.delete(logRef);
        for (const [cursor, value] of cursors) {
          if (value.logRef === logRef) {
            cursors.delete(cursor);
            usedCursors.delete(cursor);
          }
        }
        persist();
        await persistenceQueue;
        await flushQuota();
        return true;
      },
      finish: () => {
        const current = requireRecord(logRef, identity);
        return finishRecord(current);
      },
      flush: async () => {
        const current = records.get(logRef);
        if (!current) invalidLog('Agent Shell logRef 不存在');
        if (!sameIdentity(current, identity)) invalidLog('Agent Shell 日志身份不匹配');
        await flushRecord(current);
      },
      getTail: () => cloneTail(requireRecord(logRef, identity)),
      logRef,
    });
  }

  async function readPage(request: AgentShellLogReadRequest): Promise<AgentShellLogPageV1> {
    const validated = assertPageRequest(request);
    const record = requireRecord(validated.logRef, validated.identity);
    if (record.physicalHandlePromise) await record.physicalHandlePromise;
    await record.physicalWriteQueue;
    await verifyPhysicalSize(record);
    if (record.detailedStorageError !== undefined) throw record.detailedStorageError;
    const maxFrames = boundedPageInteger(request.maxFrames, maxPageFrames, maxPageFrames);
    const maxBytes = boundedPageInteger(request.maxBytes, maxPageBytes, maxPageBytes, MAX_FRAME_BYTES);
    if (record.status === 'expired') {
      return Object.freeze({
        availableRanges: Object.freeze([]),
        executionId: record.executionId,
        expired: true,
        frames: Object.freeze([]),
        nextAvailableSequence: null,
        pageFirstSequence: null,
        pageLastSequence: null,
        requestedAfter: validated.afterSequence ?? null,
        unavailableThrough: record.lastSequence || null,
      });
    }
    let afterSequence = validated.afterSequence ?? 0;
    let requestedAfter = validated.afterSequence ?? null;
    if (validated.cursor) {
      const cursor = cursors.get(validated.cursor);
      if (!cursor || cursor.logRef !== record.logRef || cursor.generation !== record.generation) {
        invalidLog('Agent Shell 日志 cursor 已失效');
      }
      afterSequence = cursor.afterSequence;
      requestedAfter = afterSequence;
    }
    const retained = collectFrameEntries(record);
    const availableRanges = rangesForSequences(retained.map(entry => entry.sequence));
    const afterFrames = retained.filter(entry => entry.sequence > afterSequence);
    const nextAvailableSequence = afterFrames[0]?.sequence ?? null;
    const unavailableThrough = nextAvailableSequence === null
      ? (record.lastSequence > afterSequence ? record.lastSequence : null)
      : (nextAvailableSequence > afterSequence + 1 ? nextAvailableSequence - 1 : null);
    const selected: FrameEntry[] = [];
    let pageBytes = 0;
    for (const entry of afterFrames) {
      const bytes = entry.byteLength;
      if (selected.length >= maxFrames || (selected.length > 0 && pageBytes + bytes > maxBytes)) break;
      selected.push(entry);
      pageBytes += bytes;
    }
    const lastPageSequence = selected.at(-1)?.sequence ?? null;
    let nextCursor: string | undefined;
    if (lastPageSequence !== null && afterFrames.some(frame => frame.sequence > lastPageSequence)) {
      while (cursors.size >= MAX_CURSOR_COUNT) {
        const oldest = cursors.keys().next().value as string | undefined;
        if (!oldest) break;
        cursors.delete(oldest);
        usedCursors.delete(oldest);
      }
      nextCursor = createOpaqueRef(createId, 'cursor:v1:', usedCursors);
      usedCursors.add(nextCursor);
      cursors.set(nextCursor, {
        afterSequence: lastPageSequence,
        generation: record.generation,
        logRef: record.logRef,
      });
    }
    const page = await Promise.all(selected.map(async (entry) => {
      if (entry.frame) return entry.frame;
      if (!entry.ref) invalidLog('Agent Shell 日志 frame 来源缺失');
      const handle = await ensurePhysicalHandle(record);
      const result = await handle.read({ maxBytes: entry.ref.recordBytes, offset: entry.ref.offset });
      if (result.data.length !== entry.ref.recordBytes) invalidLog('Agent Shell 物理日志 frame 读取不完整');
      return decodeDetailedFrame(result.data, entry.ref);
    }));
    return Object.freeze({
      availableRanges,
      ...(nextCursor ? { nextCursor } : {}),
      executionId: record.executionId,
      expired: false,
      frames: Object.freeze(page.map(cloneFrame)),
      nextAvailableSequence,
      pageFirstSequence: page[0]?.sequence ?? null,
      pageLastSequence: lastPageSequence,
      requestedAfter,
      unavailableThrough,
    });
  }

  function getTail(request: AgentShellLogIdentity & { readonly logRef: string }): AgentShellOutputTailV1 {
    const identity = normalizeIdentity(request);
    const record = requireRecord(request.logRef, identity);
    return cloneTail(record);
  }

  const ready = (async () => {
    if (!persistence) return;
    const loaded = await persistence.load();
    for (const persisted of loaded) {
      const validated = validatePersistedRecord(persisted);
      if (records.has(validated.logRef) || usedRefs.has(validated.logRef)) invalidLog('Agent Shell 持久化 logRef 冲突');
      const detailedFrameRefs = validated.detailedFrameRefs || [];
      const detailedFrames = validated.detailedFrames || [];
      if (
        detailedFrameRefs.length + detailedFrames.length > maxDetailedFrames
        || validated.detailedBytes > maxDetailedBytes
        || validated.tailFrames.length > maxTailFrames
        || validated.tailBytes > maxTailBytes
      ) {
        invalidLog('Agent Shell 持久化日志超出当前上限');
      }
      usedRefs.add(validated.logRef);
      const restoredDetailedBytes = physicalStore
        ? detailedFrameRefs.reduce((total, ref) => total + ref.byteLength, 0)
        : validated.detailedBytes;
      const record: LogRecord = {
        ...validated,
        ansi: createEmptyParser(),
        detailedBytes: restoredDetailedBytes,
        detailedFrameRefs: detailedFrameRefs.map(cloneFrameRef),
        detailedFrames: physicalStore ? [] : detailedFrames.map(cloneFrame),
        detailedFrameCount: detailedFrameRefs.length + (physicalStore ? 0 : detailedFrames.length),
        pendingDetailedBytes: 0,
        pendingDetailedFrames: 0,
        finished: validated.finished,
        redactionCarry: {
          stderr: '',
          stdout: '',
        },
        redactionCarryOrder: [],
        status: validated.expired ? 'expired' : 'active',
        physicalHandlePromise: physicalStore && !validated.expired
          ? physicalStore.open(validated.logRef).catch(async (error) => {
            try {
              return await physicalStore.create(validated.logRef);
            } catch {
              throw error;
            }
          })
          : null,
        physicalSizeBytes: detailedFrameRefs.at(-1)
          ? detailedFrameRefs.at(-1)!.offset + detailedFrameRefs.at(-1)!.recordBytes
          : 0,
        physicalWriteQueue: Promise.resolve(),
        tailFrames: validated.tailFrames.map(cloneFrame),
      };
      if (quota) {
        record.quota = {
          accountedBytes: 0,
          adjustmentQueued: false,
          desiredBytes: record.detailedBytes,
          lifecycle: validated.expired ? 'deleting' : validated.finished ? 'finished' : 'active',
          operation: Promise.resolve(),
          observedBytes: record.detailedBytes,
          state: 'pending',
        };
      }
      records.set(record.logRef, record);
      if (physicalStore && !validated.expired && detailedFrames.length > 0) {
        detailedFrames.forEach(frame => queueDetailedFrame(record, frame));
      }
      if (record.quota) startQuotaReattach(record);
    }
    sweep();
  })();

  async function flush(): Promise<void> {
    await ready;
    await flushPhysical();
    await persistenceQueue;
    await flushQuota();
    if (persistenceError) throw persistenceError;
  }

  async function dispose(): Promise<void> {
    await ready;
    records.forEach((record) => markExpired(record));
    records.clear();
    cursors.clear();
    usedRefs.clear();
    usedCursors.clear();
    persist();
    await flush();
    await persistence?.close?.();
  }

  return Object.freeze({
    create,
    dispose,
    flush,
    getTail,
    readPage,
    ready,
    sweep,
  });
}

export type AgentShellLogStore = ReturnType<typeof createAgentShellLogStore>;
