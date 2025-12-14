import { API_CONFIG } from '@/config/api';
import { auth } from '@/utils/auth';

/**
 * IPC 请求封装 (通过主进程转发)
 * @param path API 路径
 * @param options fetch 选项
 */
export async function ipcRequest(path: string, options?: any) {
  try {
    const token = auth.getToken();
    const username = auth.getUsername();
    const headers = {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(username ? { username } : {}),
      ...(options?.headers || {}),
    };

    const res = await window.electronAPI.fetch(
      `${API_CONFIG.BASE_URL}${path}`,
      {
        method: options?.method || 'GET',
        headers,
        body: options?.body,
      }
    );
    console.log("📦 IPC Renderer 收到数据:", res.body);
    return res.body;
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
export async function ipcUpload(path: string, filePath: string, formDataParams?: Record<string, string>) {
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
    return res.body;
  } catch (err) {
    console.error('❌ IPC Upload 请求失败:', err);
    throw err;
  }
}
