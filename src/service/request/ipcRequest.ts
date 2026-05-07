import { API_CONFIG } from '@/config/api';
import { auth } from '@/utils/auth';
import { runtimeLogger } from '@/utils/runtimeLogger';

interface IpcHttpResponse<T = unknown> {
  status?: number;
  body?: T;
}

type ApiBody = {
  code?: string | number;
  message?: string | null;
  success?: boolean;
  [key: string]: unknown;
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const getApiCode = (body: unknown): string => {
  if (!isObject(body) || !('code' in body)) return '';
  return String((body as ApiBody).code ?? '');
};

const isBusinessSuccess = (body: unknown): boolean => {
  if (!isObject(body)) return false;
  const apiBody = body as ApiBody;
  return apiBody.success === true || String(apiBody.code ?? '') === '0';
};

const getErrorMessage = (body: unknown, fallback: string): string => {
  if (!isObject(body)) return fallback;
  const msg = (body as ApiBody).message;
  if (msg === null || msg === undefined || String(msg).trim() === '') return fallback;
  return String(msg);
};

/**
 * IPC 请求封装 (通过主进程转发)
 */
export async function ipcRequest<T = any>(path: string, options?: any): Promise<T> {
  try {
    const token = auth.getToken();
    const username = auth.getUsername();
    const url = `${API_CONFIG.BASE_URL}${path}`;
    const headers = {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(username ? { username } : {}),
      ...(options?.headers || {}),
    };

    const res = await window.electronAPI.fetch(
      url,
      {
        method: options?.method || 'GET',
        headers,
        body: options?.body,
      }
    ) as IpcHttpResponse;

    const status = Number(res?.status ?? 0);
    const body = res?.body as unknown;
    const code = getApiCode(body);
    const businessSuccess = isBusinessSuccess(body);

    if (status === 401 || code === 'A00200') {
      auth.clear();
      if (!window.location.hash.includes('/login')) {
        window.location.hash = '/login';
      }
      throw new Error(`登录状态已失效，请重新登录 (${path})`);
    }

    if (status >= 400 && !businessSuccess) {
      const message = getErrorMessage(body, `HTTP error! status: ${status}`);
      throw new Error(`${message} (${path})`);
    }

    if (isObject(body) && (body as ApiBody).success === false && !businessSuccess) {
      const message = getErrorMessage(body, 'Request failed');
      throw new Error(`${message} (${path})`);
    }

    runtimeLogger.debug("📦 IPC Renderer 收到数据:", body);
    return body as T;
  } catch (err) {
    runtimeLogger.error('❌ IPC Renderer 请求失败:', err);
    throw err;
  }
}

function validateIpcUploadResponse<T>(res: IpcHttpResponse, label: string): T {
  const status = Number(res?.status ?? 0);
  const body = res?.body as unknown;
  const code = getApiCode(body);
  const businessSuccess = isBusinessSuccess(body);

  if (status === 401 || code === 'A00200') {
    auth.clear();
    if (!window.location.hash.includes('/login')) {
      window.location.hash = '/login';
    }
    throw new Error(`登录状态已失效，请重新登录 (${label})`);
  }

  if (status >= 400 && !businessSuccess) {
    const fallback = status === 413
      ? '上传失败：文件体积超过服务端限制（HTTP 413）'
      : `HTTP error! status: ${status}`;
    const message = getErrorMessage(body, fallback);
    throw new Error(`${message} (${label})`);
  }

  if (isObject(body) && (body as ApiBody).success === false && !businessSuccess) {
    const message = getErrorMessage(body, 'Upload failed');
    throw new Error(`${message} (${label})`);
  }

  runtimeLogger.debug("📦 IPC Upload 收到数据:", body);
  return body as T;
}

/**
 * 走主进程 multipart/form-data POST 的代理上传，仅服务于头像这类小文件场景。
 * 文件节点上传请走 src/modules/upload-center/services/upload-session.api.ts 的直传链路。
 */
export async function ipcUpload<T = any>(
  path: string,
  filePath: string,
  formDataParams?: Record<string, string>,
): Promise<T> {
  const token = auth.getToken();
  const username = auth.getUsername();
  const headers = {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(username ? { username } : {}),
  };

  try {
    const res = await window.electronAPI.uploadFormData(
      `${API_CONFIG.BASE_URL}${path}`,
      filePath,
      formDataParams,
      headers,
    ) as IpcHttpResponse;
    return validateIpcUploadResponse<T>(res, path);
  } catch (err) {
    runtimeLogger.error('❌ IPC Upload 请求失败:', err);
    throw err;
  }
}
