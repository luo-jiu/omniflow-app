import { API_CONFIG } from '@/config/api.ts';

/**
 * 渲染进程统一请求封装
 * @param path API 路径（不用带 BASE_URL）
 * @param options fetch 选项
 */
export async function request(path: string, options?: any) {
  try {
    const res = await window.electronAPI.fetch(
      `${API_CONFIG.BASE_URL}${path}`,
      {
        method: options?.method || 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...(options?.headers || {}),
        },
        body: options?.body,
      }
    );
    console.log("📦 Renderer 收到数据:", res.body);
    return res.body;
  } catch (err) {
    console.error('❌ Renderer 请求失败:', err);
    throw err;
  }
}