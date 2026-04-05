import { API_CONFIG } from '@/config/api';
import { auth } from '@/utils/auth';

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
 * @param path API 路径
 * @param options fetch 选项
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

    // 统一处理登录态失效：清空本地登录态并回到登录页
    if (status === 401 || code === 'A00200') {
      auth.clear();
      if (!window.location.hash.includes('/login')) {
        window.location.hash = '/login';
      }
      throw new Error(`登录状态已失效，请重新登录 (${path})`);
    }

    // 优先看业务成功标记；只有在业务失败时才按 HTTP 错误抛出
    if (status >= 400 && !businessSuccess) {
      const message = getErrorMessage(body, `HTTP error! status: ${status}`);
      throw new Error(`${message} (${path})`);
    }

    // 兼容后端统一响应格式：success=false 时当作失败处理
    if (isObject(body) && (body as ApiBody).success === false && !businessSuccess) {
      const message = getErrorMessage(body, 'Request failed');
      throw new Error(`${message} (${path})`);
    }

    console.log("📦 IPC Renderer 收到数据:", body);
    return body as T;
  } catch (err) {
    console.error('❌ IPC Renderer 请求失败:', err);
    throw err;
  }
}

/**
 * IPC 上传文件封装
 * @param path API 路径
 * @param filePath 文件路径
 * @param formDataParams 其他表单参数
 */
export async function ipcUpload<T = any>(path: string, filePath: string, formDataParams?: Record<string, string>): Promise<T> {
  try {
    const token = auth.getToken();
    const username = auth.getUsername();
    const headers = {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(username ? { username } : {}),
    };

    const res = await window.electronAPI.upload(
      `${API_CONFIG.BASE_URL}${path}`,
      filePath,
      formDataParams,
      headers
    );
    console.log("📦 IPC Upload 收到数据:", res.body);
    return res.body as T;
  } catch (err) {
    console.error('❌ IPC Upload 请求失败:', err);
    throw err;
  }
}
