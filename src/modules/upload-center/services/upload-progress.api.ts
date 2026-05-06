import { API_CONFIG } from '@/config/api';
import { auth } from '@/utils/auth';
import { runtimeLogger } from '@/utils/runtimeLogger';

// 后端 GET /api/v1/upload/:uploadId/progress 返回的字节进度快照。
// 该接口仅在 proxy 上传模式下存在；切到客户端直传 MinIO 后整段管道可下线。
export interface UploadProgressSample {
  uploadId: string;
  totalBytes: number;
  uploadedBytes: number;
  percentage: number;
  state: 'running' | 'done';
}

export interface PollUploadProgressOptions {
  intervalMs?: number;
  // 单次成功采样回调；监听者负责 monotonic 保护与 UI 推送。
  onSample?: (sample: UploadProgressSample) => void;
  // 后端 4xx/5xx 或网络异常时调用；失败不停止轮询，由 onError 决定是否取消。
  onError?: (err: unknown) => void;
  // 调用方主动停止轮询的信号。
  signal?: AbortSignal;
}

const DEFAULT_INTERVAL_MS = 500;

interface IpcHttpResponse<T = unknown> {
  status?: number;
  body?: T;
}

interface ProgressResponseBody {
  code?: string;
  data?: Partial<UploadProgressSample> | null;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

function buildHeaders(): Record<string, string> {
  const token = auth.getToken();
  const username = auth.getUsername();
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(username ? { username } : {}),
  };
}

function parseSample(uploadId: string, body: unknown): UploadProgressSample | null {
  if (!isObject(body)) return null;
  const wrapped = body as ProgressResponseBody;
  const payload = wrapped.data;
  if (!isObject(payload)) return null;
  const totalBytes = Number(payload.totalBytes ?? 0);
  const uploadedBytes = Number(payload.uploadedBytes ?? 0);
  const percentage = Number(payload.percentage ?? 0);
  const stateRaw = String(payload.state ?? '');
  const state: UploadProgressSample['state'] = stateRaw === 'done' ? 'done' : 'running';
  if (!Number.isFinite(totalBytes) || !Number.isFinite(uploadedBytes)) return null;
  return {
    uploadId,
    totalBytes,
    uploadedBytes,
    percentage: Number.isFinite(percentage) ? percentage : 0,
    state,
  };
}

/**
 * 启动轮询并返回 stop 函数。同一个 uploadId 重复调用会创建独立轮询循环——
 * 由调用方负责保证唯一性（通常每个上传任务一个 uploadId）。
 *
 * 行为约定：
 *   - 进入 done 状态后自动停止；
 *   - 404 视为"会话尚未注册"或"已被清理"：不抛错，继续重试直到调用方取消；
 *   - 其他错误通过 onError 透传，但不停止轮询，避免一次抖动让进度永久卡住。
 */
export function pollUploadProgress(
  uploadId: string,
  options: PollUploadProgressOptions = {},
): () => void {
  const intervalMs = Math.max(100, options.intervalMs ?? DEFAULT_INTERVAL_MS);
  const url = `${API_CONFIG.BASE_URL}/v1/upload/${encodeURIComponent(uploadId)}/progress`;

  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  if (options.signal) {
    if (options.signal.aborted) {
      return stop;
    }
    options.signal.addEventListener('abort', stop, { once: true });
  }

  const tick = async () => {
    if (stopped) return;
    try {
      const res = (await window.electronAPI.fetch(url, {
        method: 'GET',
        headers: buildHeaders(),
      })) as IpcHttpResponse;
      const status = Number(res?.status ?? 0);
      if (status === 404) {
        // 注册前的窗口或会话已清理：保持沉默，让调用方靠 IPC 兜底。
      } else if (status >= 200 && status < 300) {
        const sample = parseSample(uploadId, res?.body);
        if (sample) {
          options.onSample?.(sample);
          if (sample.state === 'done') {
            stop();
            return;
          }
        }
      } else {
        options.onError?.(new Error(`upload progress poll: HTTP ${status}`));
      }
    } catch (err) {
      runtimeLogger.warn('upload progress poll failed', err);
      options.onError?.(err);
    }
    if (!stopped) {
      timer = setTimeout(tick, intervalMs);
    }
  };

  // 立即触发一次，避免首帧延迟一个 interval。
  void tick();

  return stop;
}
