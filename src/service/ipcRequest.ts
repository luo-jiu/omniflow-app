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


