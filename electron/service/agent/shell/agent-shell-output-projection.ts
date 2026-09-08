import type {
  AgentShellOutputFrameV1,
} from '../../../../src/shared/agent/shell/agent-shell.types';

// The Orchestrator gives shell.run up to 40k model tokens. Retain enough safe
// UTF-8 source for that projection before the token-aware layer decides what
// actually fits; one Unicode scalar can occupy at most four UTF-8 bytes.
export const AGENT_SHELL_PROVIDER_OUTPUT_MAX_BYTES = 40_000 * 4;

const MIN_NONEMPTY_STREAM_BUDGET_BYTES = 1_024;

export interface AgentShellProviderStreamOutputV1 {
  readonly head: string;
  readonly omittedBytes: number;
  readonly tail: string;
  readonly totalBytes: number;
  readonly truncated: boolean;
}

export interface AgentShellProviderOutputV1 {
  readonly stderr: AgentShellProviderStreamOutputV1;
  readonly stdout: AgentShellProviderStreamOutputV1;
  readonly version: 1;
}

type AgentShellOutputProjectionFrame = Pick<
  AgentShellOutputFrameV1,
  'stream' | 'text'
>;

interface StreamBudget {
  readonly stderr: number;
  readonly stdout: number;
}

const EMPTY_BUFFER = Buffer.alloc(0);

function utf8SequenceBytes(firstByte: number): number {
  if ((firstByte & 0x80) === 0) return 1;
  if ((firstByte & 0xe0) === 0xc0) return 2;
  if ((firstByte & 0xf0) === 0xe0) return 3;
  if ((firstByte & 0xf8) === 0xf0) return 4;
  return 1;
}

function takeUtf8BufferPrefix(value: Buffer, maximumBytes: number): Buffer {
  if (maximumBytes <= 0 || value.byteLength === 0) return EMPTY_BUFFER;
  let end = Math.min(value.byteLength, maximumBytes);
  while (end > 0 && end < value.byteLength && (value[end] & 0xc0) === 0x80) {
    end -= 1;
  }
  if (end === 0) return EMPTY_BUFFER;

  let leadingByte = end - 1;
  while (leadingByte > 0 && (value[leadingByte] & 0xc0) === 0x80) {
    leadingByte -= 1;
  }
  if (leadingByte + utf8SequenceBytes(value[leadingByte]) > end) {
    end = leadingByte;
  }
  return value.subarray(0, end);
}

function takeUtf8BufferSuffix(value: Buffer, maximumBytes: number): Buffer {
  if (maximumBytes <= 0 || value.byteLength === 0) return EMPTY_BUFFER;
  let start = Math.max(0, value.byteLength - maximumBytes);
  while (start < value.byteLength && (value[start] & 0xc0) === 0x80) {
    start += 1;
  }
  return value.subarray(start);
}

class Utf8HeadTailCapture {
  private complete: Buffer | null = null;

  private completeBytes = 0;

  private head: Buffer | null = null;

  private tail: Buffer | null = null;

  private tailBytes = 0;

  private tailStart = 0;

  private totalBytes = 0;

  private truncated = false;

  constructor(private readonly captureBytes: number) {}

  append(value: string): void {
    if (!value) return;
    const bytes = Buffer.from(value, 'utf8');
    const nextTotalBytes = this.totalBytes + bytes.byteLength;
    if (!this.truncated && nextTotalBytes <= this.captureBytes) {
      this.complete ||= Buffer.allocUnsafe(this.captureBytes);
      bytes.copy(this.complete, this.completeBytes);
      this.completeBytes += bytes.byteLength;
      this.totalBytes = nextTotalBytes;
      return;
    }

    if (!this.truncated) {
      const complete = this.complete?.subarray(0, this.completeBytes) || EMPTY_BUFFER;
      const headBytes = Math.ceil(this.captureBytes / 2);
      this.head = Buffer.allocUnsafe(headBytes);
      const copiedCompleteBytes = complete.copy(this.head, 0, 0, headBytes);
      if (copiedCompleteBytes < headBytes) {
        bytes.copy(this.head, copiedCompleteBytes, 0, headBytes - copiedCompleteBytes);
      }
      this.tail = Buffer.allocUnsafe(Math.floor(this.captureBytes / 2));
      this.appendTail(complete);
      this.appendTail(bytes);
      this.complete = null;
      this.completeBytes = 0;
      this.truncated = true;
    } else {
      this.appendTail(bytes);
    }
    this.totalBytes = nextTotalBytes;
  }

  private appendTail(value: Buffer): void {
    const tail = this.tail;
    if (!tail || tail.byteLength === 0 || value.byteLength === 0) return;
    const capacity = tail.byteLength;
    if (value.byteLength >= capacity) {
      value.copy(tail, 0, value.byteLength - capacity);
      this.tailBytes = capacity;
      this.tailStart = 0;
      return;
    }

    let sourceOffset = 0;
    if (this.tailBytes < capacity) {
      const appendBytes = Math.min(value.byteLength, capacity - this.tailBytes);
      this.copyIntoTail(value, sourceOffset, appendBytes, this.tailStart + this.tailBytes);
      this.tailBytes += appendBytes;
      sourceOffset += appendBytes;
    }
    if (sourceOffset >= value.byteLength) return;

    const overwriteBytes = value.byteLength - sourceOffset;
    this.copyIntoTail(value, sourceOffset, overwriteBytes, this.tailStart);
    this.tailStart = (this.tailStart + overwriteBytes) % capacity;
  }

  private copyIntoTail(
    source: Buffer,
    sourceOffset: number,
    length: number,
    targetOffset: number,
  ): void {
    const tail = this.tail;
    if (!tail || length <= 0) return;
    const normalizedTarget = targetOffset % tail.byteLength;
    const firstBytes = Math.min(length, tail.byteLength - normalizedTarget);
    source.copy(tail, normalizedTarget, sourceOffset, sourceOffset + firstBytes);
    if (firstBytes < length) {
      source.copy(tail, 0, sourceOffset + firstBytes, sourceOffset + length);
    }
  }

  private orderedTail(): Buffer {
    const tail = this.tail;
    if (!tail || this.tailBytes === 0) return EMPTY_BUFFER;
    if (this.tailStart + this.tailBytes <= tail.byteLength) {
      return tail.subarray(this.tailStart, this.tailStart + this.tailBytes);
    }
    const ordered = Buffer.allocUnsafe(this.tailBytes);
    const firstBytes = tail.byteLength - this.tailStart;
    tail.copy(ordered, 0, this.tailStart);
    tail.copy(ordered, firstBytes, 0, this.tailBytes - firstBytes);
    return ordered;
  }

  getTotalBytes(): number {
    return this.totalBytes;
  }

  project(maximumBytes: number): AgentShellProviderStreamOutputV1 {
    const boundedBytes = Math.max(0, Math.min(maximumBytes, this.totalBytes));
    if (!this.truncated && this.totalBytes <= boundedBytes) {
      return Object.freeze({
        head: (this.complete?.subarray(0, this.completeBytes) || EMPTY_BUFFER).toString('utf8'),
        omittedBytes: 0,
        tail: '',
        totalBytes: this.totalBytes,
        truncated: false,
      });
    }

    const headBytes = Math.ceil(boundedBytes / 2);
    const tailBytes = Math.floor(boundedBytes / 2);
    const complete = this.complete?.subarray(0, this.completeBytes) || EMPTY_BUFFER;
    const projectedHead = takeUtf8BufferPrefix(
      this.truncated ? this.head || EMPTY_BUFFER : complete,
      headBytes,
    );
    const projectedTail = takeUtf8BufferSuffix(
      this.truncated ? this.orderedTail() : complete,
      tailBytes,
    );
    const retainedBytes = projectedHead.byteLength + projectedTail.byteLength;
    const omittedBytes = Math.max(0, this.totalBytes - retainedBytes);
    return Object.freeze({
      head: projectedHead.toString('utf8'),
      omittedBytes,
      tail: projectedTail.toString('utf8'),
      totalBytes: this.totalBytes,
      truncated: omittedBytes > 0,
    });
  }
}

function allocateStreamBudget(
  stdoutBytes: number,
  stderrBytes: number,
  maximumBytes: number,
): StreamBudget {
  const totalBytes = stdoutBytes + stderrBytes;
  if (totalBytes <= maximumBytes) {
    return { stderr: stderrBytes, stdout: stdoutBytes };
  }
  if (stdoutBytes === 0) return { stderr: maximumBytes, stdout: 0 };
  if (stderrBytes === 0) return { stderr: 0, stdout: maximumBytes };

  const minimum = Math.min(
    MIN_NONEMPTY_STREAM_BUDGET_BYTES,
    Math.floor(maximumBytes / 4),
  );
  let stdout = Math.min(stdoutBytes, minimum);
  let stderr = Math.min(stderrBytes, minimum);
  let remaining = Math.max(0, maximumBytes - stdout - stderr);
  const stdoutExtra = Math.max(0, stdoutBytes - stdout);
  const stderrExtra = Math.max(0, stderrBytes - stderr);
  const totalExtra = stdoutExtra + stderrExtra;
  if (remaining > 0 && totalExtra > 0) {
    const stdoutShare = Math.min(
      stdoutExtra,
      Math.floor((remaining * stdoutExtra) / totalExtra),
    );
    stdout += stdoutShare;
    remaining -= stdoutShare;
    const stderrShare = Math.min(stderrExtra, remaining);
    stderr += stderrShare;
    remaining -= stderrShare;
  }
  if (remaining > 0) {
    const stdoutRemainder = Math.min(stdoutBytes - stdout, remaining);
    stdout += stdoutRemainder;
    remaining -= stdoutRemainder;
  }
  if (remaining > 0) stderr += Math.min(stderrBytes - stderr, remaining);
  return { stderr, stdout };
}

function retainedStreamBytes(output: AgentShellProviderStreamOutputV1): number {
  return Buffer.byteLength(output.head, 'utf8')
    + Buffer.byteLength(output.tail, 'utf8');
}

function projectProviderStream(
  output: AgentShellProviderStreamOutputV1,
  maximumBytes: number,
): AgentShellProviderStreamOutputV1 {
  const retainedBytes = retainedStreamBytes(output);
  if (maximumBytes >= retainedBytes) return output;

  const headBytes = Math.ceil(maximumBytes / 2);
  const tailBytes = Math.floor(maximumBytes / 2);
  const projectedHead = takeUtf8BufferPrefix(Buffer.from(output.head, 'utf8'), headBytes);
  const tailSource = output.tail || output.head;
  const projectedTail = takeUtf8BufferSuffix(Buffer.from(tailSource, 'utf8'), tailBytes);
  const projectedBytes = projectedHead.byteLength + projectedTail.byteLength;
  const omittedBytes = Math.max(0, output.totalBytes - projectedBytes);
  return Object.freeze({
    head: projectedHead.toString('utf8'),
    omittedBytes,
    tail: projectedTail.toString('utf8'),
    totalBytes: output.totalBytes,
    truncated: omittedBytes > 0,
  });
}

export function projectAgentShellProviderOutput(
  output: AgentShellProviderOutputV1,
  maximumBytes: number,
): AgentShellProviderOutputV1 {
  const normalizedMaximumBytes = Math.max(1, Math.floor(Number(maximumBytes) || 0));
  const budget = allocateStreamBudget(
    retainedStreamBytes(output.stdout),
    retainedStreamBytes(output.stderr),
    normalizedMaximumBytes,
  );
  return Object.freeze({
    stderr: projectProviderStream(output.stderr, budget.stderr),
    stdout: projectProviderStream(output.stdout, budget.stdout),
    version: 1 as const,
  });
}

export function createAgentShellOutputProjectionCollector(
  maximumBytes = AGENT_SHELL_PROVIDER_OUTPUT_MAX_BYTES,
) {
  const normalizedMaximumBytes = Math.max(1, Math.floor(Number(maximumBytes) || 0));
  const stdout = new Utf8HeadTailCapture(normalizedMaximumBytes);
  const stderr = new Utf8HeadTailCapture(normalizedMaximumBytes);

  function append(frames: readonly AgentShellOutputProjectionFrame[]): void {
    frames.forEach((frame) => {
      if (frame.stream === 'stdout') stdout.append(frame.text);
      else if (frame.stream === 'stderr') stderr.append(frame.text);
    });
  }

  function snapshot(): AgentShellProviderOutputV1 {
    const budget = allocateStreamBudget(
      stdout.getTotalBytes(),
      stderr.getTotalBytes(),
      normalizedMaximumBytes,
    );
    return Object.freeze({
      stderr: stderr.project(budget.stderr),
      stdout: stdout.project(budget.stdout),
      version: 1 as const,
    });
  }

  return Object.freeze({ append, snapshot });
}
