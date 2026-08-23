export interface AIServiceStreamLimits {
  maxContentCharacters?: number;
  maxEventBufferCharacters?: number;
}

export interface ResolvedAIServiceStreamLimits {
  maxContentCharacters: number;
  maxEventBufferCharacters: number;
}

export const DEFAULT_AI_SERVICE_STREAM_LIMITS: Readonly<ResolvedAIServiceStreamLimits> = Object.freeze({
  maxContentCharacters: 1_000_000,
  maxEventBufferCharacters: 256_000,
});

export const AI_SERVICE_HTTP_BODY_LIMITS = Object.freeze({
  errorBytes: 64 * 1024,
  jsonBytes: 2 * 1024 * 1024,
});

export class AIServiceStreamLimitError extends Error {
  readonly code = 'AI_SERVICE_STREAM_LIMIT_EXCEEDED';

  constructor(label: string, maximum: number) {
    super(`${label}超过安全上限（最多 ${maximum} 个字符）`);
    this.name = 'AIServiceStreamLimitError';
  }
}

function positiveInteger(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function resolveAIServiceStreamLimits(
  limits: AIServiceStreamLimits = {},
): ResolvedAIServiceStreamLimits {
  return {
    maxContentCharacters: positiveInteger(
      limits.maxContentCharacters,
      DEFAULT_AI_SERVICE_STREAM_LIMITS.maxContentCharacters,
    ),
    maxEventBufferCharacters: positiveInteger(
      limits.maxEventBufferCharacters,
      DEFAULT_AI_SERVICE_STREAM_LIMITS.maxEventBufferCharacters,
    ),
  };
}

export function appendBoundedAIServiceStreamText(
  current: string,
  fragment: string,
  maximum: number,
  label: string,
): string {
  if (fragment.length > maximum - current.length) {
    throw new AIServiceStreamLimitError(label, maximum);
  }
  return current + fragment;
}

export async function readBoundedAIServiceResponseText(
  response: Response,
  maximumBytes: number,
  label: string,
): Promise<string> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`${label}超过安全上限（最多 ${maximumBytes} 字节）`);
  }
  if (!response.body) return '';

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let byteLength = 0;
  let text = '';
  try {
    let chunk = await reader.read();
    while (!chunk.done) {
      if (chunk.value) {
        if (chunk.value.byteLength > maximumBytes - byteLength) {
          throw new Error(`${label}超过安全上限（最多 ${maximumBytes} 字节）`);
        }
        byteLength += chunk.value.byteLength;
        text += decoder.decode(chunk.value, { stream: true });
      }
      chunk = await reader.read();
    }
    text += decoder.decode();
    return text;
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
}
